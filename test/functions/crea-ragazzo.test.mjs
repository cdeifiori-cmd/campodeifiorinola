// test/functions/crea-ragazzo.test.mjs
// Integrazione callable `creaRagazzoAdmin` contro l'emulatore (Functions+Auth+Firestore).

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
  await seedComunita(['itaca', 'fortapasc', 'after-us']);
});

const okInput = (over = {}) => ({
  nome: 'Adam Test', comunitaId: 'itaca', pin: '445566', causale: 'Prima assegnazione', ...over,
});

async function fails(promise, expectedCode) {
  try { await promise; assert.fail('atteso errore, nessuno lanciato'); }
  catch (e) {
    if (expectedCode) assert.equal(e.code, expectedCode, `code atteso ${expectedCode}, ricevuto ${e.code} (${e.message})`);
    return e;
  }
}

describe('creaRagazzoAdmin — autorizzazione', () => {
  test('non autenticato -> unauthenticated', async () => {
    const c = getClient();
    await fails(call(c, 'creaRagazzoAdmin', okInput()), 'functions/unauthenticated');
  });
  test('ragazzo (nessun doc staff) -> permission-denied', async () => {
    const c = await signInAs('kid_x');
    await fails(call(c, 'creaRagazzoAdmin', okInput()), 'functions/permission-denied');
  });
  test('staff non-admin -> permission-denied', async () => {
    await seedStaff('staff_np', { admin: false, ruolo: 'educatore' });
    const c = await signInAs('staff_np');
    await fails(call(c, 'creaRagazzoAdmin', okInput()), 'functions/permission-denied');
  });
  test('legacy admin -> SUCCESS', async () => {
    const c = await signInAs(LEGACY_ADMIN_UID);
    const res = await call(c, 'creaRagazzoAdmin', okInput());
    assert.ok(res.data.uid);
  });
  test('staff.admin === true -> SUCCESS', async () => {
    await seedStaff('staff_adm', { admin: true });
    const c = await signInAs('staff_adm');
    const res = await call(c, 'creaRagazzoAdmin', okInput({ pin: '778899' }));
    assert.ok(res.data.uid);
  });
});

describe('creaRagazzoAdmin — validazione', () => {
  let c;
  beforeEach(async () => { c = await signInAs(LEGACY_ADMIN_UID); });

  test('comunità inesistente -> failed-precondition', async () => {
    await fails(call(c, 'creaRagazzoAdmin', okInput({ comunitaId: 'nonesiste' })), 'functions/failed-precondition');
  });
  test('After Us presente -> SUCCESS', async () => {
    const res = await call(c, 'creaRagazzoAdmin', okInput({ comunitaId: 'after-us' }));
    assert.ok(res.data.uid);
    const u = await adminSdk.db.collection('utenti').doc(res.data.uid).get();
    assert.equal(u.data().comunitaId, 'after-us');
  });
  test('nome vuoto -> invalid-argument', async () => {
    await fails(call(c, 'creaRagazzoAdmin', okInput({ nome: '   ' })), 'functions/invalid-argument');
  });
  // Formato PIN CANONICO dell'app = 4-6 cifre (evidenze in report Patch E.1):
  // generatore a 6 cifre, /^\d{4,6}$/ in login.html / ragazzi-pin.js / robinson.
  test('PIN formato invalido -> invalid-argument', async () => {
    for (const bad of ['12', '123', 'abcd', '12a4', '1234567', '']) {
      await fails(call(c, 'creaRagazzoAdmin', okInput({ pin: bad })), 'functions/invalid-argument');
    }
  });
  test('PIN validi secondo la policy reale (4-6 cifre, 0000 incluso) -> SUCCESS', async () => {
    for (const good of ['0000', '1234', '12345', '123456']) {
      const res = await call(c, 'creaRagazzoAdmin', okInput({ pin: good }));
      assert.ok(res.data.uid, `PIN ${good} dovrebbe essere accettato`);
    }
  });
  test('causale vuota -> invalid-argument', async () => {
    await fails(call(c, 'creaRagazzoAdmin', okInput({ causale: '  ' })), 'functions/invalid-argument');
  });
});

describe('creaRagazzoAdmin — unicità PIN', () => {
  let c;
  beforeEach(async () => { c = await signInAs(LEGACY_ADMIN_UID); });

  test('PIN già in utenti_pin -> already-exists (senza il PIN nel messaggio)', async () => {
    await adminSdk.db.collection('utenti_pin').doc('u_legacy').set({ uid: 'u_legacy', pin: '111222' });
    const e = await fails(call(c, 'creaRagazzoAdmin', okInput({ pin: '111222' })), 'functions/already-exists');
    assert.ok(!String(e.message).includes('111222'), 'il messaggio non deve contenere il PIN');
  });
  test('PIN già in utenti_pin_lookup -> already-exists', async () => {
    await adminSdk.db.collection('utenti_pin_lookup').doc('222333').set({ uid: 'u_legacy2' });
    await fails(call(c, 'creaRagazzoAdmin', okInput({ pin: '222333' })), 'functions/already-exists');
  });
  test('PIN già in pin_reservations -> already-exists', async () => {
    await adminSdk.db.collection('pin_reservations').doc('333444').set({ uid: 'r_altro', createdAt: new Date() });
    await fails(call(c, 'creaRagazzoAdmin', okInput({ pin: '333444' })), 'functions/already-exists');
  });
});

describe('creaRagazzoAdmin — SUCCESS STATE', () => {
  test('crea account + documenti + appartenenza + audit, senza segreti', async () => {
    const c = await signInAs(LEGACY_ADMIN_UID);
    const pin = '456789';
    const res = await call(c, 'creaRagazzoAdmin', okInput({ pin, nome: 'Bilal' }));
    const uid = res.data.uid;

    // risposta callable: nessun segreto
    assert.deepEqual(Object.keys(res.data).sort(), ['comunitaId', 'stato', 'uid']);
    assert.ok(!('password' in res.data) && !('pin' in res.data));

    // account Auth
    const authUser = await adminSdk.auth.getUser(uid);
    assert.equal(authUser.uid, uid);

    // utenti/{uid}
    const u = (await adminSdk.db.collection('utenti').doc(uid).get()).data();
    assert.equal(u.comunitaId, 'itaca');
    assert.equal(u.stato, 'attivo');
    assert.ok(!('password' in u) && !('pin' in u));

    // utenti_pin/{uid} — ha il pin, NON la password
    const up = (await adminSdk.db.collection('utenti_pin').doc(uid).get()).data();
    assert.equal(up.pin, pin);
    assert.ok(!('password' in up));

    // pin_reservations/{pin} — dopo una creazione riuscita deve essere ACTIVE
    const pr = (await adminSdk.db.collection('pin_reservations').doc(pin).get()).data();
    assert.equal(pr.uid, uid);
    assert.equal(pr.status, 'ACTIVE');
    assert.ok(pr.activatedAt, 'activatedAt impostato alla transizione RESERVED->ACTIVE');

    // email sintetica: deterministica dall'UID, senza nome, senza PIN
    assert.equal(authUser.email, `${uid}.ragazzo@campodeifiori.org`);
    assert.match(authUser.email, /^r_[0-9a-f]{28}\.ragazzo@campodeifiori\.org$/);
    assert.ok(!authUser.email.includes(pin), 'la email non contiene il PIN');

    // NIENTE utenti_pin_lookup
    assert.equal((await adminSdk.db.collection('utenti_pin_lookup').doc(pin).get()).exists, false);

    // esattamente 1 appartenenza APERTA, 0 baseline
    const aps = await adminSdk.db.collection('utenti').doc(uid).collection('appartenenze').get();
    assert.equal(aps.size, 1);
    const ap = aps.docs[0].data();
    assert.equal(ap.al, null);
    assert.equal(ap.comunitaId, 'itaca');
    assert.ok(!('legacyBaseline' in ap));

    // audit USER_CREATED — nessun pin/password
    const au = await adminSdk.db.collection('admin_audit').where('action', '==', 'USER_CREATED').get();
    assert.equal(au.size, 1);
    const a = au.docs[0].data();
    assert.equal(a.targetType, 'utente');
    assert.equal(a.targetId, uid);
    assert.deepEqual(a.before, {});
    assert.deepEqual(a.after, { comunitaId: 'itaca', stato: 'attivo' });
    assert.ok(!JSON.stringify(a).includes(pin), 'audit non deve contenere il PIN');
    assert.ok(!('password' in a));
  });
});

describe('creaRagazzoAdmin — compensazione', () => {
  let c;
  beforeEach(async () => { c = await signInAs(LEGACY_ADMIN_UID); });

  test('reservation collision -> nessun account Auth creato', async () => {
    await adminSdk.db.collection('pin_reservations').doc('600700').set({ uid: 'r_x', createdAt: new Date() });
    const before = (await adminSdk.auth.listUsers(1000)).users.length;
    await fails(call(c, 'creaRagazzoAdmin', okInput({ pin: '600700' })), 'functions/already-exists');
    const after = (await adminSdk.auth.listUsers(1000)).users.length;
    assert.equal(after, before, 'nessun nuovo utente Auth');
    // e nessun utenti_pin nuovo con quel pin oltre a quello preesistente
    const q = await adminSdk.db.collection('utenti_pin').where('pin', '==', '600700').get();
    assert.equal(q.size, 0);
  });

  test('Firestore fallisce dopo Auth -> deleteUser + reservation rilasciata + niente utenti', async () => {
    const usersBefore = new Set((await adminSdk.auth.listUsers(1000)).users.map((u) => u.uid));
    await fails(call(c, 'creaRagazzoAdmin', okInput({ pin: '650750', __testFailAfterAuth: true })), 'functions/internal');

    const usersAfter = (await adminSdk.auth.listUsers(1000)).users.map((u) => u.uid);
    assert.deepEqual(usersAfter.filter((u) => !usersBefore.has(u)), [], 'nessun Auth orfano');
    assert.equal((await adminSdk.db.collection('pin_reservations').doc('650750').get()).exists, false, 'reservation rilasciata');
    const anyUtenti = await adminSdk.db.collection('utenti').where('comunitaId', '==', 'itaca').get();
    assert.equal(anyUtenti.size, 0, 'nessun utenti parziale');
    assert.equal((await adminSdk.db.collection('admin_audit').where('action', '==', 'USER_CREATED').get()).size, 0);
  });
});

describe('creaRagazzoAdmin — concorrenza PIN', () => {
  test('due create simultanee con lo stesso PIN: una sola riesce', async () => {
    const c = await signInAs(LEGACY_ADMIN_UID);
    const results = await Promise.allSettled([
      call(c, 'creaRagazzoAdmin', okInput({ pin: '909090', nome: 'A' })),
      call(c, 'creaRagazzoAdmin', okInput({ pin: '909090', nome: 'B' })),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const ko = results.filter((r) => r.status === 'rejected');
    assert.equal(ok.length, 1, 'esattamente una creazione riuscita');
    assert.equal(ko.length, 1);
    assert.equal(ko[0].reason.code, 'functions/already-exists');

    const q = await adminSdk.db.collection('utenti_pin').where('pin', '==', '909090').get();
    assert.equal(q.size, 1, 'un solo utenti_pin con quel PIN');
    assert.equal((await adminSdk.db.collection('pin_reservations').doc('909090').get()).exists, true);
    const users = (await adminSdk.auth.listUsers(1000)).users.filter((u) => u.uid.startsWith('r_'));
    assert.equal(users.length, 1, 'un solo account Auth ragazzo');
  });
});

describe('creaRagazzoAdmin — email sintetica', () => {
  test('deterministica dall\'UID, indipendente dal nome, senza PIN, senza collisioni', async () => {
    const c = await signInAs(LEGACY_ADMIN_UID);
    const r1 = await call(c, 'creaRagazzoAdmin', okInput({ nome: 'Mario Rossi', pin: '414141' }));
    const r2 = await call(c, 'creaRagazzoAdmin', okInput({ nome: 'Mario Rossi', pin: '424242' }));

    const u1 = await adminSdk.auth.getUser(r1.data.uid);
    const u2 = await adminSdk.auth.getUser(r2.data.uid);

    // forma canonica: <uid>.ragazzo@campodeifiori.org
    assert.equal(u1.email, `${r1.data.uid}.ragazzo@campodeifiori.org`);
    assert.equal(u2.email, `${r2.data.uid}.ragazzo@campodeifiori.org`);
    // stesso nome -> email DIVERSE (dipende solo dall'UID, non dal nome)
    assert.notEqual(u1.email, u2.email);
    // nessun PIN nella email
    assert.ok(!u1.email.includes('414141') && !u2.email.includes('424242'));
    // il local-part NON contiene lo slug del nome
    assert.ok(!u1.email.includes('mario') && !u1.email.includes('rossi'));
  });
});
