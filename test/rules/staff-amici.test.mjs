// test/rules/staff-amici.test.mjs
// Estensione fix R1 a staff/{uid} e amici/{uid} (decisione §18.3):
// nessun utente può auto-modificare campi che determinano privilegi,
// ruolo, appartenenza o autorizzazioni.

import { test, before, after, beforeEach, describe } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, updateDoc, serverTimestamp, increment } from 'firebase/firestore';
import { getTestEnv, seedIdentities, UIDS } from './helpers.mjs';

let env;
before(async () => { env = await getTestEnv('staff-amici'); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedIdentities(env); });

describe('staff/{uid} — campi privilegio NON auto-modificabili', () => {
  const selfDb = () => env.authenticatedContext(UIDS.staffPlain).firestore();
  const meRef  = (db) => doc(db, 'staff', UIDS.staffPlain);

  test('staff non-admin NON può impostare admin:true', async () => {
    await assertFails(updateDoc(meRef(selfDb()), { admin: true }));
  });
  test('staff non-admin NON può impostare accessoDocumenti:true', async () => {
    await assertFails(updateDoc(meRef(selfDb()), { accessoDocumenti: true }));
  });
  test('staff non-admin NON può modificare ruolo', async () => {
    await assertFails(updateDoc(meRef(selfDb()), { ruolo: 'Coordinatore Generale' }));
  });
  test('staff non-admin NON può modificare comunitaId', async () => {
    await assertFails(updateDoc(meRef(selfDb()), { comunitaId: ['itaca', 'fortapasc'] }));
  });
  test('staff non-admin NON può modificare permissions / email / nome', async () => {
    await assertFails(updateDoc(meRef(selfDb()), { permissions: { documenti: { access: true } } }));
    await assertFails(updateDoc(meRef(selfDb()), { email: 'x@y.z' }));
    await assertFails(updateDoc(meRef(selfDb()), { nome: 'Nuovo' }));
  });
  test('update misto lecito+privilegio è respinto in blocco', async () => {
    await assertFails(updateDoc(meRef(selfDb()), { fotoProfilo: 'x.jpg', admin: true }));
  });
});

describe('staff/{uid} — self-service ANCORA consentito al proprietario', () => {
  const selfDb = () => env.authenticatedContext(UIDS.staffPlain).firestore();
  const meRef  = (db) => doc(db, 'staff', UIDS.staffPlain);

  test('fotoProfilo / fotoCover / miPresento+updatedAt / audioUrl', async () => {
    const db = selfDb();
    await assertSucceeds(updateDoc(meRef(db), { fotoProfilo: 'p.jpg' }));
    await assertSucceeds(updateDoc(meRef(db), { fotoCover: 'c.jpg' }));
    await assertSucceeds(updateDoc(meRef(db), { miPresento: 'Sono io', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(meRef(db), { audioUrl: 'a.mp3' }));
  });
  test('FCM + numeroAccessi + interazioni sul proprio doc', async () => {
    const db = selfDb();
    await assertSucceeds(updateDoc(meRef(db), { fcmTokens: ['t'], fcmToken: 't' }));
    await assertSucceeds(updateDoc(meRef(db), { numeroAccessi: increment(1) }));
    await assertSucceeds(updateDoc(meRef(db), { 'interazioni.commentiScritti': increment(1) }));
  });
});

describe('staff/{uid} — l\'admin conserva pieni poteri (serve alla Console, Milestone C/D)', () => {
  test('legacy admin può impostare accessoDocumenti / admin / ruolo / comunitaId su un altro staff', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertSucceeds(updateDoc(doc(db, 'staff', UIDS.staffPlain), { accessoDocumenti: true }));
    await assertSucceeds(updateDoc(doc(db, 'staff', UIDS.staffPlain), { admin: true }));
    await assertSucceeds(updateDoc(doc(db, 'staff', UIDS.staffPlain), { ruolo: 'Coordinatore' }));
    await assertSucceeds(updateDoc(doc(db, 'staff', UIDS.staffPlain), { comunitaId: ['itaca'] }));
  });
  test('admin "nuovo modello" (staff.admin===true) può fare lo stesso', async () => {
    const db = env.authenticatedContext(UIDS.staffAdmin).firestore();
    await assertSucceeds(updateDoc(doc(db, 'staff', UIDS.staffPlain), { accessoDocumenti: true }));
  });
  test('un altro staff NON-admin non può toccare il doc di un collega', async () => {
    const db = env.authenticatedContext(UIDS.staffCoord).firestore();
    await assertFails(updateDoc(doc(db, 'staff', UIDS.staffPlain), { fotoProfilo: 'x.jpg' }));
  });
});

describe('amici/{uid} — protezione equivalente', () => {
  const selfDb = () => env.authenticatedContext(UIDS.amico).firestore();
  const meRef  = (db) => doc(db, 'amici', UIDS.amico);

  test('amico NON può auto-attribuirsi admin / accessoDocumenti / ruolo / comunitaId', async () => {
    await assertFails(updateDoc(meRef(selfDb()), { admin: true }));
    await assertFails(updateDoc(meRef(selfDb()), { accessoDocumenti: true }));
    await assertFails(updateDoc(meRef(selfDb()), { ruolo: 'staff' }));
    await assertFails(updateDoc(meRef(selfDb()), { comunitaId: 'itaca' }));
    await assertFails(updateDoc(meRef(selfDb()), { email: 'x@y.z', nome: 'N' }));
  });
  test('amico PUÒ ancora aggiornare foto / miPresento / FCM sul proprio doc', async () => {
    const db = selfDb();
    await assertSucceeds(updateDoc(meRef(db), { fotoProfilo: 'p.jpg' }));
    await assertSucceeds(updateDoc(meRef(db), { miPresento: 'Ciao', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(meRef(db), { fcmTokens: ['t'], fcmToken: 't' }));
  });
  test('legacy admin può modificare qualunque campo di un amico', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertSucceeds(updateDoc(doc(db, 'amici', UIDS.amico), { nome: 'Rinominato', accessoDocumenti: true }));
  });
});
