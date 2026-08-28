// test/rules/admin-audit.test.mjs
// admin_audit (decisione §18.7): append-only assoluto.
//   create : solo admin
//   read   : solo admin
//   update : vietato a chiunque (admin incluso)
//   delete : vietato a chiunque (admin incluso)

import { test, before, after, beforeEach, describe } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getTestEnv, seedIdentities, UIDS } from './helpers.mjs';

let env;
before(async () => { env = await getTestEnv('admin-audit'); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedIdentities(env); });

const AUDIT_ID = 'evt_0001';
const rec = {
  ts: '2026-08-28T10:00:00.000Z',
  actorUid: UIDS.legacyAdmin,
  action: 'transfer',
  targetType: 'utenti',
  targetId: UIDS.ragazzo,
  before: { comunitaId: 'fortapasc' },
  after: { comunitaId: 'itaca' },
  details: {},
};
const ref = (db) => doc(db, 'admin_audit', AUDIT_ID);

async function seedAudit(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { setDoc, doc } = await import('firebase/firestore');
    await setDoc(doc(ctx.firestore(), 'admin_audit', AUDIT_ID), rec);
  });
}

describe('admin_audit — create', () => {
  test('§12.admin_audit — un ragazzo NON può creare un record di audit', async () => {
    const db = env.authenticatedContext(UIDS.ragazzo).firestore();
    await assertFails(setDoc(ref(db), rec));
  });
  test('staff non-admin NON può creare un record di audit', async () => {
    const db = env.authenticatedContext(UIDS.staffCoord).firestore();
    await assertFails(setDoc(ref(db), rec));
  });
  test('legacy admin PUÒ creare un record di audit', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertSucceeds(setDoc(ref(db), rec));
  });
  test('admin "nuovo modello" (staff.admin===true) PUÒ creare', async () => {
    const db = env.authenticatedContext(UIDS.staffAdmin).firestore();
    await assertSucceeds(setDoc(ref(db), rec));
  });
});

describe('admin_audit — read: solo admin', () => {
  beforeEach(async () => { await seedAudit(env); });
  test('un ragazzo NON può leggere l\'audit log', async () => {
    await assertFails(getDoc(ref(env.authenticatedContext(UIDS.ragazzo).firestore())));
  });
  test('staff non-admin NON può leggere l\'audit log', async () => {
    await assertFails(getDoc(ref(env.authenticatedContext(UIDS.staffCoord).firestore())));
  });
  test('legacy admin può leggere', async () => {
    await assertSucceeds(getDoc(ref(env.authenticatedContext(UIDS.legacyAdmin).firestore())));
  });
});

describe('admin_audit — NON modificabile / NON cancellabile, nemmeno dall\'admin', () => {
  beforeEach(async () => { await seedAudit(env); });
  test('legacy admin NON può fare update di un record di audit', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertFails(updateDoc(ref(db), { action: 'tampered' }));
  });
  test('legacy admin NON può fare delete di un record di audit', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertFails(deleteDoc(ref(db)));
  });
  test('admin "nuovo modello" NON può update/delete', async () => {
    const db = env.authenticatedContext(UIDS.staffAdmin).firestore();
    await assertFails(updateDoc(ref(db), { action: 'tampered' }));
    await assertFails(deleteDoc(ref(db)));
  });
});
