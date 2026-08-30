// tests/ppu-scheda-d.integration.test.mjs — COLLAUDO INTEGRATO (Passo 6),
// tier "integration": Firestore EMULATOR reale + firestore.rules reali + model
// puro reale (js/ppu-scheda-d-model.js). Copre rilettura d'équipe, multi-
// operatore, validazione, immutabilità post-validazione e sonde di sicurezza.
//
// Confine simulato: la D viene seminata via withSecurityRulesDisabled (ciò che
// in produzione fa la Cloud Function via Admin SDK — l'unico modo di creare una
// D); la raccolta valori dal DOM è sostituita da mappe di valori dirette.
//
//   npm run test:rules   (gira sotto firebase emulators:exec, insieme ai file
//                         *.rules.test.mjs)

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp } from 'firebase/firestore';

import {
  elencaElementiRilettura, costruisciRiletturaDaValori, validaRiletturaEquipe,
  riletturaSignificativa, mergeRiletturaBy, PILASTRI_ID,
} from '../js/ppu-scheda-d-model.js';

const PROJECT_ID = 'demo-campo-dei-fiori-test';
const ADMIN_UID = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';
const U = {
  admin: ADMIN_UID,
  op1: 'int-op1',        // coordinatrice Itaca
  op2: 'int-op2',        // educatrice Itaca con accessoDocumenti
  altra: 'int-altra',    // coordinatrice di un'altra comunità
  ragazzo: 'int-ragazzo',
};

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1', port: 8080,
    },
  });
});
after(async () => { await env.cleanup(); });

// contenutoAI realistico: 6 pilastri + lettura trasversale con qualche voce
function contenutoAI() {
  return {
    sintesiGenerale: 'sintesi',
    pilastri: PILASTRI_ID.map((pid) => ({
      pilastro: pid,
      comeMiVedo: 'a', comeMiVedonoGliAltri: 'b', elementiRete: 'c',
      convergenzeDiscrepanze: { convergenze: '', discrepanze: 'd', datiInsufficienti: '' },
      letturaEducativaPossibile: `ipotesi ${pid}`,
      aspettoDaApprofondire: `approfondire ${pid}`,
      fonti: [{ scheda: 'A', pilastro: pid, elementoId: `${pid}_01` }],
    })),
    letturaTrasversale: {
      risorse: [{ testo: 'risorsa 1', fonti: [] }],
      aspettiAttenzione: [{ testo: 'attenzione 1', fonti: [] }],
      elementiDaApprofondire: [{ testo: 'approfondire 1', fonti: [] }],
    },
  };
}

function docD(over = {}) {
  return {
    minorId: 'int-min', comunitaId: 'itaca', createdBy: U.op1,
    stato: 'GENERATA', generatedAt: serverTimestamp(),
    ppuMoment: 'ingresso', ppuMomentNote: '',
    sourceAId: 'A1', sourceBId: 'B1', sourceCId: 'C1',
    fonti: { a: { schedaId: 'A1', completedAt: 1000 }, b: { schedaId: 'B1', completedAt: 1000 }, c: { schedaId: 'C1', completedAt: 1000 } },
    modelloAI: 'claude-int', promptVersion: 1,
    contenutoAI: contenutoAI(),
    notaMetodologica: 'nota fissa',
    tentativiGenerazione: 1,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    validatedAt: null, validatedBy: null, rilettura: null,
    ...over,
  };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staff', U.op1), { nome: 'Op Uno', ruolo: 'coordinatrice', comunitaId: 'itaca' });
    await setDoc(doc(db, 'staff', U.op2), { nome: 'Op Due', ruolo: 'educatore', comunitaId: 'itaca', accessoDocumenti: true });
    await setDoc(doc(db, 'staff', U.altra), { nome: 'Op Altra', ruolo: 'coordinatrice', comunitaId: 'macrame' });
    // D principale del collaudo (simula la scrittura della Cloud Function)
    await setDoc(doc(db, 'ppu_schede_d', 'D2'), docD());
    // D separata per la validazione DIRETTA da GENERATA
    await setDoc(doc(db, 'ppu_schede_d', 'D_dir'), docD({ minorId: 'int-min2' }));
  });
}

beforeEach(async () => { await env.clearFirestore(); await seed(); });

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const refD = (db, id = 'D2') => doc(db, 'ppu_schede_d', id);

// Riproduce ciò che fa js/ppu-scheda-d.js::wireRilettura (senza DOM): transazione
// che rilegge il doc, costruisce/valida la rilettura, aggiorna solo i campi
// consentiti. Ritorna { stato } o lancia.
async function scriviRilettura(db, { uid, valori = {}, osservazioniGenerali = '', valida = false, id = 'D2' }) {
  const ref = refD(db, id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('assente');
    const cur = snap.data();
    if (cur.stato === 'VALIDATA') throw new Error('gia_validata');
    const contenuto = cur.contenutoAI;
    const ril = costruisciRiletturaDaValori({
      valori, osservazioniGenerali,
      riletturaByEsistente: (cur.rilettura && cur.rilettura.riletturaBy) || [],
      uid,
    }, contenuto);
    const errs = validaRiletturaEquipe(ril, contenuto);
    if (errs.length) throw new Error('rilettura_non_valida: ' + errs.join(' '));
    const significativa = riletturaSignificativa(ril);
    const patch = { updatedAt: serverTimestamp() };
    const rilTs = { ...ril, riletturaAt: serverTimestamp() };
    if (valida) {
      patch.stato = 'VALIDATA';
      patch.validatedBy = uid;
      patch.validatedAt = serverTimestamp();
      if (significativa || cur.rilettura != null) patch.rilettura = rilTs;
    } else {
      if (significativa || cur.rilettura != null) patch.rilettura = rilTs;
      if (cur.stato === 'GENERATA' && significativa) patch.stato = 'IN_RILETTURA';
    }
    tx.update(ref, patch);
    return { stato: patch.stato || cur.stato };
  });
}

// chiavi rilettura reali derivate dal contenutoAI
const K = (() => {
  const el = elencaElementiRilettura(contenutoAI());
  return {
    selLet: el.find((e) => e.chiave === 'pilastro.self.letturaEducativaPossibile').chiave,
    selAsp: el.find((e) => e.chiave === 'pilastro.self.aspettoDaApprofondire').chiave,
    othLet: el.find((e) => e.chiave === 'pilastro.others.letturaEducativaPossibile').chiave,
    trRis: el.find((e) => e.chiave === 'trasversale.risorse.0').chiave,
  };
})();

// ═══════════════════════════════════════════════════════════════════════
describe('INT · rilettura primo operatore (§10)', () => {
  test('GENERATA → IN_RILETTURA; riletturaBy=[op1]; contenutoAI/fonti/source* invariati', async () => {
    const db = as(U.op1);
    const before = (await getDoc(refD(db))).data();

    await assertSucceeds(scriviRilettura(db, {
      uid: U.op1,
      valori: {
        [K.selLet]: { valutazione: 'conferma' },
        [K.selAsp]: { valutazione: 'integra', osservazioni: 'da precisare col ragazzo' },
        [K.othLet]: { valutazione: 'non_riscontra', osservazioni: 'non lo osserviamo' },
        [K.trRis]: { valutazione: 'da_approfondire' },
      },
      osservazioniGenerali: 'confronto in riunione del 20/09',
    }));

    const after = (await getDoc(refD(db))).data();
    assert.equal(after.stato, 'IN_RILETTURA');
    assert.deepEqual(after.rilettura.riletturaBy, [U.op1]);
    assert.ok(after.rilettura.riletturaAt);
    assert.equal(Object.keys(after.rilettura.ipotesi).length, 4);
    assert.equal(after.rilettura.ipotesi[K.selAsp].valutazione, 'integra');
    assert.equal(after.rilettura.osservazioniGenerali, 'confronto in riunione del 20/09');
    // immutabili
    assert.deepEqual(after.contenutoAI, before.contenutoAI);
    assert.deepEqual(after.fonti, before.fonti);
    assert.equal(after.sourceAId, before.sourceAId);
    assert.equal(after.sourceBId, before.sourceBId);
    assert.equal(after.sourceCId, before.sourceCId);
    assert.equal(after.validatedAt, null);
    assert.equal(after.validatedBy, null);
  });

  test('apri e chiudi senza modifiche → nessun cambio stato (§12 Passo 5)', async () => {
    const db = as(U.op1);
    await assertSucceeds(scriviRilettura(db, { uid: U.op1, valori: {}, osservazioniGenerali: '' }));
    assert.equal((await getDoc(refD(db))).data().stato, 'GENERATA');
  });
});

describe('INT · secondo operatore (§11)', () => {
  test('op2 vede la rilettura di op1, modifica e salva → riletturaBy=[op1, op2], nessun UID perso', async () => {
    await assertSucceeds(scriviRilettura(as(U.op1), {
      uid: U.op1, valori: { [K.selLet]: { valutazione: 'conferma' } }, osservazioniGenerali: '',
    }));
    // op2 apre: vede la rilettura
    const vista = (await getDoc(refD(as(U.op2)))).data();
    assert.deepEqual(vista.rilettura.riletturaBy, [U.op1]);
    assert.equal(vista.rilettura.ipotesi[K.selLet].valutazione, 'conferma');

    // op2 modifica un elemento e salva (ripassa i valori esistenti + il proprio cambio)
    await assertSucceeds(scriviRilettura(as(U.op2), {
      uid: U.op2,
      valori: {
        [K.selLet]: { valutazione: 'conferma' },
        [K.othLet]: { valutazione: 'integra', osservazioni: 'aggiunta di op2' },
      },
      osservazioniGenerali: '',
    }));

    const finale = (await getDoc(refD(as(U.op1)))).data();
    assert.deepEqual([...finale.rilettura.riletturaBy].sort(), [U.op1, U.op2].sort());
    assert.equal(finale.rilettura.ipotesi[K.othLet].osservazioni, 'aggiunta di op2');
    assert.equal(finale.stato, 'IN_RILETTURA');
  });

  test('mergeRiletturaBy: sequenza op1→op2→op1 non perde nessuno', () => {
    let by = [];
    by = mergeRiletturaBy(by, U.op1);
    by = mergeRiletturaBy(by, U.op2);
    by = mergeRiletturaBy(by, U.op1);
    assert.deepEqual(by, [U.op1, U.op2]);
  });
});

describe('INT · validazione (§12) e immutabilità post-validazione (§13)', () => {
  test('op2 valida D2 da IN_RILETTURA: stato/validatedBy/validatedAt/rilettura preservata/contenuto invariato', async () => {
    await scriviRilettura(as(U.op1), { uid: U.op1, valori: { [K.selLet]: { valutazione: 'conferma', osservazioni: 'ok' } }, osservazioniGenerali: 'nota' });
    const before = (await getDoc(refD(as(U.op2)))).data();

    await assertSucceeds(scriviRilettura(as(U.op2), {
      uid: U.op2, valida: true,
      valori: { [K.selLet]: { valutazione: 'conferma', osservazioni: 'ok' } },
      osservazioniGenerali: 'nota',
    }));

    const v = (await getDoc(refD(as(U.op2)))).data();
    assert.equal(v.stato, 'VALIDATA');
    assert.equal(v.validatedBy, U.op2);
    assert.ok(v.validatedAt);
    assert.equal(v.rilettura.ipotesi[K.selLet].valutazione, 'conferma');
    assert.ok([...v.rilettura.riletturaBy].includes(U.op1) && [...v.rilettura.riletturaBy].includes(U.op2));
    assert.deepEqual(v.contenutoAI, before.contenutoAI);
    assert.deepEqual(v.fonti, before.fonti);
  });

  test('D VALIDATA: ogni update client è negato; delete admin negato', async () => {
    // porta D2 a VALIDATA
    await scriviRilettura(as(U.op1), { uid: U.op1, valida: true, valori: { [K.selLet]: { valutazione: 'conferma' } }, osservazioniGenerali: '' });

    const d1 = as(U.op1);
    await assertFails(updateDoc(refD(d1), { rilettura: { ipotesi: {}, osservazioniGenerali: 'x', riletturaBy: [U.op1], riletturaAt: serverTimestamp() } }));
    await assertFails(updateDoc(refD(d1), { stato: 'IN_RILETTURA' }));
    await assertFails(updateDoc(refD(d1), { updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(refD(d1), { contenutoAI: { hacked: true } }));
    await assertFails(updateDoc(refD(d1), { sourceAId: 'X' }));
    await assertFails(updateDoc(refD(d1), { fonti: {} }));
    await assertFails(updateDoc(refD(d1), { validatedBy: U.op2 }));
    await assertFails(deleteDoc(refD(as(U.admin))));
  });
});

describe('INT · validazione diretta da GENERATA (§14)', () => {
  test('nessuna rilettura → VALIDATA con rilettura null, validatedBy corretto, validatedAt timestamp', async () => {
    await assertSucceeds(scriviRilettura(as(U.op1), { uid: U.op1, valida: true, valori: {}, osservazioniGenerali: '', id: 'D_dir' }));
    const v = (await getDoc(refD(as(U.op1), 'D_dir'))).data();
    assert.equal(v.stato, 'VALIDATA');
    assert.equal(v.rilettura, null);
    assert.equal(v.validatedBy, U.op1);
    assert.ok(v.validatedAt);
  });
});

describe('INT · sonde di sicurezza sulla rilettura (§18)', () => {
  test('Q1 enum arbitrario: le Rules ATTUALI lo ACCETTANO (integrità rilettura, non fonte AI)', async () => {
    await assertSucceeds(updateDoc(refD(as(U.op1)), {
      stato: 'IN_RILETTURA',
      rilettura: { ipotesi: { [K.selLet]: { valutazione: 'valore_inventato' } }, osservazioniGenerali: '', riletturaBy: [U.op1], riletturaAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    }));
  });
  test('Q2 chiave ipotesi inesistente: le Rules ATTUALI la ACCETTANO', async () => {
    await assertSucceeds(updateDoc(refD(as(U.op1)), {
      stato: 'IN_RILETTURA',
      rilettura: { ipotesi: { 'chiave.totalmente.finta': { valutazione: 'conferma' } }, osservazioniGenerali: '', riletturaBy: [U.op1], riletturaAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    }));
  });
  test('Q3 modificare contenutoAI insieme alla rilettura → NEGATO', async () => {
    await assertFails(updateDoc(refD(as(U.op1)), {
      rilettura: { ipotesi: {}, osservazioniGenerali: 'x', riletturaBy: [U.op1], riletturaAt: serverTimestamp() },
      contenutoAI: { hacked: true }, updatedAt: serverTimestamp(),
    }));
  });
  test('Q3bis modificare fonti insieme alla rilettura → NEGATO', async () => {
    await assertFails(updateDoc(refD(as(U.op1)), {
      rilettura: { ipotesi: {}, osservazioniGenerali: 'x', riletturaBy: [U.op1], riletturaAt: serverTimestamp() },
      fonti: {}, updatedAt: serverTimestamp(),
    }));
  });
  test('Q4 validare dichiarando un altro validatore → NEGATO', async () => {
    await assertFails(updateDoc(refD(as(U.op1)), {
      stato: 'VALIDATA', validatedBy: U.op2, validatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
  test('Q4bis rilettura senza il proprio uid in riletturaBy → NEGATO', async () => {
    await assertFails(updateDoc(refD(as(U.op2)), {
      stato: 'IN_RILETTURA',
      rilettura: { ipotesi: {}, osservazioniGenerali: 'x', riletturaBy: [U.op1], riletturaAt: serverTimestamp() },
      updatedAt: serverTimestamp(),
    }));
  });
  test('Q5 modificare una D VALIDATA → NEGATO', async () => {
    await scriviRilettura(as(U.op1), { uid: U.op1, valida: true, valori: { [K.selLet]: { valutazione: 'conferma' } }, osservazioniGenerali: '' });
    await assertFails(updateDoc(refD(as(U.op1)), { stato: 'IN_RILETTURA', validatedAt: null, validatedBy: null }));
  });
});

describe('INT · audit permessi su ppu_schede_d (§19)', () => {
  test('lettura', async () => {
    await assertSucceeds(getDoc(refD(as(U.admin))));
    await assertSucceeds(getDoc(refD(as(U.op1))));
    await assertSucceeds(getDoc(refD(as(U.op2))));
    await assertFails(getDoc(refD(as(U.altra))));
    await assertFails(getDoc(refD(as(U.ragazzo))));
    await assertFails(getDoc(refD(anon())));
  });
  test('creazione: nessun client (nemmeno admin)', async () => {
    await assertFails(setDoc(doc(as(U.admin), 'ppu_schede_d', 'nuova'), docD()));
    await assertFails(setDoc(doc(as(U.op1), 'ppu_schede_d', 'nuova'), docD()));
  });
  test('rilettura: solo staff in scope', async () => {
    await assertSucceeds(scriviRilettura(as(U.op2), { uid: U.op2, valori: { [K.selLet]: { valutazione: 'conferma' } }, osservazioniGenerali: '' }));
    await assertFails(updateDoc(refD(as(U.altra)), { stato: 'IN_RILETTURA', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(refD(as(U.ragazzo)), { stato: 'IN_RILETTURA', updatedAt: serverTimestamp() }));
  });
  test('delete: solo admin e solo se NON validata', async () => {
    await assertFails(deleteDoc(refD(as(U.op1))));
    await assertSucceeds(deleteDoc(refD(as(U.admin))));   // D2 è GENERATA
  });
  test('lock: nessun client', async () => {
    await assertFails(getDoc(doc(as(U.admin), 'ppu_schede_d_locks', 'x')));
    await assertFails(setDoc(doc(as(U.op1), 'ppu_schede_d_locks', 'x'), { a: 1 }));
  });
});
