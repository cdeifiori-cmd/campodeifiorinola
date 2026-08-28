// test/functions/assegna-pin.test.mjs
// Integrazione callable `assegnaPinRagazzoAdmin` contro l'emulatore
// (Functions + Auth + Firestore). Primo PIN per un ragazzo GIÀ esistente.

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAdmin, getClient, teardownClient, wipeEmulator, seedComunita, seedStaff,
  signInAs, signOutClient, call, LEGACY_ADMIN_UID,
} from './fn-helpers.mjs';

let adminSdk;
before(() => { adminSdk = getAdmin(); });
after(async () => { await teardownClient(); });
beforeEach(async () => {
  await signOutClient();
  await wipeEmulator();
  await seedComunita(['itaca', 'after-us']);
});

async function fails(promise, expectedCode) {
  try { await promise; assert.fail('atteso errore, nessuno lanciato'); }
  catch (e) {
    if (expectedCode) assert.equal(e.code, expectedCode, `code atteso ${expectedCode}, ricevuto ${e.code} (${e.message})`);
    return e;
  }
}

// Semina un ragazzo GIÀ esistente in utenti/{uid}. Di default: attivo, itaca,
// SENZA PIN e SENZA account Auth.
async function seedRagazzo(uid, over = {}) {
  await adminSdk.db.collection('utenti').doc(uid).set({
    nome: 'Esistente Kid', comunitaId: 'itaca', stato: 'attivo', admin: false, ...over,
  });
}

describe('assegnaPinRagazzoAdmin — autorizzazione', () => {
  test('non autenticato -> unauthenticated', async () => {
    await seedRagazzo('u1');
    const c = getClient();
    await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: 'u1', pin: '445566' }), 'functions/unauthenticated');
  });
  test('ragazzo (nessun doc staff) -> permission-denied', async () => {
    await seedRagazzo('u1');
    const c = await signInAs('kid_x');
    await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: 'u1', pin: '445566' }), 'functions/permission-denied');
  });
  test('staff non-admin -> permission-denied', async () => {
    await seedRagazzo('u1');
    await seedStaff('staff_np', { admin: false, ruolo: 'educatore' });
    const c = await signInAs('staff_np');
    await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: 'u1', pin: '445566' }), 'functions/permission-denied');
  });
  test('legacy admin -> SUCCESS', async () => {
    await seedRagazzo('u1');
    const c = await signInAs(LEGACY_ADMIN_UID);
    const res = await call(c, 'assegnaPinRagazzoAdmin', { uid: 'u1', pin: '445566' });
    assert.equal(res.data.uid, 'u1');
  });
  test('staff.admin === true -> SUCCESS', async () => {
    await seedRagazzo('u1');
    await seedStaff('staff_adm', { admin: true });
    const c = await signInAs('staff_adm');
    const res = await call(c, 'assegnaPinRagazzoAdmin', { uid: 'u1', pin: '778899' });
    assert.equal(res.data.uid, 'u1');
  });
});

describe('assegnaPinRagazzoAdmin — validazione', () => {
  let c;
  beforeEach(async () => { c = await signInAs(LEGACY_ADMIN_UID); });

  test('uid vuoto -> invalid-argument', async () => {
    await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: '  ', pin: '445566' }), 'functions/invalid-argument');
  });
  test('PIN formato invalido -> invalid-argument', async () => {
    await seedRagazzo('u1');
    for (const bad of ['12', '123', 'abcd', '12a4', '1234567', '']) {
      await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: 'u1', pin: bad }), 'functions/invalid-argument');
    }
  });
  test('PIN validi 4-6 cifre (0000 incluso) -> SUCCESS', async () => {
    for (const good of ['0000', '1234', '12345', '123456']) {
      const uid = 'u_' + good;
      await seedRagazzo(uid);
      const res = await call(c, 'assegnaPinRagazzoAdmin', { uid, pin: good });
      assert.equal(res.data.uid, uid);
    }
  });
  test('utenti/{uid} inesistente -> failed-precondition', async () => {
    await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: 'non_esiste', pin: '445566' }), 'functions/failed-precondition');
  });
  test('ragazzo archiviato -> failed-precondition', async () => {
    await seedRagazzo('u_arch', { stato: 'archiviato' });
    await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: 'u_arch', pin: '445566' }), 'functions/failed-precondition');
  });
  test('ragazzo ha GIÀ un PIN -> failed-precondition', async () => {
    await seedRagazzo('u_haspin');
    await adminSdk.db.collection('utenti_pin').doc('u_haspin').set({ uid: 'u_haspin', pin: '111111' });
    await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: 'u_haspin', pin: '445566' }), 'functions/failed-precondition');
  });
});

describe('assegnaPinRagazzoAdmin — unicità PIN', () => {
  let c;
  beforeEach(async () => { c = await signInAs(LEGACY_ADMIN_UID); await seedRagazzo('u1'); });

  test('PIN già in pin_reservations -> already-exists', async () => {
    await adminSdk.db.collection('pin_reservations').doc('333444').set({ uid: 'r_altro', status: 'ACTIVE', createdAt: new Date() });
    await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: 'u1', pin: '333444' }), 'functions/already-exists');
  });
  test('PIN già in utenti_pin (query pin==) -> already-exists', async () => {
    await adminSdk.db.collection('utenti_pin').doc('u_legacy').set({ uid: 'u_legacy', pin: '111222' });
    await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: 'u1', pin: '111222' }), 'functions/already-exists');
  });
  test('PIN già in utenti_pin_lookup -> already-exists', async () => {
    await adminSdk.db.collection('utenti_pin_lookup').doc('222333').set({ uid: 'u_legacy2' });
    await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: 'u1', pin: '222333' }), 'functions/already-exists');
  });
});

describe('assegnaPinRagazzoAdmin — SUCCESS STATE', () => {
  test('utenti_pin creato senza segreti; reservation ACTIVE; NIENTE lookup; utenti/appartenenze intatti; audit PIN_ASSIGNED', async () => {
    const c = await signInAs(LEGACY_ADMIN_UID);
    const pin = '456789';
    await seedRagazzo('bilal', { nome: 'Bilal', comunitaId: 'itaca' });
    // appartenenza pre-esistente: deve restare identica (la callable NON tocca lo storico)
    await adminSdk.db.collection('utenti').doc('bilal').collection('appartenenze').doc('ap1')
      .set({ comunitaId: 'itaca', dal: new Date(), al: null, causale: 'x', actorUid: LEGACY_ADMIN_UID, createdAt: new Date() });

    const res = await call(c, 'assegnaPinRagazzoAdmin', { uid: 'bilal', pin });

    // risposta: nessun segreto
    assert.deepEqual(Object.keys(res.data).sort(), ['authCreated', 'comunitaId', 'uid']);
    assert.ok(!('password' in res.data) && !('pin' in res.data));

    // utenti_pin/{uid}
    const up = (await adminSdk.db.collection('utenti_pin').doc('bilal').get()).data();
    assert.equal(up.pin, pin);
    assert.equal(up.comunitaId, 'itaca');
    assert.equal(up.lastLogin, null);
    assert.ok(!('password' in up));

    // pin_reservations/{pin} -> ACTIVE
    const pr = (await adminSdk.db.collection('pin_reservations').doc(pin).get()).data();
    assert.equal(pr.uid, 'bilal');
    assert.equal(pr.status, 'ACTIVE');
    assert.ok(pr.activatedAt);

    // NIENTE utenti_pin_lookup
    assert.equal((await adminSdk.db.collection('utenti_pin_lookup').doc(pin).get()).exists, false);

    // utenti/{uid} invariato (nessun pin/password aggiunto, comunitaId/stato uguali)
    const u = (await adminSdk.db.collection('utenti').doc('bilal').get()).data();
    assert.equal(u.comunitaId, 'itaca');
    assert.equal(u.stato, 'attivo');
    assert.ok(!('pin' in u) && !('password' in u));

    // appartenenze intatte: esattamente 1, quella pre-esistente, invariata
    const aps = await adminSdk.db.collection('utenti').doc('bilal').collection('appartenenze').get();
    assert.equal(aps.size, 1);
    assert.equal(aps.docs[0].id, 'ap1');
    assert.equal(aps.docs[0].data().al, null);

    // audit PIN_ASSIGNED — nessun pin/password
    const au = await adminSdk.db.collection('admin_audit').where('action', '==', 'PIN_ASSIGNED').get();
    assert.equal(au.size, 1);
    const a = au.docs[0].data();
    assert.equal(a.targetType, 'utente');
    assert.equal(a.targetId, 'bilal');
    assert.deepEqual(a.before, {});
    assert.equal(a.after.comunitaId, 'itaca');
    assert.ok(!JSON.stringify(a).includes(pin), 'audit non deve contenere il PIN');
    assert.ok(!('password' in a));
  });
});

describe('assegnaPinRagazzoAdmin — account Auth', () => {
  let c;
  beforeEach(async () => { c = await signInAs(LEGACY_ADMIN_UID); });

  test('Auth creato se mancante (email sintetica dall\'uid, authCreated=true)', async () => {
    await seedRagazzo('newauth', { nome: 'Nuovo Auth' });
    await fails(adminSdk.auth.getUser('newauth')); // non esiste prima
    const res = await call(c, 'assegnaPinRagazzoAdmin', { uid: 'newauth', pin: '445566' });
    assert.equal(res.data.authCreated, true);
    const authUser = await adminSdk.auth.getUser('newauth');
    assert.equal(authUser.email, 'newauth.ragazzo@campodeifiori.org');
  });

  test('Auth PRE-ESISTENTE preservato (email/displayName invariati, authCreated=false)', async () => {
    await adminSdk.auth.createUser({ uid: 'oldauth', email: 'preesistente@example.org', displayName: 'Vecchio Nome' });
    await seedRagazzo('oldauth', { nome: 'Ignorato Nel Doc' });
    const res = await call(c, 'assegnaPinRagazzoAdmin', { uid: 'oldauth', pin: '556677' });
    assert.equal(res.data.authCreated, false);
    const authUser = await adminSdk.auth.getUser('oldauth');
    assert.equal(authUser.email, 'preesistente@example.org', 'email NON deve cambiare');
    assert.equal(authUser.displayName, 'Vecchio Nome', 'displayName NON deve cambiare');
  });
});

describe('assegnaPinRagazzoAdmin — concorrenza PIN', () => {
  test('due assegnazioni simultanee stesso PIN su ragazzi diversi: una sola riesce', async () => {
    const c = await signInAs(LEGACY_ADMIN_UID);
    await seedRagazzo('ka'); await seedRagazzo('kb');
    const results = await Promise.allSettled([
      call(c, 'assegnaPinRagazzoAdmin', { uid: 'ka', pin: '909090' }),
      call(c, 'assegnaPinRagazzoAdmin', { uid: 'kb', pin: '909090' }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const ko = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1, 'esattamente una assegnazione riuscita');
    assert.equal(ko.length, 1);
    assert.equal(ko[0].reason.code, 'functions/already-exists');

    const q = await adminSdk.db.collection('utenti_pin').where('pin', '==', '909090').get();
    assert.equal(q.size, 1, 'un solo utenti_pin con quel PIN');
    assert.equal((await adminSdk.db.collection('pin_reservations').doc('909090').get()).exists, true);
  });
});

describe('assegnaPinRagazzoAdmin — compensazione', () => {
  let c;
  beforeEach(async () => { c = await signInAs(LEGACY_ADMIN_UID); });

  test('fallimento batch, Auth creato in questa chiamata -> deleteUser + reservation rilasciata + niente utenti_pin/audit', async () => {
    await seedRagazzo('cx', { nome: 'Comp X' });
    await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: 'cx', pin: '650750', __testFailAfterAuth: true }), 'functions/internal');
    await fails(adminSdk.auth.getUser('cx'), undefined); // Auth creato ora -> eliminato
    assert.equal((await adminSdk.db.collection('pin_reservations').doc('650750').get()).exists, false, 'reservation rilasciata');
    assert.equal((await adminSdk.db.collection('utenti_pin').doc('cx').get()).exists, false, 'nessun utenti_pin');
    assert.equal((await adminSdk.db.collection('admin_audit').where('action', '==', 'PIN_ASSIGNED').get()).size, 0);
  });

  test('fallimento batch, Auth PRE-ESISTENTE -> Auth NON eliminato, reservation rilasciata, niente utenti_pin', async () => {
    await adminSdk.auth.createUser({ uid: 'cy', email: 'cy.pre@example.org' });
    await seedRagazzo('cy', { nome: 'Comp Y' });
    await fails(call(c, 'assegnaPinRagazzoAdmin', { uid: 'cy', pin: '651751', __testFailAfterAuth: true }), 'functions/internal');
    const still = await adminSdk.auth.getUser('cy'); // deve esistere ancora
    assert.equal(still.email, 'cy.pre@example.org');
    assert.equal((await adminSdk.db.collection('pin_reservations').doc('651751').get()).exists, false, 'reservation rilasciata');
    assert.equal((await adminSdk.db.collection('utenti_pin').doc('cy').get()).exists, false, 'nessun utenti_pin');
  });
});
