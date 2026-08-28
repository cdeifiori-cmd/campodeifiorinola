// test/rules/appartenenze.test.mjs
// Storico appartenenze utenti/{uid}/appartenenze/{id} — Milestone D (hardened).
//   read   : solo admin
//   create : solo admin; actorUid==auth.uid; dal==createdAt==request.time;
//            record APERTO {6 chiavi, al==null}  OPPURE  BASELINE legacy
//            {7 chiavi + legacyBaseline==true, al==request.time}
//   update : solo admin, SOLO 'al', record APERTO, al==request.time (ONE-WAY)
//   delete : vietato a chiunque

import { test, before, after, beforeEach, describe } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { getTestEnv, seedIdentities, UIDS } from './helpers.mjs';

let env;
before(async () => { env = await getTestEnv('appartenenze'); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedIdentities(env); });

const col = (db) => `utenti/${UIDS.ragazzo}/appartenenze`;
const newRef = (db) => doc(db, 'utenti', UIDS.ragazzo, 'appartenenze', 'ap_' + Math.random().toString(36).slice(2));

// Record APERTO valido (serverTimestamp risolve a request.time nel commit).
function validOpen(actorUid, overrides = {}) {
  return {
    comunitaId: 'fortapasc',
    dal: serverTimestamp(),
    al: null,
    causale: 'trasferimento struttura',
    actorUid,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}
// BASELINE legacy valido (chiuso alla nascita).
function validBaseline(actorUid, overrides = {}) {
  return {
    comunitaId: 'itaca',
    dal: serverTimestamp(),
    al: serverTimestamp(),
    causale: 'baseline legacy — data ingresso non nota',
    actorUid,
    createdAt: serverTimestamp(),
    legacyBaseline: true,
    ...overrides,
  };
}

// Semina un record (regole off). `al` opzionale (Date) per un record già CHIUSO.
async function seedRecord(id, { comunitaId = 'itaca', al = null } = {}) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { setDoc, doc, Timestamp } = await import('firebase/firestore');
    await setDoc(doc(ctx.firestore(), 'utenti', UIDS.ragazzo, 'appartenenze', id), {
      comunitaId, dal: Timestamp.fromDate(new Date('2026-01-10')), al,
      causale: 'ingresso', actorUid: UIDS.legacyAdmin,
      createdAt: Timestamp.fromDate(new Date('2026-01-10')),
    });
  });
}

describe('appartenenze — CREATE (§17)', () => {
  const adminDb = () => env.authenticatedContext(UIDS.legacyAdmin).firestore();

  test('admin: record APERTO valido -> ALLOW', async () => {
    await assertSucceeds(setDoc(newRef(adminDb()), validOpen(UIDS.legacyAdmin)));
  });
  test('admin: BASELINE legacy valido -> ALLOW', async () => {
    await assertSucceeds(setDoc(newRef(adminDb()), validBaseline(UIDS.legacyAdmin)));
  });
  test('admin "nuovo modello": record APERTO valido -> ALLOW', async () => {
    const db = env.authenticatedContext(UIDS.staffAdmin).firestore();
    await assertSucceeds(setDoc(newRef(db), validOpen(UIDS.staffAdmin)));
  });
  test('owner (ragazzo) create -> DENY', async () => {
    const db = env.authenticatedContext(UIDS.ragazzo).firestore();
    await assertFails(setDoc(newRef(db), validOpen(UIDS.ragazzo)));
  });
  test('staff non-admin create -> DENY', async () => {
    const db = env.authenticatedContext(UIDS.staffCoord).firestore();
    await assertFails(setDoc(newRef(db), validOpen(UIDS.staffCoord)));
  });
  test('actorUid falsificato (≠ auth.uid) -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), validOpen(UIDS.staffCoord)));
  });
  test('dal arbitrario (non serverTimestamp) -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), validOpen(UIDS.legacyAdmin, { dal: '2020-01-01T00:00:00.000Z' })));
  });
  test('createdAt arbitrario -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), validOpen(UIDS.legacyAdmin, { createdAt: '2020-01-01T00:00:00.000Z' })));
  });
  test('al non null al create (senza legacyBaseline) -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), validOpen(UIDS.legacyAdmin, { al: serverTimestamp() })));
  });
  test('comunitaId vuoto -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), validOpen(UIDS.legacyAdmin, { comunitaId: '' })));
  });
  test('causale non stringa -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), validOpen(UIDS.legacyAdmin, { causale: 123 })));
  });
  test('causale vuota -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), validOpen(UIDS.legacyAdmin, { causale: '' })));
  });
  test('causale > 500 caratteri -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), validOpen(UIDS.legacyAdmin, { causale: 'x'.repeat(501) })));
  });
  test('legacyBaseline:true ma al == null -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), validBaseline(UIDS.legacyAdmin, { al: null })));
  });
  test('chiave extra non prevista -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), { ...validOpen(UIDS.legacyAdmin), note: 'x' }));
  });
});

describe('appartenenze — READ: solo admin', () => {
  beforeEach(async () => { await seedRecord('r1'); });
  const ref = (uid) => doc(env.authenticatedContext(uid).firestore(), 'utenti', UIDS.ragazzo, 'appartenenze', 'r1');
  test('ragazzo proprietario -> DENY', async () => { await assertFails(getDoc(ref(UIDS.ragazzo))); });
  test('staff non-admin -> DENY', async () => { await assertFails(getDoc(ref(UIDS.staffCoord))); });
  test('legacy admin -> ALLOW', async () => { await assertSucceeds(getDoc(ref(UIDS.legacyAdmin))); });
  test('admin nuovo modello -> ALLOW', async () => { await assertSucceeds(getDoc(ref(UIDS.staffAdmin))); });
});

describe('appartenenze — CLOSE one-way (§17)', () => {
  const ref = (uid, id) => doc(env.authenticatedContext(uid).firestore(), 'utenti', UIDS.ragazzo, 'appartenenze', id);

  test('admin chiude record APERTO con al=request.time -> ALLOW', async () => {
    await seedRecord('open1', { al: null });
    await assertSucceeds(updateDoc(ref(UIDS.legacyAdmin, 'open1'), { al: serverTimestamp() }));
  });
  test('modifica di un altro campo insieme ad al -> DENY', async () => {
    // seedRecord usa comunitaId:'itaca' -> qui si cambia a un valore DIVERSO,
    // altrimenti Firestore ottimizza via il campo no-op e affectedKeys()=['al'].
    await seedRecord('open2', { comunitaId: 'itaca', al: null });
    await assertFails(updateDoc(ref(UIDS.legacyAdmin, 'open2'), { al: serverTimestamp(), comunitaId: 'fortapasc' }));
  });
  test('record GIÀ CHIUSO: secondo update di al -> DENY', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { setDoc, doc, Timestamp } = await import('firebase/firestore');
      await setDoc(doc(ctx.firestore(), 'utenti', UIDS.ragazzo, 'appartenenze', 'closed1'), {
        comunitaId: 'itaca', dal: Timestamp.fromDate(new Date('2026-01-10')),
        al: Timestamp.fromDate(new Date('2026-06-01')), causale: 'ingresso',
        actorUid: UIDS.legacyAdmin, createdAt: Timestamp.fromDate(new Date('2026-01-10')),
      });
    });
    await assertFails(updateDoc(ref(UIDS.legacyAdmin, 'closed1'), { al: serverTimestamp() }));
  });
  test('riapertura al=null -> DENY', async () => {
    await seedRecord('open3', { al: null });
    await assertFails(updateDoc(ref(UIDS.legacyAdmin, 'open3'), { al: null }));
  });
  test('timestamp arbitrario (non request.time) -> DENY', async () => {
    await seedRecord('open4', { al: null });
    await assertFails(updateDoc(ref(UIDS.legacyAdmin, 'open4'), { al: '2030-01-01T00:00:00.000Z' }));
  });
  test('owner (ragazzo) chiude -> DENY', async () => {
    await seedRecord('open5', { al: null });
    await assertFails(updateDoc(ref(UIDS.ragazzo, 'open5'), { al: serverTimestamp() }));
  });
  test('staff non-admin chiude -> DENY', async () => {
    await seedRecord('open6', { al: null });
    await assertFails(updateDoc(ref(UIDS.staffCoord, 'open6'), { al: serverTimestamp() }));
  });
});

describe('appartenenze — DELETE: vietato a chiunque', () => {
  beforeEach(async () => { await seedRecord('d1'); });
  const ref = (uid) => doc(env.authenticatedContext(uid).firestore(), 'utenti', UIDS.ragazzo, 'appartenenze', 'd1');
  test('nemmeno il legacy admin', async () => { await assertFails(deleteDoc(ref(UIDS.legacyAdmin))); });
  test('nemmeno l\'admin nuovo modello', async () => { await assertFails(deleteDoc(ref(UIDS.staffAdmin))); });
  test('il ragazzo proprietario', async () => { await assertFails(deleteDoc(ref(UIDS.ragazzo))); });
});
