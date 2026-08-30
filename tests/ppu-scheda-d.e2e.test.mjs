// tests/ppu-scheda-d.e2e.test.mjs — COLLAUDO INTEGRATO (Passo 6), tier "lifecycle".
//
// Attraversa TUTTA l'orchestrazione reale della generazione
// (functions/schedaDCore.js) + la logica pura di consultazione/versionamento
// (js/ppu-scheda-d-model.js), con questi confini SIMULATI:
//   - Firestore  → fake in-memory (nessun emulatore qui: tier "rules"/"integration");
//   - Anthropic  → client iniettato (mai chiamate reali);
//   - onCall/Auth/Admin SDK → non attraversati (il wrapper functions/schedaD.js è
//     un adattatore sottile: mappa AppError→HttpsError e costruisce le deps reali).
//
//   node --test tests/ppu-scheda-d.e2e.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';

import core from '../functions/schedaDCore.js';
import {
  raggruppaFontiPerMomento, elencaMomenti, confrontaFontiConGruppo, ricostruisciFonte,
} from '../js/ppu-scheda-d-model.js';

// ── Fake Firestore (stessa superficie usata da core.eseguiGenerazione) ──
function makeDb(seed = {}) {
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
  const rows = (name) => {
    const raw = store[name];
    return Array.isArray(raw) ? raw : Object.entries(raw).map(([id, d]) => ({ id, ...d }));
  };
  const snap = (id, d) => (d
    ? { exists: true, id, data: () => { const c = { ...d }; delete c.id; return c; } }
    : { exists: false, id, data: () => undefined });
  const query = (name, filters) => ({
    where(f, _op, v) { return query(name, filters.concat([[f, v]])); },
    async get() {
      const list = rows(name).filter((r) => filters.every(([f, v]) => r[f] === v));
      return { empty: list.length === 0, docs: list.map((r) => ({ id: r.id, data: () => { const c = { ...r }; delete c.id; return c; } })) };
    },
  });
  const collection = (name) => {
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
        addCounter += 1;
        const id = `${name}_gen_${addCounter}`;
        store[name].push({ id, ...data });
        return { id };
      },
    };
  };
  return { collection, __store: store };
}

function makeModello(items) {
  const state = { i: 0, calls: [] };
  const fn = async ({ system, messages }) => {
    state.calls.push({ system, messages });
    const it = items[state.i] !== undefined ? items[state.i] : items[items.length - 1];
    state.i += 1;
    if (it && it.__throw) throw new Error('provider down');
    if (typeof it === 'string') return { text: it, model: 'claude-e2e' };
    if (it && typeof it.text === 'string') return { text: it.text, model: it.model || 'claude-e2e' };
    return { text: JSON.stringify(it), model: 'claude-e2e' };
  };
  return { fn, state };
}

// ── Dati sintetici del ragazzo fittizio (§4) ──────────────────────────
const MIN = 'e2e-min';
const COM = 'itaca';
const COORD = 'e2e-coord';
// sentinelle per l'audit privacy: NON devono comparire nel payload
const S_NOME = 'Nome-COGNOME-Fittizio';
const S_DOB = '2011-03-14';
const S_EMAIL = 'famiglia@example.test';
const S_AREANOTE_A = 'SENTINEL_AREANOTE_A_e2e';
const S_AREANOTE_B = 'SENTINEL_AREANOTE_B_e2e';
const S_NOTE_C = 'SENTINEL_NOTE_GENERALE_C_e2e';
const S_NOTE_NODO = 'SENTINEL_NOTA_NODO_C_e2e';

function schedaA(o = {}) {
  return {
    id: 'A-ing-1', minorId: MIN, comunitaId: COM, status: 'completata',
    ppuMoment: 'ingresso', ppuMomentNote: '', completedAt: 1000,
    // convergenza self_01 (A=3, B=3); discrepanza self_02 (A=3, B=1);
    // self_03 non compilata in A (chiave assente); others_01 non compilata in A
    risposte: { self_01: 3, self_02: 3, others_02: 2, environment_01: 1 },
    closing: { perceivedStrength: 'So ascoltare gli altri quando hanno un problema', desiredImprovement: '', chosenGrowthArea: '' },
    areaNotes: { self: S_AREANOTE_A, others: 'nota educatore riservata' },
    ...o,
  };
}
function schedaB(o = {}) {
  return {
    id: 'B-ing-1', minorId: MIN, comunitaId: COM, status: 'completata',
    ppuMoment: 'ingresso', ppuMomentNote: '', completedAt: 1000, instrumentVersion: 1,
    // self_01=3 (converge con A), self_02=1 (discrepa da A), self_03='NO' (un "NO")
    risposte: { self_01: 3, self_02: 1, self_03: 'NO', others_02: 3 },
    areaNotes: { self: S_AREANOTE_B },
    ...o,
  };
}
function schedaC(o = {}) {
  return {
    id: 'C-ing-1', minorId: MIN, comunitaId: COM, status: 'completata',
    ppuMoment: 'ingresso', ppuMomentNote: '', completedAt: 1000, instrumentVersion: 1,
    note: S_NOTE_C,
    sociogrammi: {
      vicinanza: {
        nodes: [
          { id: 'io', isCenter: true, name: 'IO', x: 0.5, y: 0.5 },
          { id: 'n_mamma', name: 'Mamma', x: 0.42, y: 0.44, distance: 0.18, note: S_NOTE_NODO },
          { id: 'n_amico', name: 'Luca', x: 0.7, y: 0.55, distance: 0.42 },
        ],
        edges: [{ id: 'e_vic_1', source: 'io', target: 'n_mamma', direction: 'both', quality: 'green' }], // legame positivo
      },
      fatica: {
        nodes: [
          { id: 'io', isCenter: true, name: 'IO', x: 0.5, y: 0.5 },
          { id: 'n_prof', name: 'Prof. Bianchi', x: 0.6, y: 0.3, distance: 0.3 },
        ],
        edges: [{ id: 'e_fat_1', source: 'io', target: 'n_prof', direction: 'forward', quality: 'red' }], // legame faticoso
      },
    },
    ...o,
  };
}

function outputValido() {
  const pilastri = core.PILASTRI_ID.map((pid) => ({
    pilastro: pid,
    comeMiVedo: `A ${pid}: quadro articolato.`,
    comeMiVedonoGliAltri: `B ${pid}: lettura corrispondente.`,
    elementiRete: 'La Scheda C non contiene elementi pertinenti per questo pilastro.',
    convergenzeDiscrepanze: { convergenze: 'concordano su alcuni aspetti', discrepanze: 'una discrepanza descritta', datiInsufficienti: '' },
    letturaEducativaPossibile: 'potrebbe essere utile esplorare con il ragazzo…',
    aspettoDaApprofondire: 'Cosa si osserva nella vita quotidiana?',
    fonti: [{ scheda: 'A', pilastro: pid, elementoId: `${pid}_01` }],
  }));
  // pilastro self: cita indicatori + closing + rete reali del payload
  pilastri[0].fonti = [
    { scheda: 'A', pilastro: 'self', elementoId: 'self_02' },
    { scheda: 'B', pilastro: 'self', elementoId: 'self_02' },
    { scheda: 'A', pilastro: 'self', elementoId: 'perceivedStrength' },
  ];
  pilastri[1].fonti = [
    { scheda: 'A', pilastro: 'others', elementoId: 'others_02' },
    { scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:persona:n_mamma' },
    { scheda: 'C', pilastro: 'others', elementoId: 'fatica:legame:e_fat_1' },
  ];
  return {
    sintesiGenerale: 'Sintesi generale sintetica e priva di giudizi globali.',
    pilastri,
    letturaTrasversale: {
      risorse: [{ testo: 'una risorsa', fonti: [{ scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:legame:e_vic_1' }] }],
      aspettiAttenzione: [{ testo: 'un aspetto', fonti: [{ scheda: 'A', pilastro: 'self', elementoId: 'self_02' }] }],
      elementiDaApprofondire: [{ testo: 'un elemento', fonti: [{ scheda: 'B', pilastro: 'self', elementoId: 'self_03' }] }],
    },
  };
}
const clone = (x) => JSON.parse(JSON.stringify(x));

function baseSeed(over = {}) {
  return {
    utenti: { [MIN]: { nome: S_NOME, dataNascita: S_DOB, email: S_EMAIL, comunitaId: COM } },
    staff: { [COORD]: { nome: 'Coord E2E', ruolo: 'coordinatrice', comunitaId: COM } },
    ppu_schede_a: [schedaA()],
    ppu_schede_b: [schedaB()],
    ppu_schede_c: [schedaC()],
    ...over,
  };
}

async function genera(db, modello, dataOver = {}, uid = COORD) {
  return core.eseguiGenerazione({
    db,
    auth: uid === null ? null : { uid },
    data: { minorId: MIN, comunitaId: COM, ppuMoment: 'ingresso', ...dataOver },
    chiamaModello: modello.fn,
    modelloAIdefault: 'modello-default',
    serverTimestamp: () => 5_000,
    now: () => 5_000,
    logger: { info() {}, warn() {}, error() {} },
  });
}

const LOOKUP = {
  domandaA: Object.fromEntries(core.AB_INDICATORS.map((id) => [id, `[domanda A ${id}]`])),
  opzioniA: core.OPZIONI_A,
  domandaB: Object.fromEntries(core.AB_INDICATORS.map((id) => [id, `[domanda B ${id}]`])),
  opzioniB: core.OPZIONI_B,
  chiusuraA: core.DOMANDE_CHIUSURA,
};

// ═══════════════════════════════════════════════════════════════════════
test('E2E · generazione D1: percorso operatore autorizzato → INGRESSO generabile', async () => {
  const db = makeDb(baseSeed());
  const listaA = [{ id: 'A-ing-1', ...schedaA() }];

  // gating UI: la riga INGRESSO risulta DA_GENERARE
  const gruppi = raggruppaFontiPerMomento([schedaA()], [schedaB()], [schedaC()]);
  const righe = elencaMomenti(gruppi, []);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].stato, 'DA_GENERARE');
  assert.equal(righe[0].generabile, true);

  const m = makeModello([outputValido()]);
  const res = await genera(db, m);
  assert.equal(m.state.calls.length, 1);

  const d1 = db.__store.ppu_schede_d[0];
  assert.equal(db.__store.ppu_schede_d.length, 1);
  assert.equal(res.schedaDId, d1.id);
  // §5 — contenuto del documento
  assert.equal(d1.minorId, MIN);
  assert.equal(d1.comunitaId, COM);
  assert.equal(d1.ppuMoment, 'ingresso');
  assert.equal(d1.sourceAId, 'A-ing-1');
  assert.equal(d1.sourceBId, 'B-ing-1');
  assert.equal(d1.sourceCId, 'C-ing-1');
  assert.equal(d1.fonti.a.schedaId, 'A-ing-1');
  assert.equal(d1.fonti.b.instrumentVersion, 1);
  assert.equal(d1.modelloAI, 'claude-e2e');
  assert.equal(d1.promptVersion, core.PROMPT_VERSION);
  assert.ok(d1.contenutoAI && Array.isArray(d1.contenutoAI.pilastri) && d1.contenutoAI.pilastri.length === 6);
  assert.equal(d1.notaMetodologica, core.NOTA_METODOLOGICA);
  assert.equal(d1.stato, 'GENERATA');
  assert.equal(d1.validatedAt, null);
  assert.equal(d1.validatedBy, null);
  assert.equal(d1.rilettura, null);
  assert.ok(!('notaMetodologica' in d1.contenutoAI));
});

test('E2E · §6 privacy del payload inviato al provider AI', async () => {
  const db = makeDb(baseSeed());
  const m = makeModello([outputValido()]);
  await genera(db, m);
  const userMsg = m.state.calls[0].messages.find((x) => x.role === 'user').content;
  const blob = JSON.stringify(m.state.calls[0].messages);

  // NON inviati
  for (const s of [S_NOME, 'COGNOME', S_DOB, S_EMAIL, COORD, S_AREANOTE_A, S_AREANOTE_B, S_NOTE_C, S_NOTE_NODO, 'nota educatore riservata']) {
    assert.ok(!blob.includes(s), `il payload NON deve contenere "${s}"`);
  }
  // inviati (previsti)
  assert.ok(blob.includes(core.OPZIONI_A.self_02['3']), 'testo opzione A scelta');   // A.risposte
  assert.ok(blob.includes(core.OPZIONI_B.self_03.NO), 'testo opzione B "NO"');
  assert.ok(blob.includes('So ascoltare gli altri quando hanno un problema'), 'A.closing');
  assert.ok(blob.includes('Mamma') && blob.includes('Prof. Bianchi'), 'C.sociogrammi persone');
  assert.ok(userMsg.includes('"distanzaDalCentro"'), 'C distanza minimizzata');
  assert.ok(m.state.calls[0].system.includes('Scheda D'), 'system prompt presente');
  // NIENTE coordinate grafiche grezze x/y
  assert.ok(!/"x":\s*0\.42/.test(blob) && !/"y":\s*0\.44/.test(blob), 'niente x/y grezzi');
});

test('E2E · §7 tracciabilità: ricostruzione fonti dai documenti CONGELATI', async () => {
  const db = makeDb(baseSeed());
  const m = makeModello([outputValido()]);
  await genera(db, m);
  const d1 = db.__store.ppu_schede_d[0];

  const load = async (coll, id) => {
    const s = await db.collection(coll).doc(id).get();
    return s.exists ? { id, ...s.data() } : null;
  };
  const ctx = {
    schedaA: await load('ppu_schede_a', d1.sourceAId),
    schedaB: await load('ppu_schede_b', d1.sourceBId),
    schedaC: await load('ppu_schede_c', d1.sourceCId),
    ...LOOKUP,
  };

  const fA = ricostruisciFonte({ scheda: 'A', pilastro: 'self', elementoId: 'self_02' }, ctx);
  assert.equal(fA.tipo, 'indicatore');
  assert.equal(fA.valore, 3);                        // valore CONGELATO
  assert.equal(fA.testoRisposta, core.OPZIONI_A.self_02['3']);

  const fB = ricostruisciFonte({ scheda: 'B', pilastro: 'self', elementoId: 'self_02' }, ctx);
  assert.equal(fB.valore, 1);

  const fClose = ricostruisciFonte({ scheda: 'A', pilastro: 'self', elementoId: 'perceivedStrength' }, ctx);
  assert.equal(fClose.tipo, 'chiusura');
  assert.equal(fClose.risposta, 'So ascoltare gli altri quando hanno un problema');

  const fPers = ricostruisciFonte({ scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:persona:n_mamma' }, ctx);
  assert.equal(fPers.nome, 'Mamma');
  assert.equal(fPers.distanza, 0.18);

  const fLeg = ricostruisciFonte({ scheda: 'C', pilastro: 'others', elementoId: 'fatica:legame:e_fat_1' }, ctx);
  assert.equal(fLeg.kind, 'legame');
  assert.equal(fLeg.da, 'IO');
  assert.equal(fLeg.a, 'Prof. Bianchi');
  assert.ok(/diffic/i.test(fLeg.qualita));
});

test('E2E · §8 fonti CONGELATE: nuova A più recente → D1 intatta, D2 usa la nuova', async () => {
  const db = makeDb(baseSeed());
  const m = makeModello([outputValido(), outputValido()]);

  await genera(db, m);
  const d1 = clone(db.__store.ppu_schede_d[0]);
  assert.equal(d1.sourceAId, 'A-ing-1');

  // arriva una NUOVA Scheda A dello stesso momento, più recente, con self_02 diverso
  db.__store.ppu_schede_a.push(schedaA({ id: 'A-ing-2', completedAt: 9000, risposte: { self_01: 3, self_02: 1 } }));

  // la UI rileva "dati più recenti"
  const gruppi = raggruppaFontiPerMomento(db.__store.ppu_schede_a, [schedaB()], [schedaC()]);
  const nov = confrontaFontiConGruppo(d1, gruppi[0]);
  assert.deepEqual(nov.piuRecenti, ['A']);
  assert.equal(nov.haNovita, true);

  await genera(db, m);   // "Genera nuova versione"
  assert.equal(db.__store.ppu_schede_d.length, 2);
  const d2 = db.__store.ppu_schede_d[1];
  assert.notEqual(d2.id, d1.id);
  assert.equal(d2.sourceAId, 'A-ing-2');            // D2 congela la NUOVA A
  // D1 invariata
  assert.deepEqual(db.__store.ppu_schede_d[0], d1);

  // la ricostruzione fonte di D1 mostra ancora il valore VECCHIO
  const s = await db.collection('ppu_schede_a').doc(d1.sourceAId).get();
  const fA = ricostruisciFonte({ scheda: 'A', pilastro: 'self', elementoId: 'self_02' }, { schedaA: { id: d1.sourceAId, ...s.data() }, ...LOOKUP });
  assert.equal(fA.valore, 3);
});

test('E2E · §9 nessun mix tra momenti: verifica_3_mesi senza C non è generabile', async () => {
  const db = makeDb(baseSeed({
    ppu_schede_a: [schedaA(), schedaA({ id: 'A-v3', ppuMoment: 'verifica_3_mesi', completedAt: 4000 })],
    ppu_schede_b: [schedaB(), schedaB({ id: 'B-v3', ppuMoment: 'verifica_3_mesi', completedAt: 4000 })],
    ppu_schede_c: [schedaC()],   // C solo per 'ingresso'
  }));
  const m = makeModello([outputValido()]);

  await assert.rejects(
    () => genera(db, m, { ppuMoment: 'verifica_3_mesi' }),
    (e) => e instanceof core.AppError && e.code === 'failed-precondition' && /Scheda C/.test(e.message),
  );
  assert.equal(m.state.calls.length, 0, 'il modello NON deve essere interrogato');
  assert.equal(db.__store.ppu_schede_d.length, 0);

  // selezione autorevole: per verifica_3_mesi la C è null (NON la C di ingresso)
  const terna = core.selezionaTerna({
    schedeA: db.__store.ppu_schede_a, schedeB: db.__store.ppu_schede_b, schedeC: db.__store.ppu_schede_c,
    ppuMoment: 'verifica_3_mesi', ppuMomentNote: '',
  });
  assert.equal(terna.c, null);
  assert.deepEqual(terna.mancanti, ['C']);
});

test('E2E · §15 errori AI: nessun documento parziale, messaggi senza dati tecnici', async () => {
  // due output non-JSON → nessuna D
  {
    const db = makeDb(baseSeed());
    const m = makeModello(['non json', 'ancora non json']);
    await assert.rejects(() => genera(db, m), (e) => e.code === 'internal' && /coerenza/i.test(e.message));
    assert.equal(db.__store.ppu_schede_d.length, 0);
  }
  // primo output errato (pilastri mancanti) → retry valido → D salvata (2 tentativi)
  {
    const db = makeDb(baseSeed());
    const bad = clone(outputValido()); bad.pilastri = bad.pilastri.slice(0, 4);
    const m = makeModello([bad, outputValido()]);
    await genera(db, m);
    assert.equal(db.__store.ppu_schede_d.length, 1);
    assert.equal(db.__store.ppu_schede_d[0].tentativiGenerazione, 2);
  }
  // fonte A inesistente poi valido → 2 tentativi
  {
    const db = makeDb(baseSeed());
    const bad = clone(outputValido()); bad.pilastri[0].fonti[0].elementoId = 'self_99';
    const m = makeModello([bad, outputValido()]);
    await genera(db, m);
    assert.equal(db.__store.ppu_schede_d[0].tentativiGenerazione, 2);
  }
  // fonte C inventata due volte → nessuna D
  {
    const db = makeDb(baseSeed());
    const bad = clone(outputValido()); bad.pilastri[1].fonti.push({ scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:persona:FANTASMA' });
    const m = makeModello([bad, bad]);
    await assert.rejects(() => genera(db, m), (e) => e.code === 'internal');
    assert.equal(db.__store.ppu_schede_d.length, 0);
  }
  // provider indisponibile → messaggio leggibile, nessun dato tecnico
  {
    const db = makeDb(baseSeed());
    const m = makeModello([{ __throw: true }]);
    let err;
    try { await genera(db, m); } catch (e) { err = e; }
    assert.equal(err.code, 'unavailable');
    for (const leak of [S_NOME, S_EMAIL, 'system', 'DATI (JSON)', 'apiKey', 'stack', S_AREANOTE_A]) {
      assert.ok(!String(err.message).includes(leak), `errore non deve esporre "${leak}"`);
    }
  }
});

test('E2E · §16 concorrenza generazione: lock esclusivo + lock scaduto', async () => {
  const key = core.lockKey(MIN, COM, 'ingresso', '');

  // lock fresco già presente → la nuova richiesta riceve "aborted", nessuna chiamata AI
  {
    const db = makeDb(baseSeed({ ppu_schede_d_locks: { [key]: { startedAt: 4990, by: 'altro' } } }));
    const m = makeModello([outputValido()]);
    await assert.rejects(() => genera(db, m), (e) => e.code === 'aborted');
    assert.equal(m.state.calls.length, 0);
    assert.equal(db.__store.ppu_schede_d.length, 0);
    assert.ok(db.__store.ppu_schede_d_locks[key], 'il lock altrui resta');
  }
  // lock scaduto → viene rubato e la generazione procede
  {
    const db = makeDb(baseSeed({ ppu_schede_d_locks: { [key]: { startedAt: 5_000 - 10 * 60 * 1000 } } }));
    const m = makeModello([outputValido()]);
    await genera(db, m);
    assert.equal(db.__store.ppu_schede_d.length, 1);
  }
  // due richieste "contemporanee" sullo stesso momento → una sola D
  {
    const db = makeDb(baseSeed());
    const m = makeModello([outputValido(), outputValido()]);
    const esiti = await Promise.allSettled([genera(db, m), genera(db, m)]);
    const ok = esiti.filter((e) => e.status === 'fulfilled');
    const ko = esiti.filter((e) => e.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(ko.length, 1);
    assert.equal(ko[0].reason.code, 'aborted');
    assert.equal(db.__store.ppu_schede_d.length, 1);
  }
});

test('E2E · §19 audit permessi (livello Function): verificaAccessoPPU + coerenza ragazzo↔comunità', async () => {
  const db = makeDb(baseSeed({
    staff: {
      [COORD]: { ruolo: 'coordinatrice', comunitaId: COM },
      'resp-altra': { ruolo: 'responsabile', comunitaId: 'macrame' },
      'staff-docs': { ruolo: 'educatore', comunitaId: COM, accessoDocumenti: true },
      'staff-plain': { ruolo: 'educatore', comunitaId: COM },
    },
  }));
  assert.equal(await core.verificaAccessoPPU(db, core.ADMIN_UID, COM), true);
  assert.equal(await core.verificaAccessoPPU(db, COORD, COM), true);
  assert.equal(await core.verificaAccessoPPU(db, 'staff-docs', COM), true);
  assert.equal(await core.verificaAccessoPPU(db, 'staff-plain', COM), false);
  assert.equal(await core.verificaAccessoPPU(db, 'resp-altra', COM), false);
  assert.equal(await core.verificaAccessoPPU(db, 'ignoto', COM), false);
  assert.equal(await core.verificaAccessoPPU(db, null, COM), false);

  // non autenticato / non autorizzato / ragazzo di altra comunità
  const m = makeModello([outputValido()]);
  await assert.rejects(() => genera(db, m, {}, null), (e) => e.code === 'unauthenticated');
  await assert.rejects(() => genera(db, m, {}, 'staff-plain'), (e) => e.code === 'permission-denied');
  const db2 = makeDb(baseSeed({ utenti: { [MIN]: { comunitaId: 'macrame' } } }));
  await assert.rejects(() => genera(db2, m), (e) => e.code === 'failed-precondition' && /non appartiene alla comunità/.test(e.message));
});
