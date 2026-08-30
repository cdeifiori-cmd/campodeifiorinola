// tests/ppu-scheda-d.6b.test.mjs — DEV-ONLY (Passo 6B).
// Verifica le fixture di collaudo e le proprietà di sicurezza dell'harness.
// NESSUNA chiamata reale al modello: si usa esclusivamente la modalità MOCK.
//   node --test tests/ppu-scheda-d.6b.test.mjs

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CASI, INDICATORI, COMUNITA_COLLAUDO } from './fixtures/ppu-scheda-d.6b-cases.mjs';
import { MOCK_OUTPUTS } from './fixtures/ppu-scheda-d.6b-mock-outputs.mjs';
import { runCase, makeFakeDb, parseArgs, safeProviderError } from './ppu-scheda-d.6b-harness.mjs';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const HARNESS_SRC = src('./ppu-scheda-d.6b-harness.mjs');
const CASES_SRC = src('./fixtures/ppu-scheda-d.6b-cases.mjs');
const MOCK_SRC = src('./fixtures/ppu-scheda-d.6b-mock-outputs.mjs');

const AUTORI = [
  'Bandura', 'Vygotskij', 'Vygotsky', 'Bronfenbrenner', 'Erikson', 'Marcia', 'Deci', 'Ryan',
  'Rogers', 'Bowlby', 'Mead', 'Cooley', 'Dewey', 'Bruner', 'Freire', 'Kohlberg', 'Stern',
  'Lazarus', 'Folkman', 'Winnicott', 'Gardner', 'Antonovsky', 'Seligman',
];
const TERMINI_TEORICI = [
  'autoefficacia', 'self-efficacy', 'scaffolding', 'zona di sviluppo prossimale', 'ZPD',
  'attaccamento', 'resilienza', 'autodeterminazione', 'self-determination',
  'apprendimento sociale', 'immagine riflessa del sé', 'looking-glass', 'senso di coerenza',
  'intelligenze multiple', 'stadi psicosociali', 'identity status', 'locus of control',
];

const datiCaso = (c) => JSON.stringify({ a: c.a, b: c.b, c: c.c }); // SOLO i dati, non note/titolo

describe('Passo 6B · fixture: i 6 casi', () => {
  test('sono esattamente 6, con id univoci e struttura A/B/C', () => {
    assert.equal(CASI.length, 6);
    assert.equal(new Set(CASI.map((c) => c.id)).size, 6);
    for (const c of CASI) {
      for (const s of ['a', 'b', 'c']) {
        assert.ok(c[s] && typeof c[s] === 'object', `${c.id}.${s}`);
        assert.equal(c[s].status, 'completata');
        assert.equal(c[s].ppuMoment, 'ingresso');
        assert.equal(c[s].comunitaId, COMUNITA_COLLAUDO);
      }
      assert.ok(c.a.closing && typeof c.a.closing === 'object');
      assert.ok(c.c.sociogrammi && c.c.sociogrammi.vicinanza && c.c.sociogrammi.fatica);
    }
  });

  test('indicatori A/B formalmente compatibili: chiavi valide, scala NO/1/2/3', () => {
    for (const c of CASI) {
      for (const scheda of [c.a, c.b]) {
        for (const [k, v] of Object.entries(scheda.risposte)) {
          assert.ok(INDICATORI.includes(k), `${c.id}: indicatore sconosciuto ${k}`);
          assert.ok(v === 'NO' || v === 1 || v === 2 || v === 3, `${c.id}.${k} = ${v} fuori scala`);
        }
      }
    }
  });

  test('casi 1–4 e 6: tutti e 18 gli indicatori presenti in A e B', () => {
    for (const c of CASI.filter((x) => x.id !== 'caso5_dati_poveri')) {
      for (const scheda of [c.a, c.b]) {
        assert.deepEqual(Object.keys(scheda.risposte).sort(), [...INDICATORI].sort(), c.id);
      }
    }
  });

  test('almeno un elemento C (nodo non-centro) in ogni caso; fonti C citabili con id stabili', () => {
    for (const c of CASI) {
      const vic = c.c.sociogrammi.vicinanza.nodes.filter((n) => n.id !== 'io');
      assert.ok(vic.length >= 1, `${c.id}: nessun nodo C`);
      for (const n of [...vic, ...c.c.sociogrammi.fatica.nodes.filter((x) => x.id !== 'io')]) {
        assert.match(n.id, /^n_[a-z0-9_]+$/, `${c.id}: id nodo non stabile ${n.id}`);
        assert.ok(typeof n.name === 'string' && n.name.trim().length > 0);
      }
      for (const e of [...c.c.sociogrammi.vicinanza.edges, ...c.c.sociogrammi.fatica.edges]) {
        assert.match(e.id, /^e_[a-z0-9_]+$/, `${c.id}: id arco non stabile ${e.id}`);
        assert.ok(['forward', 'backward', 'both'].includes(e.direction));
        assert.ok(['green', 'yellow', 'red', 'grey'].includes(e.quality));
      }
    }
  });

  test('nessun nome/persona reale: nomi fittizi semplici', () => {
    for (const c of CASI) {
      const nodi = [...c.c.sociogrammi.vicinanza.nodes, ...c.c.sociogrammi.fatica.nodes];
      for (const n of nodi) {
        assert.match(n.name, /^[A-Za-zÀ-ÿ.\s]{1,16}$/, `${c.id}: nome sospetto "${n.name}"`);
      }
    }
  });

  test('NESSUN autore o teoria scritto nei dati A/B/C', () => {
    for (const c of CASI) {
      const blob = datiCaso(c);
      for (const a of AUTORI) {
        assert.ok(!new RegExp(`\\b${a}\\b`, 'i').test(blob), `${c.id}: compare l'autore ${a}`);
      }
      for (const t of TERMINI_TEORICI) {
        assert.ok(!blob.toLowerCase().includes(t.toLowerCase()), `${c.id}: compare il termine teorico "${t}"`);
      }
    }
  });

  test('nessuna diagnosi / etichetta clinica incorporata nei dati', () => {
    const CLIN = ['disturbo', 'diagnosi', 'sindrome', 'ADHD', 'DSA', 'trauma', 'depress', 'ansi', 'border', 'oppositiv'];
    for (const c of CASI) {
      const blob = datiCaso(c).toLowerCase();
      for (const w of CLIN) assert.ok(!blob.includes(w.toLowerCase()), `${c.id}: etichetta clinica "${w}"`);
    }
  });
});

describe('Passo 6B · Caso 5 effettivamente povero', () => {
  const c5 = CASI.find((c) => c.id === 'caso5_dati_poveri');
  test('prevalenza netta di NO / risposte mancanti in A e B', () => {
    let noOrMissing = 0;
    for (const scheda of [c5.a, c5.b]) {
      for (const id of INDICATORI) {
        const v = scheda.risposte[id];
        if (v === undefined || v === 'NO') noOrMissing += 1;
      }
    }
    assert.ok(noOrMissing >= 26, `NO+mancanti = ${noOrMissing} (atteso >= 26 su 36)`);
  });
  test('C scarna: <= 1 nodo di vicinanza, nessun legame; closing vuote', () => {
    assert.ok(c5.c.sociogrammi.vicinanza.nodes.filter((n) => n.id !== 'io').length <= 1);
    assert.equal(c5.c.sociogrammi.vicinanza.edges.length + c5.c.sociogrammi.fatica.edges.length, 0);
    assert.equal([c5.a.closing.perceivedStrength, c5.a.closing.desiredImprovement, c5.a.closing.chosenGrowthArea].join('').trim(), '');
  });
});

describe('Passo 6B · Caso 6 effettivamente trasversale', () => {
  const c6 = CASI.find((c) => c.id === 'caso6_trasversale');
  test('la configurazione attraversa >= 4 pilastri con indicatori informativi in A e B', () => {
    const informativi = new Set();
    for (const id of INDICATORI) {
      const va = c6.a.risposte[id];
      const vb = c6.b.risposte[id];
      const info = (x) => x === 1 || x === 2 || x === 3;
      if (info(va) && info(vb)) informativi.add(id.split('_')[0]);
    }
    assert.ok(informativi.size >= 4, `pilastri toccati = ${informativi.size}`);
  });
  test('contrasto noto/nuovo + almeno un blocco su iniziativa/progetto/aiuto', () => {
    assert.ok(c6.a.risposte.others_02 >= 3 && c6.a.risposte.others_01 <= 1, 'gruppo noto vs gruppo nuovo');
    assert.ok([c6.a.risposte.expression_03, c6.a.risposte.future_03, c6.a.risposte.self_03].some((v) => v <= 1));
    assert.match(c6.a.closing.desiredImprovement + ' ' + c6.a.closing.chosenGrowthArea, /fuori dalla squadra|gruppi nuovi|gruppo di sempre/i);
  });
});

describe('Passo 6B · harness: sicurezza e nessuna scrittura Firestore', () => {
  test('l\'harness non importa firebase-admin né apre Firestore reale', () => {
    for (const s of [HARNESS_SRC, CASES_SRC, MOCK_SRC]) {
      assert.ok(!/firebase-admin/.test(s));
      assert.ok(!/getFirestore|initializeApp\(|admin\.firestore/.test(s));
    }
  });

  test('runCase (MOCK) sui 6 casi: 0 scritture Firestore, pipeline reale attraversata', async () => {
    for (const c of CASI) {
      const r = await runCase(c, { real: false });
      assert.equal(r.firestoreWrites, 0, `${c.id}`);
      assert.equal(r.promptVersion, 4, `${c.id}`);
      // ultimo tentativo: struttura e fonti valide (fonti dei casi semanticamente citabili)
      const ultimo = r.tentativi[r.tentativi.length - 1];
      assert.deepEqual(ultimo.erroriStrutturali, [], `${c.id} struttura`);
      assert.deepEqual(ultimo.erroriFonti, [], `${c.id} fonti`);
    }
  });

  test('retry esercitato dove il mock lo prevede (caso 3)', async () => {
    const r = await runCase(CASI.find((c) => c.id === 'caso3_scaffolding_autonomia'), { real: false });
    assert.equal(r.numeroTentativi, 2);
    assert.equal(r.tentativi[0].erroriStrutturali.length > 0, true);
    assert.equal(r.tentativi[1].erroriStrutturali.length, 0);
  });

  test('caso 5 (dati poveri): output valido con 0 chiavi', async () => {
    const r = await runCase(CASI.find((c) => c.id === 'caso5_dati_poveri'), { real: false });
    assert.equal(r.ok, true);
    assert.equal(r.numeroChiavi, 0);
  });

  test('caso 6: mock produce almeno una chiave con ambito trasversale / pilastro null', async () => {
    const r = await runCase(CASI.find((c) => c.id === 'caso6_trasversale'), { real: false });
    assert.ok(r.chiaviPsicoPedagogiche.some((k) => k.ambito === 'trasversale' && k.pilastro === null));
  });
});

describe('Passo 6B · la API key non compare mai in output/log', () => {
  test('nel sorgente dell\'harness la chiave non viene loggata né serializzata', () => {
    assert.ok(!/console\.\w+\([^)]*ANTHROPIC_API_KEY/.test(HARNESS_SRC));
    assert.ok(!/(writeFileSync|stdout\.write|stderr\.write|JSON\.stringify)\([^)]*\b(apiKey|ANTHROPIC_API_KEY)\b/i.test(HARNESS_SRC));
    // la key è usata solo per costruire il client
    assert.match(HARNESS_SRC, /new Anthropic\(\{ apiKey: key \}\)/);
  });

  test('un giro MOCK non emette nulla che assomigli a un secret', async () => {
    const results = [];
    for (const c of CASI) results.push(await runCase(c, { real: false }));
    const blob = JSON.stringify(results);
    assert.ok(!/sk-ant-/.test(blob));
    assert.ok(!/ANTHROPIC_API_KEY\s*=/.test(blob));
    assert.ok(!/api[_-]?key/i.test(blob));
  });
});

describe('Passo 6B · nessun file dev-only verso il frontend pubblico', () => {
  test('tutte le fixture/harness/test 6B vivono sotto tests/ (escluso dall\'hosting)', () => {
    const fb = JSON.parse(readFileSync(fileURLToPath(new URL('../firebase.json', import.meta.url)), 'utf8'));
    const ign = fb.hosting.ignore.join('\n');
    assert.ok(/(^|\n)tests\/\*\*($|\n)|(^|\n)tests($|\n)/.test(ign), 'firebase.json hosting.ignore deve escludere tests/');
    for (const f of [
      'tests/fixtures/ppu-scheda-d.6b-cases.mjs',
      'tests/fixtures/ppu-scheda-d.6b-mock-outputs.mjs',
      'tests/ppu-scheda-d.6b-harness.mjs',
      'tests/ppu-scheda-d.6b.test.mjs',
    ]) {
      assert.ok(f.startsWith('tests/'), f);
    }
  });
});

describe('Passo 6C · FASE 3B — diagnostica dell\'harness', () => {
  test('parseArgs: --case / --real / --json', () => {
    assert.deepEqual(parseArgs(['--case', 'caso1_discrepanza_ab']), { real: false, json: null, case: 'caso1_discrepanza_ab' });
    assert.deepEqual(parseArgs(['--real', '--json', 'tests/.out/x.json']), { real: true, json: 'tests/.out/x.json', case: null });
    assert.deepEqual(parseArgs([]), { real: false, json: null, case: null });
  });

  test('selezione singolo caso: runCase gira un caso solo, senza toccare gli altri', async () => {
    const r = await runCase(CASI.find((c) => c.id === 'caso1_discrepanza_ab'), { real: false });
    assert.equal(r.casoId, 'caso1_discrepanza_ab');
    assert.equal(r.firestoreWrites, 0);
  });

  test('cattura metadati per ogni tentativo (mock): stop_reason, usage, blockTypes, rawLength, rawText', async () => {
    for (const c of CASI) {
      const r = await runCase(c, { real: false });
      for (const t of r.tentativi) {
        assert.ok('stopReason' in t && t.stopReason, `${c.id}#${t.n} stopReason`);
        assert.ok(t.usage && typeof t.usage === 'object' && 'input_tokens' in t.usage && 'output_tokens' in t.usage, `${c.id}#${t.n} usage`);
        assert.ok(Array.isArray(t.blockTypes) && t.blockTypes.length >= 1, `${c.id}#${t.n} blockTypes`);
        assert.equal(typeof t.rawLength, 'number', `${c.id}#${t.n} rawLength`);
        assert.equal(typeof t.rawText, 'string', `${c.id}#${t.n} rawText`);
        assert.ok('rawTail' in t && 'jsonParseError' in t, `${c.id}#${t.n} campi diagnostici`);
      }
    }
  });

  test('ramo diagnostico JSON troncato: estraiJson→null, JSON.parse lancia (come in FASE 3B)', async () => {
    const core = (await import('../functions/schedaDCore.js')).default;
    const troncato = '{"sintesiGenerale":"x","pilastri":[{"pilastro":"self","comeMiVedo":"y';
    assert.equal(core.estraiJson(troncato), null, 'output troncato non è recuperabile dal parser di produzione');
    let err = null;
    try { JSON.parse(troncato.trim()); } catch (e) { err = String(e.message); }
    assert.ok(err && /JSON|Unexpected|Unterminated/i.test(err), 'JSON.parse fornisce un messaggio diagnostico');
    // fence + prosa attorno a JSON COMPLETO restano invece recuperabili (non è il caso 6B)
    assert.deepEqual(core.estraiJson('```json\n{"a":1}\n```\nSpero sia utile.'), { a: 1 });
  });

  test('mock mode invariato: 6 casi, 0 scritture Firestore, promptVersion 4, ultimo tentativo valido', async () => {
    for (const c of CASI) {
      const r = await runCase(c, { real: false });
      assert.equal(r.firestoreWrites, 0, c.id);
      assert.equal(r.promptVersion, 4, c.id);
      const ultimo = r.tentativi[r.tentativi.length - 1];
      assert.deepEqual(ultimo.erroriStrutturali, [], `${c.id} struttura`);
      assert.deepEqual(ultimo.erroriFonti, [], `${c.id} fonti`);
    }
  });

  test('la diagnostica non introduce leak: nessun secret nell\'output arricchito', async () => {
    const results = [];
    for (const c of CASI) results.push(await runCase(c, { real: false }));
    const blob = JSON.stringify(results);
    assert.ok(!/sk-ant-/.test(blob));
    assert.ok(!/ANTHROPIC_API_KEY/.test(blob));
    assert.ok(!/\bapiKey\b/.test(blob));
  });

  test('realCaller cattura stop_reason/usage ma MAI la chiave (controllo sorgente)', () => {
    // il blocco meta contiene solo stop_reason/usage/blockTypes/length
    assert.match(HARNESS_SRC, /stopReason:\s*resp && resp\.stop_reason/);
    assert.match(HARNESS_SRC, /usage:\s*resp && resp\.usage/);
    assert.ok(!/meta:\s*\{[^}]*\bkey\b/.test(HARNESS_SRC));
    assert.ok(!/(rawText|rawTail|meta)[^\n]*ANTHROPIC_API_KEY/.test(HARNESS_SRC));
  });
});

describe('Passo 6C · diagnostica provider error (DEV-ONLY, nessun segreto)', () => {
  const PUBBLICO = 'Il servizio di generazione non è al momento disponibile. Riprovare più tardi.';

  test('safeProviderError: APIError con status 400 → campi sicuri estratti', () => {
    const err = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"output_config: unexpected"}}'), {
      name: 'BadRequestError',
      status: 400,
      error: { type: 'invalid_request_error', message: 'output_config: unexpected keyword' },
      headers: { 'request-id': 'req_ABC123' },
    });
    const s = safeProviderError(err);
    assert.equal(s.name, 'BadRequestError');
    assert.equal(s.status, 400);
    assert.equal(s.type, 'invalid_request_error');
    assert.equal(s.apiType, 'invalid_request_error');
    assert.match(s.apiMessage, /output_config/);
    assert.equal(s.requestId, 'req_ABC123');
  });

  test('safeProviderError: errore di rete SENZA status → cause.code preservato', () => {
    const err = Object.assign(new Error('Connection error.'), {
      name: 'APIConnectionError',
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.anthropic.com'), { name: 'Error', code: 'ENOTFOUND' }),
    });
    const s = safeProviderError(err);
    assert.equal(s.status, null);
    assert.equal(s.name, 'APIConnectionError');
    assert.equal(s.causeCode, 'ENOTFOUND');
    assert.match(s.causeMessage, /ENOTFOUND/);
  });

  test('safeProviderError: NESSUN segreto serializzato', () => {
    const err = Object.assign(new Error('boom sk-ant-secret-xyz'), {
      name: 'APIError', status: 401,
      apiKey: 'sk-ant-secret-xyz',
      authorization: 'Bearer sk-ant-secret-xyz',
      headers: { authorization: 'Bearer sk-ant-secret-xyz', 'x-api-key': 'sk-ant-secret-xyz', 'request-id': 'req_Z' },
      config: { headers: { Authorization: 'Bearer sk-ant-secret-xyz' } },
      request: { body: JSON.stringify({ system: 'FULL SYSTEM PROMPT', messages: [{ content: 'DATI DEL CASO' }] }) },
      response: { data: 'DATI DEL CASO' },
      stack: 'Error: boom\n  at x (sk-ant-secret-xyz)',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
    const s = safeProviderError(err);
    const blob = JSON.stringify(s);
    // valori/segreti pericolosi: MAI presenti
    for (const bad of ['sk-ant', 'Bearer ', 'FULL SYSTEM PROMPT', 'DATI DEL CASO', '  at x (']) {
      assert.ok(!blob.includes(bad), `providerError non deve contenere "${bad}" — ${blob}`);
    }
    // il set di chiavi è FISSO e sicuro: niente headers/request/response/config/
    // apiKey/authorization/stack possono passare, per costruzione.
    assert.deepEqual(Object.keys(s).sort(), [
      'apiMessage', 'apiType', 'causeCode', 'causeMessage', 'causeName',
      'code', 'message', 'name', 'requestId', 'status', 'type',
    ]);
    for (const k of ['headers', 'request', 'response', 'config', 'apiKey', 'authorization', 'stack']) {
      assert.ok(!(k in s), `providerError non deve avere la chiave "${k}"`);
    }
    // il messaggio libero è redatto se contiene un token tipo API key
    assert.match(s.message, /\[REDACTED\]/);
    // campi utili preservati
    assert.equal(s.status, 401);
    assert.equal(s.apiType, 'authentication_error');
    assert.equal(s.requestId, 'req_Z');
  });

  test('runCase: caller che lancia APIError 400 → messaggio pubblico "unavailable" invariato, providerError sicuro nel report', async () => {
    const caller = async () => {
      throw Object.assign(new Error('400 ...'), {
        name: 'BadRequestError', status: 400,
        error: { type: 'invalid_request_error', message: 'output_config non riconosciuto' },
        headers: { 'request-id': 'req_R1' },
        apiKey: 'sk-ant-NOPE',
      });
    };
    const r = await runCase(CASI[0], { caller });
    assert.equal(r.ok, false);
    assert.equal(r.errore.code, 'unavailable');       // codice pubblico invariato
    assert.equal(r.errore.message, PUBBLICO);          // testo pubblico invariato
    assert.equal(r.numeroTentativi, 0);
    assert.ok(r.providerError, 'providerError presente nel report');
    assert.equal(r.providerError.status, 400);
    assert.equal(r.providerError.apiType, 'invalid_request_error');
    assert.match(r.providerError.apiMessage, /output_config/);
    assert.equal(r.providerError.requestId, 'req_R1');
    assert.ok(!JSON.stringify(r).includes('sk-ant'), 'nessuna chiave nel report');
  });

  test('runCase: caller con errore di rete (no status) → unavailable + providerError.causeCode', async () => {
    const caller = async () => {
      throw Object.assign(new Error('Connection error.'), {
        name: 'APIConnectionError',
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED', name: 'Error' }),
      });
    };
    const r = await runCase(CASI[0], { caller });
    assert.equal(r.errore.code, 'unavailable');
    assert.equal(r.errore.message, PUBBLICO);
    assert.equal(r.providerError.status, null);
    assert.equal(r.providerError.causeCode, 'ECONNREFUSED');
  });

  test('runCase MOCK a buon fine → providerError === null', async () => {
    const r = await runCase(CASI[0], { real: false });
    assert.equal(r.ok, true);
    assert.equal(r.providerError, null);
  });

  test('realCaller nel sorgente rilancia l\'errore grezzo e NON logga la chiave', () => {
    // la riduzione sicura è in runCase (safeProviderError), non in realCaller
    assert.match(HARNESS_SRC, /Rilancia l'errore SDK GREZZO/);
    assert.ok(!/console\.\w+\([^)]*\b(apiKey|ANTHROPIC_API_KEY|key)\b/.test(HARNESS_SRC));
    assert.match(HARNESS_SRC, /diag\.providerError = safeProviderError\(err\)/);
  });
});
