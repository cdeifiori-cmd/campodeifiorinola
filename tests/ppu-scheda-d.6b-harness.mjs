// tests/ppu-scheda-d.6b-harness.mjs
// DEV-ONLY — Passo 6B. Esegue i 6 casi sintetici contro la logica REALE di
// functions/schedaDCore.js:
//   • SYSTEM_PROMPT v2 attuale        (core.SYSTEM_PROMPT)
//   • payload builder                  (core.costruisciPayload, via eseguiGenerazione)
//   • validazione strutturale          (core.validaOutputAI)
//   • verifica semantica delle fonti   (core.verificaFontiSemantica)
//   • logica di retry (max 1)          (core.eseguiGenerazione)
// Firestore è un fake IN-MEMORY: NESSUNA scrittura reale, nessun emulatore.
// Il modello è MOCK per default; con --real chiama davvero il provider usando
// SOLO process.env.ANTHROPIC_API_KEY (mai stampata, mai scritta su file, mai
// nei log). Nessun documento Firestore viene creato in nessun caso.
//
//   node tests/ppu-scheda-d.6b-harness.mjs                 # mock, tutti i casi
//   node tests/ppu-scheda-d.6b-harness.mjs --case caso5_dati_poveri
//   node tests/ppu-scheda-d.6b-harness.mjs --json tests/.out/6b.json
//   ANTHROPIC_API_KEY="$SECRET" node tests/ppu-scheda-d.6b-harness.mjs --real
//
// Vedi in fondo `COME_ESEGUIRE_SENZA_ESPORRE_IL_SECRET`.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import core from '../functions/schedaDCore.js';
import { CASI, COMUNITA_COLLAUDO } from './fixtures/ppu-scheda-d.6b-cases.mjs';
import { MOCK_OUTPUTS } from './fixtures/ppu-scheda-d.6b-mock-outputs.mjs';

const require = createRequire(import.meta.url);

// ── Fake Firestore (stessa superficie usata da core.eseguiGenerazione) ──────
export function makeFakeDb(seed = {}) {
  const store = {
    utenti: { ...(seed.utenti || {}) },
    staff: { ...(seed.staff || {}) },
    ppu_schede_a: (seed.ppu_schede_a || []).slice(),
    ppu_schede_b: (seed.ppu_schede_b || []).slice(),
    ppu_schede_c: (seed.ppu_schede_c || []).slice(),
    ppu_schede_d: (seed.ppu_schede_d || []).slice(),
    ppu_schede_d_locks: { ...(seed.ppu_schede_d_locks || {}) },
  };
  let add = 0;
  const rows = (n) => (Array.isArray(store[n]) ? store[n] : Object.entries(store[n]).map(([id, d]) => ({ id, ...d })));
  const snap = (id, d) => (d
    ? { exists: true, id, data: () => { const c = { ...d }; delete c.id; return c; } }
    : { exists: false, id, data: () => undefined });
  function query(name, filters) {
    return {
      where(f, _op, v) { return query(name, filters.concat([[f, v]])); },
      async get() {
        const list = rows(name).filter((r) => filters.every(([f, v]) => r[f] === v));
        return { empty: list.length === 0, docs: list.map((r) => ({ id: r.id, data: () => { const c = { ...r }; delete c.id; return c; } })) };
      },
    };
  }
  function collection(name) {
    const q = query(name, []);
    return {
      where: q.where, get: q.get,
      doc(id) {
        return {
          async get() {
            if (Array.isArray(store[name])) return snap(id, store[name].find((r) => r.id === id));
            return snap(id, store[name][id] ? { id, ...store[name][id] } : undefined);
          },
          async set(data) {
            if (Array.isArray(store[name])) {
              const i = store[name].findIndex((r) => r.id === id);
              if (i >= 0) store[name][i] = { id, ...data }; else store[name].push({ id, ...data });
            } else store[name][id] = { ...data };
          },
          async create(data) {
            const exists = Array.isArray(store[name])
              ? store[name].some((r) => r.id === id)
              : Object.prototype.hasOwnProperty.call(store[name], id);
            if (exists) { const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e; }
            await this.set(data);
          },
          async delete() {
            if (Array.isArray(store[name])) {
              const i = store[name].findIndex((r) => r.id === id);
              if (i >= 0) store[name].splice(i, 1);
            } else delete store[name][id];
          },
        };
      },
      async add(data) {
        if (!Array.isArray(store[name])) throw new Error('add non supportato');
        add += 1;
        const id = `${name}_mem_${add}`;
        store[name].push({ id, ...data });
        return { id };
      },
    };
  }
  return { collection, __store: store };
}

// ── Caller MOCK: risposte deterministiche dal file fixture ──────────────────
function mockCaller(casoId) {
  const seq = (MOCK_OUTPUTS[casoId] || []).slice();
  let i = 0;
  return async () => {
    const text = seq[Math.min(i, seq.length - 1)];
    i += 1;
    // `meta` sintetico: la pipeline diagnostica è così testabile anche in mock.
    return {
      text,
      model: 'mock-6b',
      meta: {
        stopReason: 'end_turn',
        usage: { input_tokens: 0, output_tokens: 0 },
        blockTypes: ['text'],
        length: typeof text === 'string' ? text.length : 0,
      },
    };
  };
}

// ── Riduzione SICURA di un errore del provider (SOLO campi non sensibili) ────
// DEV-ONLY. Estrae dall'errore SDK/API di Anthropic un oggetto piatto con i
// soli campi innocui, PRIMA che il core lo trasformi in AppError('unavailable').
// Non serializza MAI: API key, Authorization, headers completi, request/body,
// variabili d'ambiente, stack trace.
const SECRET_RX = /sk-ant-[A-Za-z0-9_-]{4,}|Bearer\s+[A-Za-z0-9._\-]{8,}/gi;
export function safeProviderError(err) {
  if (err == null) return null;
  // scrub: taglia a 500 char e redige eventuali token tipo API key nel testo
  // libero (i messaggi d'errore Anthropic NON contengono la chiave, ma è una
  // difesa in profondità sul campo `message`).
  const scrub = (v) => (v == null ? null : String(v).replace(SECRET_RX, '[REDACTED]').slice(0, 500));
  if (typeof err !== 'object') return { message: scrub(err) };
  const cap = (v) => (v == null ? null : String(v).slice(0, 500));
  const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const inner = err.error && typeof err.error === 'object' && !Array.isArray(err.error) ? err.error : null;
  const cause = err.cause && typeof err.cause === 'object' && !Array.isArray(err.cause) ? err.cause : null;

  let status = numOrNull(err.status);
  if (status == null) status = numOrNull(err.statusCode);

  // request-id: solo la stringa, mai l'oggetto headers per intero
  let requestId = (typeof err.request_id === 'string' && err.request_id)
    || (typeof err.requestId === 'string' && err.requestId) || null;
  if (!requestId && err.headers) {
    try {
      if (typeof err.headers.get === 'function') {
        requestId = err.headers.get('request-id') || err.headers.get('x-request-id') || null;
      } else if (typeof err.headers === 'object' && !Array.isArray(err.headers)) {
        requestId = err.headers['request-id'] || err.headers['x-request-id'] || null;
      }
    } catch (_) { /* noop */ }
  }

  return {
    name: err.name || (err.constructor && err.constructor.name) || null,
    status,
    code: typeof err.code === 'string' ? cap(err.code) : null,
    type: (inner && typeof inner.type === 'string' && cap(inner.type))
      || (typeof err.type === 'string' && cap(err.type)) || null,
    message: scrub(err.message),
    apiType: inner && typeof inner.type === 'string' ? cap(inner.type) : null,
    apiMessage: inner && typeof inner.message === 'string' ? scrub(inner.message) : null,
    requestId: requestId ? cap(requestId) : null,
    causeName: cause && cause.name ? String(cause.name) : null,
    causeCode: cause && typeof cause.code === 'string' ? cap(cause.code) : null,
    causeMessage: cause ? scrub(cause.message) : null,
  };
}

// ── Caller REALE: usa SOLO process.env.ANTHROPIC_API_KEY, mai loggata ───────
function realCaller(timings) {
  // `@anthropic-ai/sdk` è una dipendenza di functions/: risolvila ancorando il
  // require alla cartella functions/, così --real funziona anche da repo root.
  const functionsRequire = createRequire(new URL('../functions/schedaD.js', import.meta.url));
  const Anthropic = functionsRequire('@anthropic-ai/sdk');
  const schedaD = require('../functions/schedaD.js'); // riusa il request builder di produzione
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || typeof key !== 'string' || key.length < 10) {
    throw new Error('modalita --real richiesta ma process.env.ANTHROPIC_API_KEY non e impostata');
  }
  const client = new Anthropic({ apiKey: key });
  return async ({ system, messages }) => {
    const req = schedaD._costruisciRequestAnthropic({ system, messages });
    const t0 = Date.now();
    let resp;
    try {
      resp = await client.messages.create(req);
    } catch (err) {
      // Rilancia l'errore SDK GREZZO: la riduzione a campi sicuri
      // (safeProviderError) avviene in un unico punto nel wrapper di runCase,
      // prima che il core lo converta in AppError('unavailable').
      throw err;
    }
    timings.push(Date.now() - t0);
    const text = (resp && Array.isArray(resp.content) ? resp.content : [])
      .filter((b) => b && b.type === 'text').map((b) => b.text).join('');
    return {
      text,
      model: (resp && resp.model) || schedaD._MODELLO_AI,
      // SOLO metadati non sensibili: nessuna chiave, nessun prompt di sistema.
      meta: {
        stopReason: resp && resp.stop_reason,
        usage: resp && resp.usage,                       // input_tokens / output_tokens
        blockTypes: ((resp && resp.content) || []).map((b) => b && b.type),
        length: text.length,
      },
    };
  };
}

// ── Esecuzione di UN caso ──────────────────────────────────────────────────
// `caller` (DEV-ONLY, test): override del client modello. Se assente si usa il
// mock o il caller reale a seconda di `real`.
export async function runCase(caso, { real = false, caller = null } = {}) {
  const minorId = caso.a.minorId;
  const comunitaId = COMUNITA_COLLAUDO;
  const uid = 'op-collaudo';

  const db = makeFakeDb({
    utenti: { [minorId]: { comunitaId } },
    staff: { [uid]: { ruolo: 'coordinatrice', comunitaId } },
    ppu_schede_a: [caso.a],
    ppu_schede_b: [caso.b],
    ppu_schede_c: [caso.c],
  });

  // Intercetta le chiamate al modello per poter ricalcolare, a posteriori,
  // validazione strutturale e semantica di OGNI tentativo.
  const rawResponses = [];
  const timings = [];
  const diag = { providerError: null }; // catturato PRIMA della conversione in AppError
  const inner = caller || (real ? realCaller(timings) : mockCaller(caso.id));
  const chiamaModello = async (args) => {
    let res;
    try {
      res = await inner(args);
    } catch (err) {
      // unico punto di riduzione sicura dell'errore del provider
      diag.providerError = safeProviderError(err);
      throw err; // il core lo trasformerà in AppError('unavailable') — invariato
    }
    rawResponses.push({ text: res && res.text, meta: (res && res.meta) || null });
    return res;
  };

  let result = null;
  let error = null;
  const t0 = Date.now();
  try {
    result = await core.eseguiGenerazione({
      db, auth: { uid }, data: { minorId, comunitaId, ppuMoment: 'ingresso' },
      chiamaModello, modelloAIdefault: real ? 'claude-sonnet-5' : 'mock-6b',
      serverTimestamp: () => new Date(), now: () => Date.now(),
      logger: { info() {}, warn() {}, error() {} }, // silenzioso: nessun leak
    });
  } catch (e) {
    error = e;
  }
  const durataTotaleMs = Date.now() - t0;

  // Ricostruzione del payload REALE (una sola terna A/B/C ⇒ è quella del caso)
  const payload = core.costruisciPayload({ a: caso.a, b: caso.b, c: caso.c, ppuMoment: 'ingresso', ppuMomentNote: '' });
  const tentativi = rawResponses.map((rec, idx) => {
    const raw = rec.text;
    const meta = rec.meta || {};
    const parsed = core.estraiJson(raw);
    // errore diretto di JSON.parse sul testo grezzo (solo se estraiJson fallisce)
    let jsonParseError = null;
    if (!parsed && typeof raw === 'string') {
      try { JSON.parse(raw.trim()); } catch (e) { jsonParseError = String(e && e.message || e).slice(0, 300); }
    }
    const strutturale = parsed ? core.validaOutputAI(parsed) : ["output non e un JSON valido"];
    const fonti = parsed ? core.verificaFontiSemantica(parsed, payload) : [];
    return {
      n: idx + 1,
      jsonValido: parsed != null,
      // ── diagnostica FASE 3B (casi SINTETICI: nessuna PII, solo report DEV locale) ──
      stopReason: meta.stopReason ?? null,
      usage: meta.usage ?? null,                 // { input_tokens, output_tokens }
      blockTypes: meta.blockTypes ?? null,
      rawLength: typeof raw === 'string' ? raw.length : null,
      rawTail: typeof raw === 'string' ? raw.slice(-400) : null,
      jsonParseError,
      rawText: typeof raw === 'string' ? raw : null,
      // ──────────────────────────────────────────────────────────────────────────────
      erroriStrutturali: strutturale,
      erroriFonti: fonti,
      raw: parsed, // oggetto (mai la chiave, mai testo di sistema)
    };
  });

  const dDoc = db.__store.ppu_schede_d[0] || null; // fake store: NON è Firestore
  const contenutoAI = dDoc ? dDoc.contenutoAI : (result ? null : null);
  const chiavi = (contenutoAI && Array.isArray(contenutoAI.chiaviPsicoPedagogiche))
    ? contenutoAI.chiaviPsicoPedagogiche : [];

  return {
    casoId: caso.id,
    titolo: caso.titolo,
    ok: !error,
    errore: error ? {
      code: error.code || null,
      message: String(error.message || '').slice(0, 200), // messaggio PUBBLICO, invariato
    } : null,
    // DEV-ONLY: il vero errore del provider ridotto ai soli campi sicuri
    // (mai chiave/Authorization/headers/request). null se non è stato un errore
    // provider o se la generazione è andata a buon fine.
    providerError: diag.providerError || (error && error.providerError) || null,
    numeroTentativi: dDoc ? dDoc.tentativiGenerazione : tentativi.length,
    promptVersion: dDoc ? dDoc.promptVersion : null,
    tentativi,
    chiaviPsicoPedagogiche: chiavi.map((k, i) => ({
      indice: i,
      ambito: k.ambito,
      pilastro: k.pilastro ?? null,
      autore: k.riferimentoTeorico && k.riferimentoTeorico.autore,
      teoria: k.riferimentoTeorico && k.riferimentoTeorico.teoria,
      concetto: k.riferimentoTeorico && k.riferimentoTeorico.concetto,
      spiegazione: k.riferimentoTeorico && k.riferimentoTeorico.spiegazione,
      configurazioneOsservata: k.configurazioneOsservata,
      questioneEducativa: k.questioneEducativa,
      pertinenzaNelCaso: k.pertinenzaNelCaso,
      limitiDellaLettura: k.limitiDellaLettura,
      lettureAlternative: k.lettureAlternative || [],
      elementiDaOsservare: k.elementiDaOsservare || [],
      domandeEquipe: k.domandeEquipe || [],
      fonti: k.fonti || [],
    })),
    numeroChiavi: chiavi.length,
    firestoreWrites: 0, // fake db in-memory: sempre 0 scritture reali
    durataTotaleMs,
    tempiChiamataMs: timings.slice(),
  };
}

// ── Runner CLI ─────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const a = { real: false, json: null, case: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--real') a.real = true;
    else if (argv[i] === '--json') a.json = argv[++i];
    else if (argv[i] === '--case') a.case = argv[++i];
  }
  return a;
}

function stampaCaso(r) {
  const line = (s = '') => process.stdout.write(s + '\n');
  line(`\n════════ ${r.casoId} — ${r.titolo}`);
  line(` esito generazione : ${r.ok ? 'OK' : 'ERRORE ' + (r.errore && r.errore.code)}`);
  if (r.providerError) {
    const p = r.providerError;
    line(` providerError     : name=${p.name} status=${p.status} code=${p.code} type=${p.type} requestId=${p.requestId}`);
    if (p.apiType || p.apiMessage) line(`   api             : ${p.apiType} — ${p.apiMessage}`);
    if (p.message) line(`   message         : ${p.message}`);
    if (p.causeCode || p.causeMessage) line(`   cause           : ${p.causeName}/${p.causeCode} — ${p.causeMessage}`);
  }
  line(` tentativi         : ${r.numeroTentativi}   promptVersion: ${r.promptVersion}`);
  r.tentativi.forEach((t) => {
    line(`  · tentativo ${t.n}: json=${t.jsonValido} struttura=${t.erroriStrutturali.length === 0 ? 'ok' : t.erroriStrutturali.length + ' err'} fonti=${t.erroriFonti.length === 0 ? 'ok' : t.erroriFonti.length + ' err'}`);
    const u = t.usage || {};
    line(`      stop_reason=${t.stopReason}  input_tokens=${u.input_tokens ?? '?'}  output_tokens=${u.output_tokens ?? '?'}  rawLength=${t.rawLength}  blocks=${JSON.stringify(t.blockTypes)}`);
    if (t.jsonParseError) line(`      JSON.parse: ${t.jsonParseError}`);
    if (!t.jsonValido && t.rawTail != null) line(`      ultimi 400 char: …${t.rawTail}`);
    if (t.erroriStrutturali.length) line(`      struttura: ${t.erroriStrutturali.slice(0, 3).join(' | ')}`);
    if (t.erroriFonti.length) line(`      fonti: ${t.erroriFonti.slice(0, 3).join(' | ')}`);
  });
  line(` chiavi psico-pedagogiche: ${r.numeroChiavi}`);
  r.chiaviPsicoPedagogiche.forEach((k) => {
    line(`  [${k.indice}] ambito=${k.ambito} pilastro=${k.pilastro}`);
    line(`      autore   : ${k.autore}`);
    line(`      teoria   : ${k.teoria}`);
    line(`      concetto : ${k.concetto}`);
    line(`      config.  : ${String(k.configurazioneOsservata).slice(0, 160)}`);
    line(`      pertinenza: ${String(k.pertinenzaNelCaso).slice(0, 160)}`);
    line(`      limiti   : ${String(k.limitiDellaLettura).slice(0, 160)}`);
    line(`      osservare: ${k.elementiDaOsservare.map((s) => '• ' + s).join('  ')}`);
    line(`      domande  : ${k.domandeEquipe.map((s) => '• ' + s).join('  ')}`);
    line(`      fonti    : ${k.fonti.map((f) => `${f.scheda}:${f.pilastro}:${f.elementoId}`).join(', ')}`);
  });
  line(` firestore writes : ${r.firestoreWrites}`);
  if (r.tempiChiamataMs.length) line(` tempi chiamata ms: ${r.tempiChiamataMs.join(', ')}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // --case accetta uno o più id separati da virgola (es. caso1_...,caso5_...)
  const ids = args.case ? String(args.case).split(',').map((s) => s.trim()).filter(Boolean) : null;
  const casi = ids ? CASI.filter((c) => ids.includes(c.id)) : CASI;
  if (!casi.length) { process.stderr.write(`caso sconosciuto: ${args.case}\n`); process.exit(2); }

  process.stdout.write(`Passo 6B — harness (${args.real ? 'MODELLO REALE' : 'MOCK'}) — ${casi.length} caso/i\n`);
  process.stdout.write(`SYSTEM_PROMPT: ${core.SYSTEM_PROMPT.length} caratteri · PROMPT_VERSION=${core.PROMPT_VERSION}\n`);

  const out = [];
  for (const c of casi) {
    const r = await runCase(c, { real: args.real });
    out.push(r);
    stampaCaso(r);
  }

  const totWrites = out.reduce((s, r) => s + r.firestoreWrites, 0);
  process.stdout.write(`\n──────── scritture Firestore totali: ${totWrites} (atteso: 0)\n`);

  if (args.json) {
    mkdirSync(dirname(args.json), { recursive: true });
    writeFileSync(args.json, JSON.stringify(out, null, 2), 'utf8'); // nessuna chiave nell'oggetto
    process.stdout.write(`report JSON: ${args.json}\n`);
  }
}

export const COME_ESEGUIRE_SENZA_ESPORRE_IL_SECRET = `
Collaudo con modello reale senza mai stampare/scrivere la chiave:

  # la chiave resta in una variabile di shell, non a video, non su file:
  ANTHROPIC_API_KEY="$(firebase functions:secrets:access ANTHROPIC_API_KEY --project campo-dei-fiori 2>/dev/null)" \\
    node tests/ppu-scheda-d.6b-harness.mjs --real --json tests/.out/6b-real.json

  # in alternativa, se hai gia la chiave in un password manager / .env NON versionato:
  #   set -a; source ./functions/.env.local; set +a
  #   node tests/ppu-scheda-d.6b-harness.mjs --real

Note:
  • l'harness legge SOLO process.env.ANTHROPIC_API_KEY e non la stampa mai;
  • non crea documenti Firestore (db fake in-memory);
  • 'tests/**' e' escluso dall'hosting: nessun file di collaudo raggiunge il frontend.
`;

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { process.stderr.write(String(e && e.message || e) + '\n'); process.exit(1); });
}
