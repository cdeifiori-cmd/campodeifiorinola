// test/rules/pin-reservations.test.mjs
// pin_reservations/{pin} (Milestone E): allow read, write: if false.
// Nessun client — admin incluso — può leggere/enumerare/creare/aggiornare/
// cancellare una riserva PIN. Solo l'Admin SDK della callable la usa (bypassa
// le Rules).

import { test, before, after, beforeEach, describe } from 'node:test';
import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { getTestEnv, seedIdentities, UIDS } from './helpers.mjs';

let env;
before(async () => { env = await getTestEnv('pin-reservations'); });
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await seedIdentities(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { setDoc, doc } = await import('firebase/firestore');
    await setDoc(doc(ctx.firestore(), 'pin_reservations', '4455'), { uid: 'x', createdAt: 'x' });
  });
});

const ref = (uid) => doc(env.authenticatedContext(uid).firestore(), 'pin_reservations', '4455');

describe('pin_reservations — client (anche admin) non ha alcun accesso', () => {
  for (const who of ['legacyAdmin', 'staffAdmin', 'staffCoord', 'ragazzo']) {
    test(`${who}: read -> DENY`, async () => { await assertFails(getDoc(ref(UIDS[who]))); });
    test(`${who}: list -> DENY`, async () => {
      await assertFails(getDocs(collection(env.authenticatedContext(UIDS[who]).firestore(), 'pin_reservations')));
    });
    test(`${who}: create -> DENY`, async () => {
      await assertFails(setDoc(doc(env.authenticatedContext(UIDS[who]).firestore(), 'pin_reservations', '9999'),
        { uid: UIDS[who], createdAt: 'x' }));
    });
    test(`${who}: update -> DENY`, async () => { await assertFails(updateDoc(ref(UIDS[who]), { uid: 'y' })); });
    test(`${who}: delete -> DENY`, async () => { await assertFails(deleteDoc(ref(UIDS[who]))); });
  }

  test('utente non autenticato: read -> DENY', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'pin_reservations', '4455')));
  });
});
