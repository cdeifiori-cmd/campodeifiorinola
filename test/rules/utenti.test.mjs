// test/rules/utenti.test.mjs
// Fix R1 / D1 (decisione §18.3): un documento utenti/{uid} NON può
// auto-modificare campi di sistema; restano permessi solo i campi
// self-service realmente usati dal codice client.

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, increment,
} from 'firebase/firestore';
import { getTestEnv, seedIdentities, UIDS } from './helpers.mjs';

let env;
before(async () => { env = await getTestEnv('utenti'); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedIdentities(env); });

const ragazzoDb = () => env.authenticatedContext(UIDS.ragazzo).firestore();
const altroDb   = () => env.authenticatedContext(UIDS.ragazzo2).firestore();
const meRef     = (db) => doc(db, 'utenti', UIDS.ragazzo);

describe('utenti/{uid} — campi di sistema NON auto-modificabili dal ragazzo', () => {
  test('§12.1 — ragazzo NON può impostarsi accessoDocumenti:true', async () => {
    await assertFails(updateDoc(meRef(ragazzoDb()), { accessoDocumenti: true }));
  });

  test('§12.2 — ragazzo NON può cambiare comunitaId', async () => {
    await assertFails(updateDoc(meRef(ragazzoDb()), { comunitaId: 'itaca' }));
  });

  test('§12.3 — ragazzo NON può cambiare stato (self-riattivazione/archiviazione)', async () => {
    await assertFails(updateDoc(meRef(ragazzoDb()), { stato: 'archiviato' }));
  });

  test('§12.4 — ragazzo NON può attribuirsi admin:true', async () => {
    await assertFails(updateDoc(meRef(ragazzoDb()), { admin: true }));
  });

  test('§12.5 — ragazzo NON può cambiare ruolo', async () => {
    await assertFails(updateDoc(meRef(ragazzoDb()), { ruolo: 'admin' }));
  });

  test('extra — ragazzo NON può modificare permissions / email / nome', async () => {
    await assertFails(updateDoc(meRef(ragazzoDb()), { permissions: { documenti: { access: true } } }));
    await assertFails(updateDoc(meRef(ragazzoDb()), { email: 'nuova@example.org' }));
    await assertFails(updateDoc(meRef(ragazzoDb()), { nome: 'Altro Nome' }));
  });

  test('extra — update misto (campo lecito + campo di sistema) è RESPINTO in blocco', async () => {
    await assertFails(updateDoc(meRef(ragazzoDb()), { fotoProfilo: 'x.jpg', admin: true }));
  });

  test('extra — ragazzo NON può cancellare il proprio documento', async () => {
    await assertFails(deleteDoc(meRef(ragazzoDb())));
  });
});

describe('utenti/{uid} — campi self-service ANCORA consentiti al proprietario', () => {
  test('§12.6a — fotoProfilo / fotoCover / miPresento+updatedAt / audioUrl', async () => {
    const db = ragazzoDb();
    await assertSucceeds(updateDoc(meRef(db), { fotoProfilo: 'https://cloudinary/x.jpg' }));
    await assertSucceeds(updateDoc(meRef(db), { fotoCover: 'https://cloudinary/c.jpg' }));
    await assertSucceeds(updateDoc(meRef(db), { miPresento: 'Ciao', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(meRef(db), { audioUrl: 'https://cloudinary/a.mp3' }));
  });

  test('§12.6b — FCM (fcmTokens + fcmToken), numeroAccessi, primoAccesso', async () => {
    const db = ragazzoDb();
    await assertSucceeds(updateDoc(meRef(db), { fcmTokens: ['t1'], fcmToken: 't1' }));
    await assertSucceeds(updateDoc(meRef(db), { numeroAccessi: increment(1) }));
    await assertSucceeds(updateDoc(meRef(db), { primoAccesso: serverTimestamp() }));
  });

  test('§12.6c — interazioni sul PROPRIO doc (contatore cosmetico) è consentito', async () => {
    await assertSucceeds(updateDoc(meRef(ragazzoDb()), { 'interazioni.commentiScritti': increment(1) }));
  });
});

describe('utenti/{uid} — scritture cross-utente', () => {
  test('§12.7 — reazioniPresento sul doc di un ALTRO utente: consentito (invariato)', async () => {
    await assertSucceeds(
      updateDoc(doc(altroDb(), 'utenti', UIDS.ragazzo), { 'reazioniPresento.cuore': increment(1) })
    );
  });

  test('interazioni cross-utente: VIETATO (comportamento invariato, restava già negato)', async () => {
    await assertFails(
      updateDoc(doc(altroDb(), 'utenti', UIDS.ragazzo), { 'interazioni.commentiRicevuti': increment(1) })
    );
  });

  test('un altro utente NON può toccare fotoProfilo/campi altrui', async () => {
    await assertFails(
      updateDoc(doc(altroDb(), 'utenti', UIDS.ragazzo), { fotoProfilo: 'hack.jpg' })
    );
  });

  test('sub-collection reazioniPresento/{reazId}: solo la propria', async () => {
    const db = altroDb();
    await assertSucceeds(setDoc(doc(db, 'utenti', UIDS.ragazzo, 'reazioniPresento', UIDS.ragazzo2), { tipo: 'cuore' }));
    await assertFails(setDoc(doc(db, 'utenti', UIDS.ragazzo, 'reazioniPresento', 'qualcun_altro'), { tipo: 'cuore' }));
  });
});

describe('utenti/{uid} — l\'admin può ancora tutto', () => {
  test('legacy admin può cambiare comunitaId e accessoDocumenti', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertSucceeds(updateDoc(doc(db, 'utenti', UIDS.ragazzo), { comunitaId: 'itaca' }));
    await assertSucceeds(updateDoc(doc(db, 'utenti', UIDS.ragazzo), { accessoDocumenti: true }));
  });

  test('§12.11 — admin "nuovo modello" (staff.admin===true) può cambiare comunitaId', async () => {
    const db = env.authenticatedContext(UIDS.staffAdmin).firestore();
    await assertSucceeds(updateDoc(doc(db, 'utenti', UIDS.ragazzo), { comunitaId: 'itaca' }));
  });

  test('staff NON-admin non può cambiare comunitaId di un ragazzo', async () => {
    const db = env.authenticatedContext(UIDS.staffCoord).firestore();
    await assertFails(updateDoc(doc(db, 'utenti', UIDS.ragazzo), { comunitaId: 'itaca' }));
  });
});
