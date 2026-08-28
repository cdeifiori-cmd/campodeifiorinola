// test/functions/pin-login.test.mjs
// Integrazione callable `loginRagazzoConPin` contro l'emulatore.

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { signInWithCustomToken } from 'firebase/auth';
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
  try { await promise; assert.fail('atteso errore'); }
  catch (e) { if (expectedCode) assert.equal(e.code, expectedCode, `${expectedCode} atteso, ${e.code}`); return e; }
}

// Crea un ragazzo "nuovo modello" tramite la callable e ritorna { uid, pin }.
async function creaNuovo(pin = '445566') {
  const c = await signInAs(LEGACY_ADMIN_UID);
  const res = await call(c, 'creaRagazzoAdmin', {
    nome: 'Login Kid', comunitaId: 'itaca', pin, causale: 'Prima assegnazione',
  });
  await signOutClient();
  return { uid: res.data.uid, pin };
}

describe('loginRagazzoConPin — PIN nuovo modello', () => {
  test('PIN valido -> custom token, signInWithCustomToken riesce', async () => {
    const { uid, pin } = await creaNuovo('112233');
    const c = getClient();
    const res = await call(c, 'loginRagazzoConPin', { pin });
    assert.ok(res.data.token);
    assert.ok(!('password' in res.data) && !('email' in res.data));
    const cred = await signInWithCustomToken(c.auth, res.data.token);
    assert.equal(cred.user.uid, uid);
  });
});

describe('loginRagazzoConPin — compatibilità legacy', () => {
  test('PIN presente solo in utenti_pin_lookup -> risolto via fallback', async () => {
    // ragazzo legacy: account Auth + utenti/{uid} + lookup, NIENTE utenti_pin
    const uid = 'legacy_kid_1';
    await adminSdk.auth.createUser({ uid });
    await adminSdk.db.collection('utenti').doc(uid).set({ nome: 'Legacy', comunitaId: 'itaca', stato: 'attivo' });
    await adminSdk.db.collection('utenti_pin_lookup').doc('998877').set({ uid, email: 'x@y.z' });

    const c = getClient();
    const res = await call(c, 'loginRagazzoConPin', { pin: '998877' });
    assert.ok(res.data.token);
    const cred = await signInWithCustomToken(c.auth, res.data.token);
    assert.equal(cred.user.uid, uid);
  });
});

describe('loginRagazzoConPin — errori uniformi (§9)', () => {
  test('PIN inesistente -> permission-denied "PIN non valido."', async () => {
    const c = getClient();
    const e = await fails(call(c, 'loginRagazzoConPin', { pin: '000111' }), 'functions/permission-denied');
    assert.equal(e.message, 'PIN non valido.');
  });
  test('ragazzo archiviato -> STESSO codice/messaggio', async () => {
    const { pin, uid } = await creaNuovo('223344');
    await adminSdk.db.collection('utenti').doc(uid).update({ stato: 'archiviato' });
    const c = getClient();
    const e = await fails(call(c, 'loginRagazzoConPin', { pin }), 'functions/permission-denied');
    assert.equal(e.message, 'PIN non valido.');
  });
  test('formato PIN non valido -> invalid-argument', async () => {
    const c = getClient();
    await fails(call(c, 'loginRagazzoConPin', { pin: '12' }), 'functions/invalid-argument');
    await fails(call(c, 'loginRagazzoConPin', { pin: 'abcd' }), 'functions/invalid-argument');
  });
  test('nessun PIN nel messaggio d\'errore', async () => {
    const c = getClient();
    const e = await fails(call(c, 'loginRagazzoConPin', { pin: '135790' }), 'functions/permission-denied');
    assert.ok(!e.message.includes('135790'));
  });
});

describe('loginRagazzoConPin — rate limiting (§9)', () => {
  test('troppi tentativi dallo stesso client -> resource-exhausted', async () => {
    const c = getClient();
    let hitLimit = false;
    for (let i = 0; i < 12; i++) {
      try { await call(c, 'loginRagazzoConPin', { pin: '000222' }); }
      catch (e) {
        if (e.code === 'functions/resource-exhausted') { hitLimit = true; break; }
        assert.equal(e.code, 'functions/permission-denied');
      }
    }
    assert.ok(hitLimit, 'il rate limit deve scattare entro pochi tentativi');
  });
});
