// functions/test/schedaD.test.js
// Test del motore server-side della Scheda D PPU (functions/schedaDCore.js).
//   node --test functions/test/schedaD.test.js
//
// Nessuna chiamata reale ad Anthropic, nessun emulatore: Firestore e il client
// del modello sono sostituiti da fake in-memory. functions/schedaD.js (wrapper
// onCall) è coperto solo da verifiche d'integrazione manuali: è un adattatore
// sottile su core.eseguiGenerazione.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const core = require('../schedaDCore');

// ── Costanti di scenario ──────────────────────────────────────────────
const MINOR = 'ragazzo1';
const COM = 'itaca';
const COORD = 'coord1';
const TEST_NOW = 10_000_000;

// ── Fake Firestore ───────────────────────────────────────────────────
function makeDb(seed) {
  const store = {
    utenti: { ...(seed.utenti || {}) },
    staff: { ...(seed.staff || {}) },
    ppu_schede_a: (seed.ppu_schede_a || []).slice(),
    ppu_schede_b: (seed.ppu_schede_b || []).slice(),
    ppu_schede_c: (seed.ppu_schede_c || []).slice(),
    ppu_schede_d: (seed.ppu_schede_d || []).slice(),
    ppu_schede_d_locks: { ...(seed.ppu_schede_d_locks || {}) },
  };
  let addCounter = 0;

  function rows(name) {
    const raw = store[name];
    return Array.isArray(raw) ? raw : Object.entries(raw).map(([id, d]) => ({ id, ...d }));
  }
  function snap(id, d) {
    return d
      ? { exists: true, id, data: () => { const c = { ...d }; delete c.id; return c; } }
      : { exists: false, id, data: () => undefined };
  }
  function query(name, filters) {
    return {
      where(f, _op, v) { return query(name, filters.concat([[f, v]])); },
      async get() {
        const list = rows(name).filter((r) => filters.every(([f, v]) => r[f] === v));
        return {
          empty: list.length === 0,
          docs: list.map((r) => ({ id: r.id, data: () => { const c = { ...r }; delete c.id; return c; } })),
        };
      },
    };
  }
  function collection(name) {
    const q = query(name, []);
    return {
      where: q.where,
      get: q.get,
      doc(id) {
        return {
          async get() {
            if (Array.isArray(store[name])) return snap(id, store[name].find((r) => r.id === id));
            return snap(id, store[name][id] ? { id, ...store[name][id] } : undefined);
          },
          async set(data) {
            if (Array.isArray(store[name])) {
              const i = store[name].findIndex((r) => r.id === id);
              if (i >= 0) store[name][i] = { id, ...data };
              else store[name].push({ id, ...data });
            } else {
              store[name][id] = { ...data };
            }
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
            } else {
              delete store[name][id];
            }
          },
        };
      },
      async add(data) {
        if (!Array.isArray(store[name])) throw new Error('add non supportato su collezione oggetto');
        addCounter += 1;
        const id = `${name}_gen_${addCounter}`;
        store[name].push({ id, ...data });
        return { id };
      },
    };
  }
  return { collection, __store: store };
}

// ── Fake client del modello ─────────────────────────────────────────
function makeModello(items) {
  const state = { i: 0, calls: [] };
  const fn = async ({ system, messages }) => {
    state.calls.push({ system, messages });
    const it = items[state.i] !== undefined ? items[state.i] : items[items.length - 1];
    state.i += 1;
    if (it && it.__throw) throw new Error('provider down');
    if (typeof it === 'string') return { text: it, model: 'claude-test-1' };
    // `__stopReason` (Passo 6C): simula stop_reason del provider (es. 'max_tokens')
    if (it && typeof it.text === 'string') {
      return { text: it.text, model: it.model || 'claude-test-1', stopReason: it.__stopReason };
    }
    return { text: JSON.stringify(it), model: (it && it.__model) || 'claude-test-1', stopReason: it && it.__stopReason };
  };
  return { fn, state };
}

// ── Seed di base ────────────────────────────────────────────────────
function schedaA(o = {}) {
  return {
    id: 'a1', minorId: MINOR, comunitaId: COM, status: 'completata',
    ppuMoment: 'ingresso', ppuMomentNote: '', completedAt: 1000,
    risposte: { self_01: 3, self_02: 'NO', others_01: 2 },
    closing: { perceivedStrength: 'so ascoltare gli altri', desiredImprovement: '', chosenGrowthArea: '' },
    areaNotes: { self: 'SENTINEL_AREANOTE_A' },
    ...o,
  };
}
function schedaB(o = {}) {
  return {
    id: 'b1', minorId: MINOR, comunitaId: COM, status: 'completata',
    ppuMoment: 'ingresso', ppuMomentNote: '', completedAt: 1000, instrumentVersion: 1,
    risposte: { self_01: 2, self_02: 1, others_01: 3 },
    areaNotes: { self: 'SENTINEL_AREANOTE_B' },
    ...o,
  };
}
function schedaC(o = {}) {
  return {
    id: 'c1', minorId: MINOR, comunitaId: COM, status: 'completata',
    ppuMoment: 'ingresso', ppuMomentNote: '', completedAt: 1000, instrumentVersion: 1,
    note: 'SENTINEL_C_NOTE_GENERALE',
    sociogrammi: {
      vicinanza: {
        nodes: [
          { id: 'io', isCenter: true, name: 'IO', x: 0.5, y: 0.5 },
          { id: 'n_mamma', name: 'Mamma', x: 0.42, y: 0.44, distance: 0.2, note: 'SENTINEL_C_NOTA_NODO' },
          { id: 'n_anna', name: 'Anna', x: 0.7, y: 0.6, distance: 0.4 },
        ],
        edges: [{ id: 'e_1', source: 'io', target: 'n_mamma', direction: 'both', quality: 'green' }],
      },
      fatica: {
        nodes: [
          { id: 'io', isCenter: true, name: 'IO', x: 0.5, y: 0.5 },
          { id: 'n_prof', name: 'Prof. Rossi', x: 0.6, y: 0.3, distance: 0.5 },
        ],
        edges: [],
      },
    },
    ...o,
  };
}
function baseSeed(over = {}) {
  return {
    utenti: { [MINOR]: { nome: 'Nome Cognome Test', comunitaId: COM } },
    staff: { [COORD]: { ruolo: 'Coordinatrice', comunitaId: COM } },
    ppu_schede_a: [schedaA()],
    ppu_schede_b: [schedaB()],
    ppu_schede_c: [schedaC()],
    ...over,
  };
}

// ── Output AI valido (schema + tracciabilità) ──────────────────────
function outputValido() {
  const pilastri = core.PILASTRI_ID.map((pid) => ({
    pilastro: pid,
    comeMiVedo: 'Dalla Scheda A emerge un quadro articolato per questo pilastro.',
    comeMiVedonoGliAltri: 'Dalla Scheda B emerge una lettura corrispondente.',
    elementiRete: 'La Scheda C non contiene elementi pertinenti per questo pilastro.',
    convergenzeDiscrepanze: {
      convergenze: 'A e B concordano su alcuni aspetti.',
      discrepanze: 'Si rileva una discrepanza descritta senza spiegazione.',
      datiInsufficienti: '',
    },
    letturaEducativaPossibile: 'potrebbe essere utile esplorare questo aspetto con il ragazzo.',
    aspettoDaApprofondire: 'Cosa si osserva nella vita quotidiana rispetto a questo aspetto?',
    fonti: [{ scheda: 'A', pilastro: pid, elementoId: `${pid}_01` }],
  }));
  return {
    sintesiGenerale: 'Sintesi generale sufficientemente estesa, senza giudizi globali sulla persona.',
    pilastri,
    letturaTrasversale: {
      risorse: [{ testo: 'una risorsa trasversale', fonti: [{ scheda: 'A', pilastro: 'self', elementoId: 'self_01' }] }],
      aspettiAttenzione: [{ testo: 'un aspetto trasversale', fonti: [{ scheda: 'B', pilastro: 'others', elementoId: 'others_01' }] }],
      elementiDaApprofondire: [{ testo: 'un elemento da approfondire', fonti: [{ scheda: 'A', pilastro: 'future', elementoId: 'future_01' }] }],
    },
  };
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ── Runner ─────────────────────────────────────────────────────────
async function run(opts = {}) {
  const db = makeDb(opts.seed || baseSeed());
  const m = makeModello(opts.modello || [outputValido()]);
  const logs = [];
  const logger = {
    info: (...a) => logs.push(['info', ...a]),
    warn: (...a) => logs.push(['warn', ...a]),
    error: (...a) => logs.push(['error', ...a]),
  };
  const deps = {
    db,
    auth: 'auth' in opts ? opts.auth : { uid: COORD },
    data: opts.data || { minorId: MINOR, comunitaId: COM, ppuMoment: 'ingresso' },
    chiamaModello: m.fn,
    modelloAIdefault: 'modello-default',
    serverTimestamp: () => TEST_NOW,
    now: opts.now || (() => TEST_NOW),
    logger,
  };
  let result = null;
  let error = null;
  try {
    result = await core.eseguiGenerazione(deps);
  } catch (e) {
    error = e;
  }
  return { db, store: db.__store, m, logs, result, error };
}

// ════════════════════════════════════════════════════════════════════
//  AUTENTICAZIONE / AUTORIZZAZIONE
// ════════════════════════════════════════════════════════════════════
test.describe('auth e autorizzazione', () => {
  test('utente non autenticato → unauthenticated, nessuna chiamata AI, nessuna D', async () => {
    const { error, m, store } = await run({ auth: null });
    assert.equal(error.code, 'unauthenticated');
    assert.equal(m.state.calls.length, 0);
    assert.equal(store.ppu_schede_d.length, 0);
  });

  test('staff non coord e senza accessoDocumenti → permission-denied', async () => {
    const seed = baseSeed({ staff: { [COORD]: { ruolo: 'educatore', comunitaId: COM } } });
    const { error, m } = await run({ seed });
    assert.equal(error.code, 'permission-denied');
    assert.equal(m.state.calls.length, 0);
  });

  test('staff con accessoDocumenti per la comunità → autorizzato', async () => {
    const seed = baseSeed({ staff: { u2: { ruolo: 'educatore', comunitaId: COM, accessoDocumenti: true } } });
    const { error, result } = await run({ seed, auth: { uid: 'u2' } });
    assert.equal(error, null);
    assert.equal(result.stato, 'GENERATA');
  });

  test('admin (uid legacy) → autorizzato anche senza doc staff', async () => {
    const seed = baseSeed({ staff: {} });
    const { error, result } = await run({ seed, auth: { uid: core.ADMIN_UID } });
    assert.equal(error, null);
    assert.equal(result.stato, 'GENERATA');
  });

  test('coord di un\'altra comunità → permission-denied', async () => {
    const seed = baseSeed({ staff: { [COORD]: { ruolo: 'coordinatrice', comunitaId: 'macrame' } } });
    const { error } = await run({ seed });
    assert.equal(error.code, 'permission-denied');
  });

  test('verificaAccessoPPU: casi diretti', async () => {
    const db = makeDb(baseSeed({
      staff: {
        cx: { ruolo: 'Responsabile', comunitaId: [COM, 'macrame'] },
        dx: { ruolo: 'educatore', comunitaId: COM, accessoDocumenti: false },
      },
    }));
    assert.equal(await core.verificaAccessoPPU(db, core.ADMIN_UID, COM), true);
    assert.equal(await core.verificaAccessoPPU(db, 'cx', COM), true);
    assert.equal(await core.verificaAccessoPPU(db, 'cx', 'nope'), false);
    assert.equal(await core.verificaAccessoPPU(db, 'dx', COM), false);
    assert.equal(await core.verificaAccessoPPU(db, 'ignoto', COM), false);
    assert.equal(await core.verificaAccessoPPU(db, null, COM), false);
  });
});

// ════════════════════════════════════════════════════════════════════
//  INPUT / COERENZA RAGAZZO-COMUNITÀ
// ════════════════════════════════════════════════════════════════════
test.describe('input e coerenza', () => {
  test('momento non valido → invalid-argument', async () => {
    const { error } = await run({ data: { minorId: MINOR, comunitaId: COM, ppuMoment: 'boh' } });
    assert.equal(error.code, 'invalid-argument');
  });

  test('altro senza descrizione → invalid-argument', async () => {
    const { error } = await run({ data: { minorId: MINOR, comunitaId: COM, ppuMoment: 'altro' } });
    assert.equal(error.code, 'invalid-argument');
  });

  test('client che invia sourceAId → invalid-argument', async () => {
    const { error, m } = await run({
      data: { minorId: MINOR, comunitaId: COM, ppuMoment: 'ingresso', sourceAId: 'a1' },
    });
    assert.equal(error.code, 'invalid-argument');
    assert.equal(m.state.calls.length, 0);
  });

  test('minorId/comunitaId mancanti → invalid-argument', async () => {
    const { error } = await run({ data: { ppuMoment: 'ingresso' } });
    assert.equal(error.code, 'invalid-argument');
  });

  test('ragazzo inesistente → failed-precondition', async () => {
    const { error } = await run({ seed: baseSeed({ utenti: {} }) });
    assert.equal(error.code, 'failed-precondition');
    assert.match(error.message, /non è stato trovato/);
  });

  test('ragazzo di un\'altra comunità → failed-precondition', async () => {
    const seed = baseSeed({ utenti: { [MINOR]: { comunitaId: 'macrame' } } });
    const { error } = await run({ seed });
    assert.equal(error.code, 'failed-precondition');
    assert.match(error.message, /non appartiene alla comunità/);
  });
});

// ════════════════════════════════════════════════════════════════════
//  SELEZIONE AUTOREVOLE DELLE FONTI
// ════════════════════════════════════════════════════════════════════
test.describe('selezione fonti', () => {
  test('manca A → failed-precondition, nessuna chiamata AI', async () => {
    const { error, m } = await run({ seed: baseSeed({ ppu_schede_a: [] }) });
    assert.equal(error.code, 'failed-precondition');
    assert.match(error.message, /manca la Scheda A — Come mi vedo/);
    assert.equal(m.state.calls.length, 0);
  });

  test('manca B → failed-precondition', async () => {
    const { error } = await run({ seed: baseSeed({ ppu_schede_b: [] }) });
    assert.match(error.message, /manca la Scheda B/);
  });

  test('manca C → failed-precondition', async () => {
    const { error } = await run({ seed: baseSeed({ ppu_schede_c: [] }) });
    assert.match(error.message, /manca la Scheda C — Le persone intorno a me/);
  });

  test('C in un momento diverso → non generabile per «Ingresso»', async () => {
    const seed = baseSeed({ ppu_schede_c: [schedaC({ ppuMoment: 'verifica_3_mesi' })] });
    const { error } = await run({ seed });
    assert.equal(error.code, 'failed-precondition');
    assert.match(error.message, /manca la Scheda C/);
  });

  test('due A completate nello stesso momento → si usa la più recente', async () => {
    const seed = baseSeed({
      ppu_schede_a: [schedaA({ id: 'a-old', completedAt: 100 }), schedaA({ id: 'a-new', completedAt: 900 })],
    });
    const { error, store } = await run({ seed });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].sourceAId, 'a-new');
  });

  test('bozza più recente + completata più vecchia → si usa la completata', async () => {
    const seed = baseSeed({
      ppu_schede_a: [
        schedaA({ id: 'a-ok', completedAt: 100 }),
        schedaA({ id: 'a-bozza', status: 'bozza', completedAt: undefined, updatedAt: 99999 }),
      ],
    });
    const { store, error } = await run({ seed });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].sourceAId, 'a-ok');
  });

  test('altro con nota corrispondente → generabile', async () => {
    const seed = baseSeed({
      ppu_schede_a: [schedaA({ ppuMoment: 'altro', ppuMomentNote: 'Rientro' })],
      ppu_schede_b: [schedaB({ ppuMoment: 'altro', ppuMomentNote: ' Rientro ' })],
      ppu_schede_c: [schedaC({ ppuMoment: 'altro', ppuMomentNote: 'Rientro' })],
    });
    const { error, store } = await run({
      seed,
      data: { minorId: MINOR, comunitaId: COM, ppuMoment: 'altro', ppuMomentNote: 'Rientro' },
    });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].ppuMoment, 'altro');
    assert.equal(store.ppu_schede_d[0].ppuMomentNote, 'Rientro');
  });

  test('altro con nota diversa → non generabile', async () => {
    const seed = baseSeed({
      ppu_schede_a: [schedaA({ ppuMoment: 'altro', ppuMomentNote: 'Rientro' })],
      ppu_schede_b: [schedaB({ ppuMoment: 'altro', ppuMomentNote: 'Rientro' })],
      ppu_schede_c: [schedaC({ ppuMoment: 'altro', ppuMomentNote: 'Rientro' })],
    });
    const { error } = await run({
      seed,
      data: { minorId: MINOR, comunitaId: COM, ppuMoment: 'altro', ppuMomentNote: 'Crisi' },
    });
    assert.equal(error.code, 'failed-precondition');
  });
});

// ════════════════════════════════════════════════════════════════════
//  PAYLOAD MINIMIZZATO
// ════════════════════════════════════════════════════════════════════
test.describe('payload minimizzato', () => {
  test('nessun dato dell\'educatore né PII nel payload; presenti i testi di risposta del ragazzo', async () => {
    const { m, error } = await run({});
    assert.equal(error, null);
    const blob = JSON.stringify(m.state.calls[0].messages);
    // esclusi
    for (const s of [
      'SENTINEL_AREANOTE_A', 'SENTINEL_AREANOTE_B',
      'SENTINEL_C_NOTE_GENERALE', 'SENTINEL_C_NOTA_NODO',
      'Nome Cognome Test', COORD,
    ]) {
      assert.ok(!blob.includes(s), `il payload non deve contenere "${s}"`);
    }
    // inclusi
    assert.ok(blob.includes(core.OPZIONI_A.self_01['3']), 'testo opzione A scelta');
    assert.ok(blob.includes(core.OPZIONI_A.self_02.NO), 'testo opzione A "NO"');
    assert.ok(blob.includes('so ascoltare gli altri'), 'risposta di chiusura del ragazzo');
    // la chiamata trasporta il system prompt
    assert.ok(m.state.calls[0].system.includes('Scheda D'));
  });

  test('costruisciPayload: struttura e scala NO≠0', () => {
    const p = core.costruisciPayload({ a: schedaA(), b: schedaB(), c: schedaC(), ppuMoment: 'ingresso', ppuMomentNote: '' });
    assert.equal(p.indicatori.length, 18);
    const s2 = p.indicatori.find((i) => i.indicatorId === 'self_02');
    assert.equal(s2.a.valore, 'NO');
    assert.equal(s2.a.testoRisposta, core.OPZIONI_A.self_02.NO);
    const nonRisposto = p.indicatori.find((i) => i.indicatorId === 'self_03');
    assert.equal(nonRisposto.a.valore, null);
    assert.equal(p.chiusuraSchedaA.length, 1);
    assert.equal(p.chiusuraSchedaA[0].ref, 'A:perceivedStrength');
    // rete C: persone con ref tecnico, nessuna nota
    const vic = p.reteSchedaC.vicinanza;
    assert.deepEqual(vic.persone.map((x) => x.ref).sort(), ['C:vicinanza:persona:n_anna', 'C:vicinanza:persona:n_mamma']);
    assert.ok(!JSON.stringify(vic).includes('SENTINEL_C_NOTA_NODO'));
    assert.equal(vic.legami[0].ref, 'C:vicinanza:legame:e_1');
    assert.equal(vic.legami[0].qualita, 'positivo');
    assert.equal(vic.legami[0].direzione, 'reciproca');
  });
});

// ════════════════════════════════════════════════════════════════════
//  VALIDAZIONE OUTPUT + RETRY
// ════════════════════════════════════════════════════════════════════
test.describe('validazione output e retry', () => {
  test('output valido al primo colpo → D salvata, 1 tentativo', async () => {
    const { error, result, store, m } = await run({ modello: [{ text: JSON.stringify(outputValido()), model: 'claude-sonnet-5-YYYY' }] });
    assert.equal(error, null);
    assert.equal(m.state.calls.length, 1);
    assert.equal(store.ppu_schede_d.length, 1);
    const d = store.ppu_schede_d[0];
    assert.equal(d.stato, 'GENERATA');
    assert.equal(d.sourceAId, 'a1');
    assert.equal(d.sourceBId, 'b1');
    assert.equal(d.sourceCId, 'c1');
    assert.equal(d.ppuMoment, 'ingresso');
    assert.equal(d.promptVersion, core.PROMPT_VERSION);
    assert.equal(d.modelloAI, 'claude-sonnet-5-YYYY');
    assert.equal(d.notaMetodologica, core.NOTA_METODOLOGICA);
    assert.equal(d.validatedAt, null);
    assert.equal(d.validatedBy, null);
    assert.equal(d.tentativiGenerazione, 1);
    assert.equal(d.createdBy, COORD);
    assert.equal(d.fonti.a.schedaId, 'a1');
    assert.equal(d.fonti.b.instrumentVersion, 1);
    assert.ok(Array.isArray(d.contenutoAI.pilastri) && d.contenutoAI.pilastri.length === 6);
    assert.ok(!('notaMetodologica' in d.contenutoAI));
    assert.equal(result.schedaDId, d.id);
    // lock rilasciato
    assert.equal(Object.keys(store.ppu_schede_d_locks).length, 0);
  });

  test('JSON malformato due volte → nessuna D, errore controllato', async () => {
    const { error, store, m } = await run({ modello: ['non è json', 'ancora non json'] });
    assert.equal(m.state.calls.length, 2);
    assert.equal(error.code, 'internal');
    assert.match(error.message, /controlli di coerenza/);
    assert.match(error.message, /Nessun dato è stato salvato/);
    assert.equal(store.ppu_schede_d.length, 0);
    assert.equal(Object.keys(store.ppu_schede_d_locks).length, 0);
  });

  test('JSON malformato poi valido → D salvata, 2 tentativi', async () => {
    const { error, store } = await run({ modello: ['non è json', outputValido()] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d.length, 1);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
  });

  test('6 pilastri non corretti poi valido → 2 tentativi, D salvata', async () => {
    const bad = clone(outputValido());
    bad.pilastri = bad.pilastri.slice(0, 5);
    const { error, store, m } = await run({ modello: [bad, outputValido()] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d.length, 1);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
    // il secondo messaggio contiene gli errori di correzione
    const retryUser = m.state.calls[1].messages.find((x) => x.role === 'user' && x.content.includes('non ha superato'));
    assert.ok(retryUser, 'il retry include il messaggio di correzione');
  });

  test('pilastri fuori ordine canonico → retry', async () => {
    const bad = clone(outputValido());
    const t = bad.pilastri[0]; bad.pilastri[0] = bad.pilastri[1]; bad.pilastri[1] = t;
    const { error, store } = await run({ modello: [bad, outputValido()] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
  });

  test('entrambi i tentativi con schema errato → nessuna D', async () => {
    const bad = clone(outputValido());
    delete bad.pilastri[2].aspettoDaApprofondire;
    const { error, store } = await run({ modello: [bad, bad] });
    assert.equal(error.code, 'internal');
    assert.equal(store.ppu_schede_d.length, 0);
  });
});

// ════════════════════════════════════════════════════════════════════
//  VERIFICA SEMANTICA DELLE FONTI
// ════════════════════════════════════════════════════════════════════
test.describe('verifica semantica delle fonti', () => {
  test('fonte A con indicatore inesistente → retry, poi valido', async () => {
    const bad = clone(outputValido());
    bad.pilastri[0].fonti[0].elementoId = 'self_09';
    const { error, store } = await run({ modello: [bad, outputValido()] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
  });

  test('fonte B con pilastro incoerente → retry', async () => {
    const bad = clone(outputValido());
    bad.pilastri[0].fonti.push({ scheda: 'B', pilastro: 'self', elementoId: 'future_01' });
    const errs = core.verificaFontiSemantica(bad, core.costruisciPayload({ a: schedaA(), b: schedaB(), c: schedaC(), ppuMoment: 'ingresso', ppuMomentNote: '' }));
    assert.ok(errs.some((e) => /appartiene al pilastro "future"/.test(e)));
    const { error, store } = await run({ modello: [bad, outputValido()] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
  });

  test('fonte B che cita una domanda di chiusura → retry (B non ha closing)', async () => {
    const bad = clone(outputValido());
    bad.pilastri[0].fonti.push({ scheda: 'B', pilastro: 'self', elementoId: 'perceivedStrength' });
    const { error, store } = await run({ modello: [bad, outputValido()] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
  });

  test('persona C inventata → retry', async () => {
    const bad = clone(outputValido());
    bad.pilastri[1].fonti.push({ scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:persona:n_ghost' });
    const { error, store } = await run({ modello: [bad, outputValido()] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
  });

  test('legame C inventato → retry', async () => {
    const bad = clone(outputValido());
    bad.pilastri[1].fonti.push({ scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:legame:e_ghost' });
    const { error, store } = await run({ modello: [bad, outputValido()] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
  });

  test('fonte C reale (persona/legame esistenti) → accettata al primo colpo', async () => {
    const ok = clone(outputValido());
    ok.pilastri[1].fonti.push({ scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:persona:n_mamma' });
    ok.letturaTrasversale.risorse[0].fonti.push({ scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:legame:e_1' });
    const { error, store } = await run({ modello: [ok] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 1);
  });

  test('entrambi i tentativi con persona C inventata → nessuna D', async () => {
    const bad = clone(outputValido());
    bad.pilastri[1].fonti.push({ scheda: 'C', pilastro: 'others', elementoId: 'fatica:persona:n_ghost' });
    const { error, store } = await run({ modello: [bad, bad] });
    assert.equal(error.code, 'internal');
    assert.equal(store.ppu_schede_d.length, 0);
  });
});

// ════════════════════════════════════════════════════════════════════
//  PROVIDER AI / CONCORRENZA / LOG
// ════════════════════════════════════════════════════════════════════
test.describe('provider, concorrenza, log', () => {
  test('errore del provider AI → unavailable, nessuna D, lock rilasciato', async () => {
    const { error, store } = await run({ modello: [{ __throw: true }] });
    assert.equal(error.code, 'unavailable');
    assert.equal(store.ppu_schede_d.length, 0);
    assert.equal(Object.keys(store.ppu_schede_d_locks).length, 0);
  });

  test('lock fresco già presente → aborted, il lock altrui NON viene rimosso', async () => {
    const key = core.lockKey(MINOR, COM, 'ingresso', '');
    const seed = baseSeed({ ppu_schede_d_locks: { [key]: { startedAt: TEST_NOW - 1000, by: 'altro-op' } } });
    const { error, store, m } = await run({ seed });
    assert.equal(error.code, 'aborted');
    assert.equal(m.state.calls.length, 0);
    assert.ok(store.ppu_schede_d_locks[key], 'il lock in corso resta');
  });

  test('lock scaduto → viene "rubato" e la generazione procede', async () => {
    const key = core.lockKey(MINOR, COM, 'ingresso', '');
    const seed = baseSeed({ ppu_schede_d_locks: { [key]: { startedAt: TEST_NOW - 10 * 60 * 1000 } } });
    const { error, store } = await run({ seed });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d.length, 1);
    assert.equal(Object.keys(store.ppu_schede_d_locks).length, 0);
  });

  test('i log non contengono dati personali né sentinelle', async () => {
    const { logs } = await run({});
    const blob = JSON.stringify(logs);
    for (const s of ['SENTINEL_AREANOTE_A', 'SENTINEL_C_NOTA_NODO', 'Nome Cognome Test', 'so ascoltare gli altri']) {
      assert.ok(!blob.includes(s));
    }
    assert.ok(blob.includes('ppu_d_done'));
  });
});

// ════════════════════════════════════════════════════════════════════
//  UTILITÀ PURE
// ════════════════════════════════════════════════════════════════════
test.describe('utilità pure', () => {
  test('estraiJson: oggetto pieno, fence, testo attorno, spazzatura', () => {
    assert.deepEqual(core.estraiJson('{"a":1}'), { a: 1 });
    assert.deepEqual(core.estraiJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(core.estraiJson('Ecco il JSON richiesto:\n{"a":1}\nSpero sia utile.'), { a: 1 });
    assert.deepEqual(core.estraiJson('{"a":1}\n'), { a: 1 });
    assert.equal(core.estraiJson('"a":1}'), null);   // frammento non valido, nessuna compensazione prefill
    assert.equal(core.estraiJson('non json'), null);
    assert.equal(core.estraiJson(42), null);
  });

  test('costruisciMessaggiModello: la conversazione termina SEMPRE con un turno user (no prefill Sonnet 5)', () => {
    const iniziale = core.costruisciMessaggiModello({ payload: { x: 1 }, precedente: null, errori: null });
    assert.equal(iniziale[iniziale.length - 1].role, 'user');
    assert.ok(!iniziale.some((m) => m.role === 'assistant'));

    const retry = core.costruisciMessaggiModello({ payload: { x: 1 }, precedente: '{"pilastri":[]}', errori: ['errore X'] });
    assert.equal(retry[retry.length - 1].role, 'user');
    assert.equal(retry.filter((m) => m.role === 'assistant').length, 1);
    // il turno assistant riporta il candidato precedente COM'È (nessun "{" anteposto)
    assert.equal(retry.find((m) => m.role === 'assistant').content, '{"pilastri":[]}');
    assert.match(retry[retry.length - 1].content, /non ha superato/);
  });

  test('selezionaTerna: filtra per stato e momento, sceglie la più recente', () => {
    const t = core.selezionaTerna({
      schedeA: [schedaA({ id: 'x', completedAt: 1 }), schedaA({ id: 'y', completedAt: 9 }), schedaA({ id: 'z', status: 'bozza', completedAt: 99 })],
      schedeB: [schedaB()],
      schedeC: [schedaC({ ppuMoment: 'uscita' })],
      ppuMoment: 'ingresso',
      ppuMomentNote: '',
    });
    assert.equal(t.a.id, 'y');
    assert.deepEqual(t.mancanti, ['C']);
  });

  test('descriviMancanti: singolare e plurale', () => {
    assert.equal(
      core.descriviMancanti('ingresso', '', ['C']),
      'Per il momento «Ingresso» manca la Scheda C — Le persone intorno a me.',
    );
    assert.match(core.descriviMancanti('altro', 'Rientro', ['A', 'B']), /^Per il momento «Rientro» mancano: /);
  });

  test('riepilogoFonti: snapshot con instrumentVersion opzionale', () => {
    const snap = core.riepilogoFonti(schedaA(), schedaB(), schedaC());
    assert.equal(snap.a.schedaId, 'a1');
    assert.equal(snap.a.instrumentVersion, undefined);
    assert.equal(snap.b.instrumentVersion, 1);
  });
});

// ════════════════════════════════════════════════════════════════════
//  ALLINEAMENTO CON I SORGENTI BROWSER-SIDE (drift alarm)
// ════════════════════════════════════════════════════════════════════
test.describe('allineamento con js/*', () => {
  const ROOT = path.join(__dirname, '..', '..');
  // strip di TUTTO ciò che non è lettera/cifra: allarme sul WORDING, tollerante
  // a differenze di punteggiatura, spaziatura e concatenazione `+` nei sorgenti.
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9À-ɏ]/g, '');
  const readSrc = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

  test('OPZIONI_A allineate a js/ppu-scheda-a.js', () => {
    const src = norm(readSrc('js/ppu-scheda-a.js'));
    for (const [id, opz] of Object.entries(core.OPZIONI_A)) {
      for (const k of ['NO', '1', '2', '3']) {
        assert.ok(src.includes(norm(opz[k])), `A ${id}/${k} non trovato nel sorgente`);
      }
    }
  });

  test('OPZIONI_B allineate a js/ppu-scheda-b.js', () => {
    const src = norm(readSrc('js/ppu-scheda-b.js'));
    for (const [id, opz] of Object.entries(core.OPZIONI_B)) {
      for (const k of ['NO', '1', '2', '3']) {
        assert.ok(src.includes(norm(opz[k])), `B ${id}/${k} non trovato nel sorgente`);
      }
    }
  });

  test('COSTRUTTI, NOTA_METODOLOGICA, PILASTRI allineati a js/ppu-scheda-d-model.js', () => {
    const src = norm(readSrc('js/ppu-scheda-d-model.js'));
    for (const v of Object.values(core.COSTRUTTI)) assert.ok(src.includes(norm(v)), `costrutto non trovato: ${v}`);
    assert.ok(src.includes(norm(core.NOTA_METODOLOGICA)));
    assert.deepEqual(core.PILASTRI_ID, ['self', 'others', 'environment', 'future', 'expression', 'wellbeing']);
    assert.equal(core.PROMPT_VERSION, 4); // Passo 6C
    // allineamento della costante di versione fra core e browser model
    assert.match(readSrc('js/ppu-scheda-d-model.js'), /export const PROMPT_VERSION = 4;/);
  });

  test('DOMANDE_CHIUSURA allineate a js/ppu-scheda-a.js', () => {
    const src = norm(readSrc('js/ppu-scheda-a.js'));
    for (const v of Object.values(core.DOMANDE_CHIUSURA)) assert.ok(src.includes(norm(v)));
  });
});

// ════════════════════════════════════════════════════════════════════
//  Compatibilità Anthropic claude-sonnet-5: request SENZA sampling
// ════════════════════════════════════════════════════════════════════
test.describe('request a Anthropic (claude-sonnet-5)', () => {
  const schedaD = require('../schedaD');

  test('modello configurato = claude-sonnet-5 (o PPU_MODELLO_AI)', () => {
    assert.equal(schedaD._MODELLO_AI, process.env.PPU_MODELLO_AI || 'claude-sonnet-5');
  });

  test('la request NON contiene temperature / top_p / top_k; effort medium; max_tokens 12000', () => {
    const req = schedaD._costruisciRequestAnthropic({
      system: 'PROMPT DI SISTEMA',
      messages: [{ role: 'user', content: 'DATI …' }],
    });
    assert.equal(req.model, schedaD._MODELLO_AI);
    assert.equal(typeof req.max_tokens, 'number');
    assert.equal(req.system, 'PROMPT DI SISTEMA');
    assert.ok(Array.isArray(req.messages) && req.messages[req.messages.length - 1].role === 'user');
    assert.ok(!('temperature' in req), 'temperature NON deve essere inviato');
    assert.ok(!('top_p' in req), 'top_p NON deve essere inviato');
    assert.ok(!('top_k' in req), 'top_k NON deve essere inviato');
    assert.ok(!('thinking' in req), 'thinking NON deve essere inviato');
    // Sonnet 5: inviare `budget_tokens` provoca HTTP 400 → NON deve comparire,
    // né a livello top-level né dentro output_config.
    assert.ok(!('budget_tokens' in req), 'budget_tokens NON deve essere inviato (Sonnet 5 → HTTP 400)');
    assert.ok(!('budget_tokens' in (req.output_config || {})), 'budget_tokens NON deve essere in output_config');
    assert.ok(!JSON.stringify(req).includes('budget_tokens'), 'budget_tokens assente in tutta la request');
    // Passo 6C: effort esplicito per contenere il thinking dentro max_tokens
    assert.deepEqual(req.output_config, { effort: 'medium' });
    assert.equal(req.max_tokens, 12000);
    assert.equal(schedaD._MAX_OUTPUT_TOKENS, 12000);
    assert.equal(schedaD._EFFORT, 'medium');
    // nessun campo di sampling anche sotto altri nomi
    assert.deepEqual(Object.keys(req).sort(), ['max_tokens', 'messages', 'model', 'output_config', 'system']);
  });

  test('@anthropic-ai/sdk è caricabile (nessuna chiamata reale)', () => {
    assert.doesNotThrow(() => require('@anthropic-ai/sdk'));
  });
});

// ════════════════════════════════════════════════════════════════════
//  PASSO 6 — Chiavi psico-pedagogiche (server core)
// ════════════════════════════════════════════════════════════════════
function chiavePPCore(over = {}) {
  return {
    ambito: 'pilastro',
    pilastro: 'self',
    configurazioneOsservata: 'A alta su self, B piu incerta sugli stessi indicatori.',
    questioneEducativa: 'Come interrogare la distanza A/B su questi indicatori?',
    riferimentoTeorico: {
      autore: 'Autore Esempio', teoria: 'Teoria di esempio',
      concetto: 'Concetto specifico', spiegazione: 'Spiegazione breve per un educatore.',
    },
    pertinenzaNelCaso: 'Aiuta a interrogare proprio questa configurazione.',
    limitiDellaLettura: 'I dati non permettono di stabilirne l origine.',
    lettureAlternative: [],
    elementiDaOsservare: ['Come descrive la differenza tra le due prospettive.'],
    domandeEquipe: ['In quali contesti l equipe ritrova questa distanza?'],
    fonti: [{ scheda: 'A', pilastro: 'self', elementoId: 'self_01' }],
    ...over,
  };
}
function outputValidoConChiavi(chiavi) {
  return { ...outputValido(), chiaviPsicoPedagogiche: chiavi };
}
const payloadBase = () => core.costruisciPayload({
  a: schedaA(), b: schedaB(), c: schedaC(), ppuMoment: 'ingresso', ppuMomentNote: '',
});

test.describe('Passo 6 · chiavi psico-pedagogiche (core)', () => {
  test('PROMPT_VERSION = 4, MAX_CHIAVI_PP = 3 (Passo 6C), AMBITI_CHIAVE, LIMITI_ARRAY_CHIAVE', () => {
    assert.equal(core.PROMPT_VERSION, 4);
    assert.equal(core.MAX_CHIAVI_PP, 3);
    assert.deepEqual(core.AMBITI_CHIAVE, ['pilastro', 'trasversale']);
    assert.deepEqual(core.LIMITI_ARRAY_CHIAVE, {
      lettureAlternative: [0, 2], elementiDaOsservare: [1, 3], domandeEquipe: [1, 3],
    });
  });

  test('validaChiaviPsicoPedagogiche: assente -> ok; [] -> ok; 1..3 -> ok; 4 -> errore (Passo 6C)', () => {
    assert.deepEqual(core.validaOutputAI(outputValido()), []);
    assert.deepEqual(core.validaOutputAI(outputValidoConChiavi([])), []);
    assert.equal(core.MAX_CHIAVI_PP, 3);
    assert.deepEqual(core.validaOutputAI(outputValidoConChiavi([chiavePPCore(), chiavePPCore(), chiavePPCore()])), []);
    assert.ok(core.validaOutputAI(outputValidoConChiavi(Array.from({ length: 4 }, () => chiavePPCore())))
      .some((m) => /al massimo 3/.test(m)));
  });

  test('validaChiaviPsicoPedagogiche: ambito/pilastro, campi vuoti, array (min e MAX), fonti', () => {
    const v = (k) => core.validaChiaviPsicoPedagogiche({ chiaviPsicoPedagogiche: [k] });
    assert.deepEqual(v(chiavePPCore({ ambito: 'trasversale', pilastro: null })), []);
    assert.ok(v(chiavePPCore({ ambito: 'trasversale', pilastro: 'self' })).some((m) => /deve essere null/.test(m)));
    assert.ok(v(chiavePPCore({ ambito: 'pilastro', pilastro: 'nope' })).some((m) => /non valido per ambito/.test(m)));
    assert.ok(v(chiavePPCore({ questioneEducativa: '' })).some((m) => /questioneEducativa mancante/.test(m)));
    assert.ok(v(chiavePPCore({ riferimentoTeorico: { autore: '', teoria: 't', concetto: 'c', spiegazione: 's' } })).some((m) => /riferimentoTeorico\.autore mancante/.test(m)));
    assert.ok(v(chiavePPCore({ elementiDaOsservare: 'x' })).some((m) => /elementiDaOsservare deve essere un array/.test(m)));
    assert.ok(v(chiavePPCore({ domandeEquipe: [] })).some((m) => /domandeEquipe deve contenere almeno 1/.test(m)));
    assert.ok(v(chiavePPCore({ fonti: [] })).some((m) => /fonti deve contenere almeno 1/.test(m)));
    // Passo 6C — tetti d'array
    assert.ok(v(chiavePPCore({ lettureAlternative: ['a', 'b', 'c'] })).some((m) => /lettureAlternative: al massimo 2/.test(m)));
    assert.ok(v(chiavePPCore({ elementiDaOsservare: ['a', 'b', 'c', 'd'] })).some((m) => /elementiDaOsservare: al massimo 3/.test(m)));
    assert.ok(v(chiavePPCore({ domandeEquipe: ['a', 'b', 'c', 'd'] })).some((m) => /domandeEquipe: al massimo 3/.test(m)));
    assert.deepEqual(v(chiavePPCore({ lettureAlternative: ['a', 'b'], elementiDaOsservare: ['x', 'y', 'z'], domandeEquipe: ['p', 'q', 'r'] })), []);
  });

  test('verificaFontiSemantica: fonti delle chiavi devono esistere nel payload', () => {
    const p = payloadBase();
    const base = outputValidoConChiavi([chiavePPCore()]);
    assert.deepEqual(core.verificaFontiSemantica(base, p), []);
    // A inesistente
    const aBad = outputValidoConChiavi([chiavePPCore({ fonti: [{ scheda: 'A', pilastro: 'self', elementoId: 'self_99' }] })]);
    assert.ok(core.verificaFontiSemantica(aBad, p).some((m) => /chiaviPsicoPedagogiche\[0\]\.fonti\[0\].*non è tra le FONTI CITABILI/.test(m)));
    // B con pilastro incoerente
    const bBad = outputValidoConChiavi([chiavePPCore({ fonti: [{ scheda: 'B', pilastro: 'self', elementoId: 'future_01' }] })]);
    assert.ok(core.verificaFontiSemantica(bBad, p).some((m) => /appartiene al pilastro "future"/.test(m)));
    // C inesistente
    const cBad = outputValidoConChiavi([chiavePPCore({ fonti: [{ scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:persona:n_ghost' }] })]);
    assert.ok(core.verificaFontiSemantica(cBad, p).some((m) => /non è tra le FONTI CITABILI/.test(m)));
    // C reale → ok
    const cOk = outputValidoConChiavi([chiavePPCore({ ambito: 'others', pilastro: 'others', fonti: [{ scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:persona:n_mamma' }] })]);
    assert.deepEqual(core.verificaFontiSemantica(cOk, p), []);
  });

  test('generazione: chiave invalida al 1° tentativo, valida al 2° → retry e D salvata', async () => {
    const bad = outputValidoConChiavi([chiavePPCore({ questioneEducativa: '' })]);
    const good = outputValidoConChiavi([chiavePPCore()]);
    const { error, store } = await run({ modello: [bad, good] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d.length, 1);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
    assert.equal(store.ppu_schede_d[0].promptVersion, 4);
    assert.ok(Array.isArray(store.ppu_schede_d[0].contenutoAI.chiaviPsicoPedagogiche));
    assert.equal(store.ppu_schede_d[0].contenutoAI.chiaviPsicoPedagogiche.length, 1);
  });

  test('generazione: chiave invalida in entrambi i tentativi → nessuna D', async () => {
    const bad = outputValidoConChiavi([chiavePPCore({ fonti: [] })]);
    const { error, store } = await run({ modello: [bad, bad] });
    assert.equal(error.code, 'internal');
    assert.equal(store.ppu_schede_d.length, 0);
  });

  test('generazione: output SENZA chiavi → D salvata con chiaviPsicoPedagogiche = [], promptVersion 4', async () => {
    const { error, store } = await run({ modello: [outputValido()] });
    assert.equal(error, null);
    assert.deepEqual(store.ppu_schede_d[0].contenutoAI.chiaviPsicoPedagogiche, []);
    assert.equal(store.ppu_schede_d[0].promptVersion, 4);
  });

  test('anti-standardizzazione: nessuna mappa pilastro → autore; guardrail nel SYSTEM_PROMPT', () => {
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const src = fs2.readFileSync(path2.join(__dirname, '..', 'schedaDCore.js'), 'utf8');
    const AUTORI = ['Bandura', 'Vygotskij', 'Bronfenbrenner', 'Erikson', 'Bowlby', 'Rogers', 'Cooley',
      'Dewey', 'Bruner', 'Freire', 'Kohlberg', 'Winnicott', 'Gardner', 'Antonovsky', 'Seligman'];
    // ogni autore compare UNA sola volta (nella riga-elenco esemplificativo del SYSTEM_PROMPT)
    for (const a of AUTORI) {
      assert.equal(src.split(a).length - 1, 1, `${a} deve comparire una sola volta (elenco esemplificativo)`);
    }
    // nessuna struttura tipo  self: 'Bandura'
    for (const pid of core.PILASTRI_ID) {
      assert.ok(!new RegExp(`${pid}\\s*:\\s*['"\`][^'"\`]*(${AUTORI.join('|')})`).test(src), `mappa sospetta ${pid} → autore`);
    }
    assert.match(src, /NON una checklist/);
    assert.match(src, /NESSUNA associazione rigida pilastro/);
    assert.match(src, /esemplificativo e NON esaustivo/);
  });
});

// ════════════════════════════════════════════════════════════════════
//  PASSO 6C — verbosità, limiti di lunghezza, retry per troncamento
// ════════════════════════════════════════════════════════════════════
test.describe('Passo 6C · concisione e retry', () => {
  test('SYSTEM_PROMPT: sezione LUNGHEZZA, "da 0 a 3 chiavi", anti-duplicazione, target parole', () => {
    const sp = core.SYSTEM_PROMPT;
    assert.match(sp, /LUNGHEZZA E CONCISIONE/);
    assert.match(sp, /da 0 a 3 chiavi/);
    assert.match(sp, /700[–-]1100 parole/);
    assert.match(sp, /NON ripetere in "configurazioneOsservata"/);
    assert.match(sp, /conciso e completo che lungo e troncato/i);
    // guardrail del Passo 6 conservati
    assert.match(sp, /NON una checklist/);
    assert.match(sp, /NESSUNA associazione rigida pilastro/);
    assert.match(sp, /Albert Bandura/);
  });

  test('costruisciMessaggiModello: modalità "troncato" NON reinserisce il testo precedente', () => {
    const iniziale = core.costruisciMessaggiModello({ payload: { x: 1 }, precedente: null, errori: null });
    assert.ok(!iniziale.some((m) => m.role === 'assistant'));

    // retry strutturale (comportamento storico): reinserisce + corregge
    const strut = core.costruisciMessaggiModello({ payload: { x: 1 }, precedente: '{"pilastri":[]}', errori: ['e'] });
    assert.equal(strut.filter((m) => m.role === 'assistant').length, 1);

    // retry per troncamento: nessun assistant, nota di concisione nel turno user, JSON troncato assente
    const tr = core.costruisciMessaggiModello({ payload: { x: 1 }, precedente: '{"pilastri":[{"comeMi', errori: ['x'], troncato: true });
    assert.ok(!tr.some((m) => m.role === 'assistant'));
    assert.equal(tr[tr.length - 1].role, 'user');
    assert.match(tr[0].content, /TRONCATO perch/);
    assert.match(tr[0].content, /limiti di lunghezza/);
    assert.ok(!tr[0].content.includes('{"pilastri":[{"comeMi'));
  });

  test('generazione: 1° tentativo troncato (max_tokens), 2° valido → D salvata, retry SENZA reinserimento', async () => {
    const troncato = { text: '{"sintesiGenerale":"x","pilastri":[{"pilastro":"self","comeMiVedo":"y', __stopReason: 'max_tokens' };
    const { error, result, store, m } = await run({ modello: [troncato, outputValido()] });
    assert.equal(error, null);
    assert.ok(result && result.schedaDId, 'D salvata');
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
    // il 2° prompt NON deve contenere il testo troncato del 1°, ma deve contenere la nota
    const secondUser = m.state.calls[1].messages.map((x) => x.content).join('\n');
    assert.ok(!secondUser.includes('"comeMiVedo":"y'), 'niente reinserimento del troncato');
    assert.match(secondUser, /TRONCATO perch/);
    assert.equal(m.state.calls[1].messages.filter((x) => x.role === 'assistant').length, 0);
  });

  test('generazione: troncato su entrambi i tentativi → nessuna D, errore controllato', async () => {
    const troncato = { text: '{"sintesiGenerale":"x","pilastri":[{"pilastro":"self"', __stopReason: 'max_tokens' };
    const { error, store, m } = await run({ modello: [troncato, troncato] });
    assert.equal(m.state.calls.length, 2);
    assert.equal(error.code, 'internal');
    assert.equal(store.ppu_schede_d.length, 0);
  });
});

// ════════════════════════════════════════════════════════════════════
//  PASSO 6C — promptVersion 3 e retrocompatibilità di LETTURA v1/v2/v3
// ════════════════════════════════════════════════════════════════════
test.describe('Passo 6C · promptVersion 4', () => {
  test('la costante vale 4 (core) ed è allineata al browser model', () => {
    assert.equal(core.PROMPT_VERSION, 4);
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const model = fs2.readFileSync(path2.join(__dirname, '..', '..', 'js', 'ppu-scheda-d-model.js'), 'utf8');
    assert.match(model, /export const PROMPT_VERSION = 4;/);
  });

  test('una NUOVA D generata dal fake model salva promptVersion: 4', async () => {
    const { error, store } = await run({ modello: [outputValido()] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d.length, 1);
    assert.equal(store.ppu_schede_d[0].promptVersion, 4);
  });

  test('anche con retry (1° tentativo non valido) la D salva promptVersion: 4', async () => {
    const bad = outputValidoConChiavi([chiavePPCore({ questioneEducativa: '' })]);
    const { error, store } = await run({ modello: [bad, outputValidoConChiavi([chiavePPCore()])] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].promptVersion, 4);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
  });

  test('lettura compatibile: nessun ramo del core dipende dal valore di promptVersion', () => {
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const src = fs2.readFileSync(path2.join(__dirname, '..', 'schedaDCore.js'), 'utf8');
    // promptVersion compare solo in commento, come costante e come campo scritto in docData:
    // nessun confronto tipo `promptVersion === 1/2/3` o `> 2`.
    assert.ok(!/promptVersion\s*(===?|!==?|>=?|<=?)\s*[0-9]/.test(src), 'nessun gate su promptVersion');
    assert.ok(!/PROMPT_VERSION\s*(===?|!==?|>=?|<=?)\s*[0-9]/.test(src));
  });
});

// ════════════════════════════════════════════════════════════════════
//  PASSO 6C · FASE 6 — Blocco epistemico sui dati insufficienti
//  ASSENZA DI INFORMAZIONE != CARATTERISTICA DEL RAGAZZO
// ════════════════════════════════════════════════════════════════════
test.describe('Passo 6C · FASE 6 — blocco epistemico dati insufficienti (A-H)', () => {
  const payloadDa = (a, b, c) => core.costruisciPayload({ a, b, c, ppuMoment: 'ingresso', ppuMomentNote: '' });
  const suffDa = (a, b, c) => core.valutaSufficienzaDatiPerChiavi(payloadDa(a, b, c));
  const IO = () => ({ id: 'io', isCenter: true, name: 'IO', x: 0.5, y: 0.5 });
  const cVuota = () => schedaC({ sociogrammi: { vicinanza: { nodes: [IO()], edges: [] }, fatica: { nodes: [IO()], edges: [] } } });
  const cPovera = () => schedaC({ sociogrammi: {
    vicinanza: { nodes: [IO(), { id: 'n_zia', name: 'Zia', x: 0.8, y: 0.7, distance: 0.6 }], edges: [] },
    fatica: { nodes: [IO()], edges: [] },
  } });
  const rispPiena = (v) => {
    const r = {};
    for (const p of core.PILASTRI_ID) for (const n of ['01', '02', '03']) r[`${p}_${n}`] = v;
    return r;
  };
  const CLOS_VUOTO = { perceivedStrength: '', desiredImprovement: '', chosenGrowthArea: '' };

  const A_POVERO = schedaA({
    risposte: { others_02: 1, wellbeing_01: 2, self_01: 'NO', self_02: 'NO', others_01: 'NO', environment_01: 'NO', future_01: 'NO', expression_01: 'NO' },
    closing: CLOS_VUOTO,
  });
  const B_POVERO = schedaB({ risposte: { wellbeing_01: 2, self_01: 'NO', others_01: 'NO' } });
  const seedPovero = () => baseSeed({ ppu_schede_a: [A_POVERO], ppu_schede_b: [B_POVERO], ppu_schede_c: [cPovera()] });

  test('A - dati estremamente poveri: sufficiente=false e D salvata con chiaviPsicoPedagogiche: []', async () => {
    const s = suffDa(A_POVERO, B_POVERO, cPovera());
    assert.equal(s.sufficiente, false);
    assert.ok(s.dettaglio.abEntrambiInformativi < core.SOGLIE_SUFFICIENZA.AB_ENTRAMBI_MIN);
    assert.equal(s.dettaglio.contributoC, false);
    const { error, store } = await run({ seed: seedPovero(), modello: [outputValido()] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d.length, 1);
    assert.deepEqual(store.ppu_schede_d[0].contenutoAI.chiaviPsicoPedagogiche, []);
  });

  test('A - il flag CHIAVI_PSICO_PEDAGOGICHE_NON_AMMESSE raggiunge il modello quando sufficiente=false', async () => {
    const { m } = await run({ seed: seedPovero(), modello: [outputValido()] });
    const blob = JSON.stringify(m.state.calls[0].messages);
    assert.match(blob, /CHIAVI_PSICO_PEDAGOGICHE_NON_AMMESSE/);
    assert.match(blob, /OBBLIGATORIAMENTE/);
  });

  test('B - modello disobbediente: sufficiente=false ma produce una chiave -> output RESPINTO', async () => {
    const conChiave = outputValidoConChiavi([chiavePPCore()]);
    const r1 = await run({ seed: seedPovero(), modello: [conChiave, conChiave] });
    assert.equal(r1.error.code, 'internal');
    assert.equal(r1.store.ppu_schede_d.length, 0);
    assert.equal(r1.m.state.calls.length, 2);
    const r2 = await run({ seed: seedPovero(), modello: [conChiave, outputValido()] });
    assert.equal(r2.error, null);
    assert.equal(r2.store.ppu_schede_d[0].tentativiGenerazione, 2);
    assert.deepEqual(r2.store.ppu_schede_d[0].contenutoAI.chiaviPsicoPedagogiche, []);
  });

  test('B - verificaBloccoEpistemico: pura; respinge solo con chiaviAmmesse=false e length>0', () => {
    assert.deepEqual(core.verificaBloccoEpistemico({ chiaviPsicoPedagogiche: [{}] }, true), []);
    assert.deepEqual(core.verificaBloccoEpistemico({ chiaviPsicoPedagogiche: [] }, false), []);
    assert.equal(core.verificaBloccoEpistemico({ chiaviPsicoPedagogiche: [{}, {}] }, false).length, 1);
    assert.match(core.verificaBloccoEpistemico({ chiaviPsicoPedagogiche: [{}] }, false)[0], /NON_AMMESSE/);
  });

  test('C - pochi dati totali ma nucleo A/B coerente (4 coppie) -> NON bloccato', () => {
    const risp = { self_01: 3, self_02: 3, others_01: 1, others_02: 1, environment_01: 'NO', future_01: 'NO' };
    const s = suffDa(schedaA({ risposte: risp, closing: CLOS_VUOTO }), schedaB({ risposte: risp }), cVuota());
    assert.equal(s.dettaglio.abEntrambiInformativi, 4);
    assert.equal(s.dettaglio.contributoAB, true);
    assert.equal(s.sufficiente, true);
  });

  test('C - appena sotto il nucleo (3 coppie) e nient altro -> sufficiente=false', () => {
    const risp = { self_01: 3, self_02: 3, others_01: 1, environment_01: 'NO', future_01: 'NO' };
    const s = suffDa(schedaA({ risposte: risp, closing: CLOS_VUOTO }), schedaB({ risposte: risp }), cVuota());
    assert.equal(s.dettaglio.abEntrambiInformativi, 3);
    assert.equal(s.sufficiente, false);
  });

  test('D - A/B con nucleo (>=4 coppie), C vuota -> sufficiente=true; la poverta di C da sola NON blocca', () => {
    const risp = { self_01: 2, self_02: 2, others_01: 3, others_02: 1, future_01: 'NO' };
    const s = suffDa(schedaA({ risposte: risp, closing: CLOS_VUOTO }), schedaB({ risposte: risp }), cVuota());
    assert.equal(s.dettaglio.cPersone, 0);
    assert.equal(s.dettaglio.contributoC, false);
    assert.equal(s.dettaglio.contributoAB, true);
    assert.equal(s.sufficiente, true);
  });

  test('E - A/B parziali (nessun nucleo), rete C usabile (>=3 persone) -> sufficiente=true via contributoC', () => {
    const s = suffDa(
      schedaA({ risposte: { self_01: 2, others_01: 2, environment_01: 'NO', future_01: 'NO' }, closing: CLOS_VUOTO }),
      schedaB({ risposte: { self_01: 1 } }),
      schedaC(),
    );
    assert.ok(s.dettaglio.abEntrambiInformativi < core.SOGLIE_SUFFICIENZA.AB_ENTRAMBI_MIN);
    assert.ok(s.dettaglio.abAlmenoUnoInformativo < core.SOGLIE_SUFFICIENZA.AB_ALMENO_UNO_MIN);
    assert.equal(s.dettaglio.cPersone, 3);
    assert.equal(s.dettaglio.contributoC, true);
    assert.equal(s.sufficiente, true);
  });

  test('E - criterio C: 2 persone bastano SOLO con >=1 legame qualificato', () => {
    const n2 = [IO(), { id: 'n_a', name: 'A', x: 0.6, y: 0.4, distance: 0.3 }, { id: 'n_b', name: 'B', x: 0.4, y: 0.6, distance: 0.3 }];
    const cConLegame = schedaC({ sociogrammi: {
      vicinanza: { nodes: n2, edges: [{ id: 'e_x', source: 'io', target: 'n_a', direction: 'both', quality: 'yellow' }] },
      fatica: { nodes: [IO()], edges: [] },
    } });
    const cSenzaLegame = schedaC({ sociogrammi: {
      vicinanza: { nodes: n2, edges: [] }, fatica: { nodes: [IO()], edges: [] },
    } });
    const povA = schedaA({ risposte: { self_01: 'NO' }, closing: CLOS_VUOTO });
    const povB = schedaB({ risposte: { self_01: 'NO' } });
    assert.equal(suffDa(povA, povB, cConLegame).dettaglio.contributoC, true);
    assert.equal(suffDa(povA, povB, cSenzaLegame).dettaglio.contributoC, false);
  });

  test('F - regressione caso1: 18 A + 18 B tutti informativi, forte discrepanza -> sufficiente=true', () => {
    const s = suffDa(schedaA({ risposte: rispPiena(3), closing: CLOS_VUOTO }), schedaB({ risposte: rispPiena(1) }), cVuota());
    assert.equal(s.dettaglio.abEntrambiInformativi, 18);
    assert.equal(s.sufficiente, true);
  });

  test('F - seed di base (fixture) resta sufficiente e una D con chiavi si salva', async () => {
    assert.equal(core.valutaSufficienzaDatiPerChiavi(payloadBase()).sufficiente, true);
    const { error, store } = await run({ modello: [outputValidoConChiavi([chiavePPCore()])] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].contenutoAI.chiaviPsicoPedagogiche.length, 1);
  });

  test('G - dati sufficienti ma nessuna configurazione teorica -> chiaviPsicoPedagogiche: [] valido, nessun flag', async () => {
    assert.equal(core.valutaSufficienzaDatiPerChiavi(payloadBase()).sufficiente, true);
    const { error, store, m } = await run({ modello: [outputValido()] });
    assert.equal(error, null);
    assert.deepEqual(store.ppu_schede_d[0].contenutoAI.chiaviPsicoPedagogiche, []);
    assert.ok(!JSON.stringify(m.state.calls[0].messages).includes('CHIAVI_PSICO_PEDAGOGICHE_NON_AMMESSE'));
  });

  test('H - privacy: il flag non introduce PII ne nuovi dati; payload allowlist invariata', () => {
    const payload = payloadDa(A_POVERO, B_POVERO, cPovera());
    // payload allowlist intatta: areaNotes / note generale C NON entrano nel payload
    assert.ok(!JSON.stringify(payload).includes('SENTINEL_AREANOTE_A'));
    assert.ok(!JSON.stringify(payload).includes('SENTINEL_C_NOTE_GENERALE'));
    const msgFalse = core.costruisciMessaggiModello({ payload, precedente: null, errori: null, chiaviAmmesse: false });
    const msgTrue = core.costruisciMessaggiModello({ payload, precedente: null, errori: null, chiaviAmmesse: true });
    const extra = msgFalse[0].content.replace(msgTrue[0].content, '');
    assert.match(extra, /CHIAVI_PSICO_PEDAGOGICHE_NON_AMMESSE/);
    for (const s of ['SENTINEL_AREANOTE_A', 'SENTINEL_AREANOTE_B', 'SENTINEL_C_NOTE_GENERALE', 'Nome Cognome Test']) {
      assert.ok(!extra.includes(s), s);
    }
    assert.equal(extra.split('\n').filter((l) => l.trim()).length, 3);

    const s = core.valutaSufficienzaDatiPerChiavi({ ...payload, areaNotes: 'SENTINEL', note: 'SENTINEL', nome: 'Mario Rossi' });
    assert.ok(!/SENTINEL|Mario Rossi/.test(JSON.stringify(s.dettaglio)));
    assert.deepEqual(Object.keys(s).sort(), ['dettaglio', 'sufficiente']);
    for (const k of Object.keys(s.dettaglio)) {
      if (k === 'soglie') continue;
      assert.equal(typeof s.dettaglio[k], k.startsWith('contributo') ? 'boolean' : 'number', k);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
//  PASSO 6C · FASE 7 — Affidabilita output, token, tracciabilita fonti
// ════════════════════════════════════════════════════════════════════
test.describe('Passo 6C · FASE 7 — contratto delle fonti e retry (A-L)', () => {
  const payloadStd = () => core.costruisciPayload({ a: schedaA(), b: schedaB(), c: schedaC(), ppuMoment: 'ingresso', ppuMomentNote: '' });
  const outConFonti = (fonti) => outputValidoConChiavi([chiavePPCore({ fonti })]);
  const verr = (json) => core.verificaFontiSemantica(json, payloadStd());
  const wrapFonte = (fonte) => ({ pilastri: [], letturaTrasversale: {}, chiaviPsicoPedagogiche: [{ fonti: [fonte] }] });

  test('A - "pilastro" accetta SOLO i sei canonici; gli elementoId di chiusura come pilastro sono respinti', () => {
    assert.deepEqual(core.PILASTRI_ID, ['self', 'others', 'environment', 'future', 'expression', 'wellbeing']);
    for (const p of ['perceivedStrength', 'chosenGrowthArea', 'desiredImprovement', 'looking-glass', 'trasversale', '']) {
      const errs = verr(wrapFonte({ scheda: 'A', pilastro: p, elementoId: 'self_01' }));
      assert.ok(errs.some((m) => /"pilastro" .*non valido.*ESATTAMENTE uno di: self, others/.test(m)), 'pilastro=' + p);
    }
    assert.deepEqual(verr(wrapFonte({ scheda: 'A', pilastro: 'self', elementoId: 'self_01' })), []);
  });

  test('B - elementoId reale associato al pilastro errato -> respinto', () => {
    const errs = verr(wrapFonte({ scheda: 'A', pilastro: 'others', elementoId: 'self_01' }));
    assert.ok(errs.some((m) => /elementoId "self_01" appartiene al pilastro "self", non a "others"/.test(m)));
  });

  test('C - FONTI_CITABILI: solo identificatori del payload, nessun testo/nome/nota', () => {
    const A = schedaA({
      risposte: { self_01: 3, others_01: 2 },
      closing: { perceivedStrength: 'RISPOSTA CHIUSURA A', desiredImprovement: '', chosenGrowthArea: 'ALTRA RISPOSTA' },
      areaNotes: { self: 'NOTA_EDUCATORE_A' },
    });
    const B = schedaB({ risposte: { self_01: 2 }, areaNotes: { self: 'NOTA_EDUCATORE_B' } });
    const C = schedaC({ note: 'NOTA_GENERALE_C' });
    const p = core.costruisciPayload({ a: A, b: B, c: C, ppuMoment: 'ingresso', ppuMomentNote: '' });
    const map = core.costruisciFontiCitabili(p);
    const testo = core.elencoFontiCitabiliTesto(p);
    const blob = JSON.stringify([...map.keys()]) + '\n' + testo;
    for (const bad of ['RISPOSTA CHIUSURA A', 'ALTRA RISPOSTA', 'NOTA_EDUCATORE_A', 'NOTA_EDUCATORE_B', 'NOTA_GENERALE_C', 'Mamma', 'Anna', 'Prof. Rossi']) {
      assert.ok(!blob.includes(bad), 'FONTI_CITABILI non deve contenere ' + bad);
    }
    assert.ok(map.has('self_01') && map.has('perceivedStrength') && map.has('chosenGrowthArea'));
    assert.match(testo, /FONTI CITABILI/);
    assert.match(testo, /self_01/);
    assert.equal(map.get('perceivedStrength').pilastriAll, true);
    assert.ok(map.get('perceivedStrength').schede.has('A') && !map.get('perceivedStrength').schede.has('B'));
  });

  test('D - tripletta valida accettata; stesso elementoId con pilastro errato respinto', () => {
    // il fixture schedaA() ha SOLO perceivedStrength compilata fra le chiusure
    assert.deepEqual(verr(wrapFonte({ scheda: 'A', pilastro: 'self', elementoId: 'self_02' })), []);
    assert.deepEqual(verr(wrapFonte({ scheda: 'A', pilastro: 'future', elementoId: 'perceivedStrength' })), []); // chiusura: qualunque pilastro canonico
    assert.ok(verr(wrapFonte({ scheda: 'A', pilastro: 'future', elementoId: 'self_02' })).some((m) => /appartiene al pilastro "self"/.test(m)));
    assert.ok(verr(wrapFonte({ scheda: 'B', pilastro: 'self', elementoId: 'perceivedStrength' })).some((m) => /non appartiene alla Scheda B/.test(m)));
    // chiusura non compilata (chosenGrowthArea vuota nel fixture) → non citabile
    assert.ok(verr(wrapFonte({ scheda: 'A', pilastro: 'self', elementoId: 'chosenGrowthArea' })).some((m) => /non è tra le FONTI CITABILI/.test(m)));
  });

  test('E - t1 con pilastro="perceivedStrength", t2 fonte corretta -> D generata, tentativi 2', async () => {
    const bad = outConFonti([{ scheda: 'A', pilastro: 'perceivedStrength', elementoId: 'self_01' }]);
    const good = outConFonti([{ scheda: 'A', pilastro: 'self', elementoId: 'self_01' }]);
    const { error, store, m } = await run({ modello: [bad, good] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
    assert.deepEqual(core.verificaFontiSemantica(store.ppu_schede_d[0].contenutoAI, payloadStd()), []);
    const retryUser = m.state.calls[1].messages.map((x) => x.content).join('\n');
    assert.match(retryUser, /"pilastro" deve essere ESATTAMENTE uno di self, others/);
    assert.match(retryUser, /FONTI CITABILI/);
  });

  test('F - fonte invalida in entrambi i tentativi -> internal, 0 D', async () => {
    const bad = outConFonti([{ scheda: 'A', pilastro: 'desiredImprovement', elementoId: 'self_01' }]);
    const { error, store } = await run({ modello: [bad, bad] });
    assert.equal(error.code, 'internal');
    assert.equal(store.ppu_schede_d.length, 0);
  });

  test('G - t1 stop_reason=max_tokens (parzialmente parseabile), t2 valido -> troncato NON reinviato', async () => {
    const t1 = { text: '{"sintesiGenerale":"parziale"}', __stopReason: 'max_tokens' };
    const { error, store, m } = await run({ modello: [t1, outputValido()] });
    assert.equal(error, null);
    assert.equal(store.ppu_schede_d[0].tentativiGenerazione, 2);
    const c2 = m.state.calls[1].messages;
    assert.equal(c2.filter((x) => x.role === 'assistant').length, 0);
    const blob = c2.map((x) => x.content).join('\n');
    assert.ok(!blob.includes('"sintesiGenerale":"parziale"'));
    assert.match(blob, /TRONCATO/);
    assert.match(blob, /DATI \(JSON\):/);
  });

  test('H - 0..3 chiavi, struttura, fonti, blocco epistemico FASE 6: invariati', async () => {
    assert.deepEqual(core.validaOutputAI(outputValidoConChiavi([chiavePPCore(), chiavePPCore(), chiavePPCore()])), []);
    assert.ok(core.validaOutputAI(outputValidoConChiavi(Array.from({ length: 4 }, () => chiavePPCore()))).some((m) => /al massimo 3/.test(m)));
    const r1 = await run({ modello: [outputValido()] });
    assert.equal(r1.error, null);
    assert.deepEqual(r1.store.ppu_schede_d[0].contenutoAI.chiaviPsicoPedagogiche, []);
    assert.equal(typeof core.valutaSufficienzaDatiPerChiavi, 'function');
    assert.equal(core.verificaBloccoEpistemico({ chiaviPsicoPedagogiche: [{}] }, false).length, 1);
    assert.equal(core.SOGLIE_SUFFICIENZA.AB_ENTRAMBI_MIN, 4);
  });

  test('I - caso1 (18+18, discrepanza): sufficiente, chiavi ammesse, fonti valide', () => {
    const rispPiena = (v) => {
      const r = {};
      for (const p of core.PILASTRI_ID) for (const n of ['01', '02', '03']) r[p + '_' + n] = v;
      return r;
    };
    const p = core.costruisciPayload({
      a: schedaA({ risposte: rispPiena(3) }), b: schedaB({ risposte: rispPiena(1) }), c: schedaC(),
      ppuMoment: 'ingresso', ppuMomentNote: '',
    });
    assert.equal(core.valutaSufficienzaDatiPerChiavi(p).sufficiente, true);
    const out = { pilastri: [], letturaTrasversale: {}, chiaviPsicoPedagogiche: [{ fonti: [
      { scheda: 'A', pilastro: 'others', elementoId: 'others_01' },
      { scheda: 'B', pilastro: 'others', elementoId: 'others_01' },
    ] }] };
    assert.deepEqual(core.verificaFontiSemantica(out, p), []);
  });

  test('J - caso5 (dati poveri): insufficiente, chiaviPsicoPedagogiche=[] imposto, teoria respinta', async () => {
    const A = schedaA({
      risposte: { others_02: 1, wellbeing_01: 2, self_01: 'NO', others_01: 'NO', environment_01: 'NO', future_01: 'NO', expression_01: 'NO' },
      closing: { perceivedStrength: '', desiredImprovement: '', chosenGrowthArea: '' },
    });
    const B = schedaB({ risposte: { wellbeing_01: 2, self_01: 'NO' } });
    const cPov = schedaC({ sociogrammi: {
      vicinanza: { nodes: [{ id: 'io', isCenter: true, name: 'IO', x: 0.5, y: 0.5 }, { id: 'n_z', name: 'Z', x: 0.8, y: 0.7, distance: 0.6 }], edges: [] },
      fatica: { nodes: [{ id: 'io', isCenter: true, name: 'IO', x: 0.5, y: 0.5 }], edges: [] },
    } });
    const seed = baseSeed({ ppu_schede_a: [A], ppu_schede_b: [B], ppu_schede_c: [cPov] });
    const p = core.costruisciPayload({ a: A, b: B, c: cPov, ppuMoment: 'ingresso', ppuMomentNote: '' });
    assert.equal(core.valutaSufficienzaDatiPerChiavi(p).sufficiente, false);
    const conChiave = outputValidoConChiavi([chiavePPCore({ fonti: [{ scheda: 'A', pilastro: 'wellbeing', elementoId: 'wellbeing_01' }] })]);
    const r1 = await run({ seed, modello: [conChiave, conChiave] });
    assert.equal(r1.error.code, 'internal');
    const r2 = await run({ seed, modello: [outputValido()] });
    assert.deepEqual(r2.store.ppu_schede_d[0].contenutoAI.chiaviPsicoPedagogiche, []);
  });

  test('K - la gestione fonti non introduce areaNotes/note/nomi fuori allowlist', () => {
    const A = schedaA({ risposte: { self_01: 3 }, areaNotes: { self: 'SENTINEL_AN_A' }, closing: { perceivedStrength: 'SENTINEL_CLOS', desiredImprovement: '', chosenGrowthArea: '' } });
    const B = schedaB({ risposte: { self_01: 2 }, areaNotes: { self: 'SENTINEL_AN_B' } });
    const C = schedaC({ note: 'SENTINEL_C_NOTE' });
    const p = core.costruisciPayload({ a: A, b: B, c: C, ppuMoment: 'ingresso', ppuMomentNote: '' });
    const msg = core.costruisciMessaggiModello({ payload: p, precedente: null, errori: null });
    const blob = JSON.stringify(msg);
    for (const s of ['SENTINEL_AN_A', 'SENTINEL_AN_B', 'SENTINEL_C_NOTE']) assert.ok(!blob.includes(s), s);
    // areaNotes / note generale C non entrano né nel payload né nell'elenco fonti
    assert.ok(!JSON.stringify(p).includes('SENTINEL_AN_A') && !JSON.stringify(p).includes('SENTINEL_C_NOTE'));
    // "SENTINEL_CLOS" (testo di una risposta di chiusura) è nel payload DATI ma NON nell'elenco FONTI CITABILI (solo id)
    assert.ok(!core.elencoFontiCitabiliTesto(p).includes('SENTINEL_CLOS'));
  });

  test('L - "perceivedStrength" come pilastro NON viene convertito automaticamente: solo respinto', () => {
    const p = payloadStd();
    const out = wrapFonte({ scheda: 'A', pilastro: 'perceivedStrength', elementoId: 'self_01' });
    const before = JSON.parse(JSON.stringify(out));
    const errs = core.verificaFontiSemantica(out, p);
    assert.ok(errs.length >= 1);
    assert.deepEqual(out, before);
    assert.equal(out.chiaviPsicoPedagogiche[0].fonti[0].pilastro, 'perceivedStrength');
  });
});
