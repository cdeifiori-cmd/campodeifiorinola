// test/rules/appartenenze.test.mjs
// Storico appartenenze utenti/{uid}/appartenenze/{id} (decisione §18.6):
//   read   : solo admin (placeholder Milestone A)
//   create : solo admin
//   update : solo admin, SOLO il campo 'al'
//   delete : vietato a chiunque

import { test, before, after, beforeEach, describe } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { getTestEnv, seedIdentities, UIDS } from './helpers.mjs';

let env;
before(async () => { env = await getTestEnv('appartenenze'); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedIdentities(env); });

const APP_ID = 'app_fortapasc_2026';
const baseApp = {
  comunitaId: 'fortapasc',
  dal: '2026-01-10T00:00:00.000Z',
  al: null,
  causale: 'ingresso',
  actorUid: UIDS.legacyAdmin,
  createdAt: '2026-01-10T00:00:00.000Z',
};

async function seedAppartenenza(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { setDoc, doc } = await import('firebase/firestore');
    await setDoc(doc(ctx.firestore(), 'utenti', UIDS.ragazzo, 'appartenenze', APP_ID), baseApp);
  });
}

const ref = (db) => doc(db, 'utenti', UIDS.ragazzo, 'appartenenze', APP_ID);

describe('appartenenze — create', () => {
  test('§12.appartenenze — il ragazzo proprietario NON può creare una appartenenza', async () => {
    const db = env.authenticatedContext(UIDS.ragazzo).firestore();
    await assertFails(setDoc(ref(db), baseApp));
  });
  test('staff non-admin NON può creare una appartenenza', async () => {
    const db = env.authenticatedContext(UIDS.staffCoord).firestore();
    await assertFails(setDoc(ref(db), baseApp));
  });
  test('legacy admin PUÒ creare una appartenenza', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertSucceeds(setDoc(ref(db), baseApp));
  });
  test('admin "nuovo modello" PUÒ creare una appartenenza', async () => {
    const db = env.authenticatedContext(UIDS.staffAdmin).firestore();
    await assertSucceeds(setDoc(ref(db), baseApp));
  });
});

describe('appartenenze — read (placeholder Milestone A = solo admin)', () => {
  test('il ragazzo proprietario NON può leggere il proprio storico', async () => {
    await seedAppartenenza(env);
    const db = env.authenticatedContext(UIDS.ragazzo).firestore();
    await assertFails(getDoc(ref(db)));
  });
  test('legacy admin può leggere', async () => {
    await seedAppartenenza(env);
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertSucceeds(getDoc(ref(db)));
  });
});

describe('appartenenze — update: solo admin, solo il campo "al"', () => {
  beforeEach(async () => { await seedAppartenenza(env); });

  test('admin PUÒ chiudere l\'appartenenza valorizzando SOLO "al"', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertSucceeds(updateDoc(ref(db), { al: '2026-08-28T00:00:00.000Z' }));
  });
  test('admin NON può riscrivere comunitaId / dal / actorUid / createdAt / causale', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertFails(updateDoc(ref(db), { comunitaId: 'itaca' }));
    await assertFails(updateDoc(ref(db), { dal: '2020-01-01T00:00:00.000Z' }));
    await assertFails(updateDoc(ref(db), { actorUid: UIDS.ragazzo }));
    await assertFails(updateDoc(ref(db), { createdAt: '2020-01-01T00:00:00.000Z' }));
    await assertFails(updateDoc(ref(db), { causale: 'altro' }));
  });
  test('admin NON può cambiare "al" insieme a un altro campo', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertFails(updateDoc(ref(db), { al: '2026-08-28T00:00:00.000Z', comunitaId: 'itaca' }));
  });
  test('il ragazzo proprietario NON può modificare "al"', async () => {
    const db = env.authenticatedContext(UIDS.ragazzo).firestore();
    await assertFails(updateDoc(ref(db), { al: '2026-08-28T00:00:00.000Z' }));
  });
  test('staff non-admin NON può modificare "al"', async () => {
    const db = env.authenticatedContext(UIDS.staffCoord).firestore();
    await assertFails(updateDoc(ref(db), { al: '2026-08-28T00:00:00.000Z' }));
  });
});

describe('appartenenze — delete: vietato a chiunque', () => {
  beforeEach(async () => { await seedAppartenenza(env); });
  test('nemmeno il legacy admin può cancellare una appartenenza', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertFails(deleteDoc(ref(db)));
  });
  test('il ragazzo proprietario non può cancellare', async () => {
    const db = env.authenticatedContext(UIDS.ragazzo).firestore();
    await assertFails(deleteDoc(ref(db)));
  });
});
