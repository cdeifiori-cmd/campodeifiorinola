// test/rules/admin-audit.test.mjs
// admin_audit (Milestone C §8): append-only + vincoli di integrità sul create.
//   create : solo admin, con actorUid == request.auth.uid, ts == request.time,
//            campi minimi presenti e tipati, before/after mappe
//   read   : solo admin
//   update : vietato a chiunque (admin incluso)
//   delete : vietato a chiunque (admin incluso)

import { test, before, after, beforeEach, describe } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { getTestEnv, seedIdentities, UIDS } from './helpers.mjs';

let env;
before(async () => { env = await getTestEnv('admin-audit'); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedIdentities(env); });

// Record valido "template". `actorUid` e `ts` vengono impostati dal singolo test.
function validRec(actorUid, overrides = {}) {
  return {
    ts: serverTimestamp(),
    actorUid,
    action: 'DOCUMENTI_ACCESS_GRANTED',
    targetType: 'staff',
    targetId: UIDS.staffCoord,
    before: { accessoDocumenti: null },
    after: { accessoDocumenti: true },
    ...overrides,
  };
}

const newRef = (db, id) => doc(db, 'admin_audit', id || ('evt_' + Math.random().toString(36).slice(2)));

describe('admin_audit — create: solo admin', () => {
  test('un ragazzo NON può creare', async () => {
    const db = env.authenticatedContext(UIDS.ragazzo).firestore();
    await assertFails(setDoc(newRef(db), validRec(UIDS.ragazzo)));
  });
  test('staff non-admin NON può creare', async () => {
    const db = env.authenticatedContext(UIDS.staffCoord).firestore();
    await assertFails(setDoc(newRef(db), validRec(UIDS.staffCoord)));
  });
  test('legacy admin PUÒ creare (record valido)', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertSucceeds(setDoc(newRef(db), validRec(UIDS.legacyAdmin)));
  });
  test('admin "nuovo modello" (staff.admin===true) PUÒ creare (record valido)', async () => {
    const db = env.authenticatedContext(UIDS.staffAdmin).firestore();
    await assertSucceeds(setDoc(newRef(db), validRec(UIDS.staffAdmin)));
  });
});

describe('admin_audit — create: vincoli di integrità (§8)', () => {
  const adminDb = () => env.authenticatedContext(UIDS.legacyAdmin).firestore();

  test('actorUid diverso da request.auth.uid -> DENY (no spoofing)', async () => {
    await assertFails(setDoc(newRef(adminDb()), validRec(UIDS.staffCoord))); // actorUid ≠ admin
  });
  test('ts NON serverTimestamp (stringa fissa) -> DENY (ts deve essere request.time)', async () => {
    await assertFails(setDoc(newRef(adminDb()),
      validRec(UIDS.legacyAdmin, { ts: '2020-01-01T00:00:00.000Z' })));
  });
  test('manca un campo obbligatorio (before) -> DENY', async () => {
    const r = validRec(UIDS.legacyAdmin);
    delete r.before;
    await assertFails(setDoc(newRef(adminDb()), r));
  });
  test('manca targetId -> DENY', async () => {
    const r = validRec(UIDS.legacyAdmin);
    delete r.targetId;
    await assertFails(setDoc(newRef(adminDb()), r));
  });
  test('action troppo corta -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), validRec(UIDS.legacyAdmin, { action: 'X' })));
  });
  test('before non è una mappa -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), validRec(UIDS.legacyAdmin, { before: 'x' })));
  });
  test('targetId vuoto -> DENY', async () => {
    await assertFails(setDoc(newRef(adminDb()), validRec(UIDS.legacyAdmin, { targetId: '' })));
  });
});

describe('admin_audit — read: solo admin', () => {
  const SEED_ID = 'evt_seed';
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { setDoc, doc } = await import('firebase/firestore');
      await setDoc(doc(ctx.firestore(), 'admin_audit', SEED_ID), {
        ts: '2026-08-28T10:00:00.000Z', actorUid: UIDS.legacyAdmin,
        action: 'DOCUMENTI_ACCESS_DENIED', targetType: 'staff', targetId: UIDS.staffCoord,
        before: { accessoDocumenti: null }, after: { accessoDocumenti: false },
      });
    });
  });
  const ref = (uid) => doc(env.authenticatedContext(uid).firestore(), 'admin_audit', SEED_ID);

  test('un ragazzo NON può leggere', async () => { await assertFails(getDoc(ref(UIDS.ragazzo))); });
  test('staff non-admin NON può leggere', async () => { await assertFails(getDoc(ref(UIDS.staffCoord))); });
  test('legacy admin può leggere', async () => { await assertSucceeds(getDoc(ref(UIDS.legacyAdmin))); });
  test('admin nuovo modello può leggere', async () => { await assertSucceeds(getDoc(ref(UIDS.staffAdmin))); });
});

describe('admin_audit — NON modificabile / NON cancellabile, nemmeno dall\'admin', () => {
  const SEED_ID = 'evt_seed2';
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const { setDoc, doc } = await import('firebase/firestore');
      await setDoc(doc(ctx.firestore(), 'admin_audit', SEED_ID), {
        ts: '2026-08-28T10:00:00.000Z', actorUid: UIDS.legacyAdmin,
        action: 'DOCUMENTI_ACCESS_GRANTED', targetType: 'staff', targetId: UIDS.staffCoord,
        before: { accessoDocumenti: null }, after: { accessoDocumenti: true },
      });
    });
  });
  const ref = (uid) => doc(env.authenticatedContext(uid).firestore(), 'admin_audit', SEED_ID);

  test('legacy admin NON può update', async () => {
    await assertFails(updateDoc(ref(UIDS.legacyAdmin), { action: 'tampered' }));
  });
  test('legacy admin NON può delete', async () => {
    await assertFails(deleteDoc(ref(UIDS.legacyAdmin)));
  });
  test('admin nuovo modello NON può update/delete', async () => {
    await assertFails(updateDoc(ref(UIDS.staffAdmin), { action: 'tampered' }));
    await assertFails(deleteDoc(ref(UIDS.staffAdmin)));
  });
});
