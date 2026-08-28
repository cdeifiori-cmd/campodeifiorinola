// test/functions/pin-reconcile.test.mjs
// Patch E.1 — riconciliazione degli stati PIN parziali/incoerenti.
// Testa functions/pinReconcile.js (helper server-side, NON callable) contro
// l'emulatore Firestore+Auth, più un giro end-to-end via `creaRagazzoAdmin`.

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getAdmin, getClient, teardownClient, wipeEmulator, seedComunita,
  signInAs, signOutClient, call, LEGACY_ADMIN_UID,
} from './fn-helpers.mjs';
import {
  PIN_STATE, classifyPinState, reconcileAll, cleanupOrphanReservation,
} from '../../functions/pinReconcile.js';

let adminSdk;
let deps;
before(() => { adminSdk = getAdmin(); deps = { db: adminSdk.db, auth: adminSdk.auth }; });
after(async () => { await teardownClient(); });
beforeEach(async () => {
  await signOutClient();
  await wipeEmulator();
  await seedComunita(['itaca', 'after-us']);
});

const reservation = (pin, data) =>
  adminSdk.db.collection('pin_reservations').doc(pin).set({ createdAt: new Date(), ...data });

// ── Classificazione degli stati di crash ────────────────────────────────────
describe('classifyPinState — stati parziali', () => {
  test('RESERVED senza Auth né profilo -> ORPHAN_RESERVATION', async () => {
    await reservation('400001', { uid: 'r_orphan', status: 'RESERVED' });
    const r = await classifyPinState(deps, '400001');
    assert.equal(r.state, PIN_STATE.ORPHAN_RESERVATION);
    assert.equal(r.uid, 'r_orphan');
  });

  test('RESERVED + Auth senza profilo -> INCOMPLETE_AUTH', async () => {
    await adminSdk.auth.createUser({ uid: 'r_half' });
    await reservation('400002', { uid: 'r_half', status: 'RESERVED' });
    const r = await classifyPinState(deps, '400002');
    assert.equal(r.state, PIN_STATE.INCOMPLETE_AUTH);
  });

  test('RESERVED + Auth + profilo (ACTIVE perso) -> RESERVED_STALE', async () => {
    await adminSdk.auth.createUser({ uid: 'r_stale' });
    await adminSdk.db.collection('utenti').doc('r_stale').set({ nome: 'S', comunitaId: 'itaca', stato: 'attivo' });
    await adminSdk.db.collection('utenti_pin').doc('r_stale').set({ uid: 'r_stale', pin: '400003' });
    await reservation('400003', { uid: 'r_stale', status: 'RESERVED' });
    const r = await classifyPinState(deps, '400003');
    assert.equal(r.state, PIN_STATE.RESERVED_STALE);
  });

  test('creazione reale -> reservation ACTIVE e stato HEALTHY', async () => {
    const c = await signInAs(LEGACY_ADMIN_UID);
    const res = await call(c, 'creaRagazzoAdmin', {
      nome: 'Healthy Kid', comunitaId: 'itaca', pin: '400004', causale: 'Prima assegnazione',
    });
    await signOutClient();
    const pr = (await adminSdk.db.collection('pin_reservations').doc('400004').get()).data();
    assert.equal(pr.status, 'ACTIVE');
    const r = await classifyPinState(deps, '400004');
    assert.equal(r.state, PIN_STATE.HEALTHY);
    assert.equal(r.uid, res.data.uid);
  });

  test('ACTIVE ma profilo mancante -> INCONSISTENT_ACTIVE', async () => {
    await adminSdk.auth.createUser({ uid: 'r_broken' });
    await reservation('400005', { uid: 'r_broken', status: 'ACTIVE', activatedAt: new Date() });
    const r = await classifyPinState(deps, '400005');
    assert.equal(r.state, PIN_STATE.INCONSISTENT_ACTIVE);
  });

  test('PIN sconosciuto -> NOT_FOUND', async () => {
    const r = await classifyPinState(deps, '999999');
    assert.equal(r.state, PIN_STATE.NOT_FOUND);
    assert.equal(r.uid, null);
  });
});

// ── Inconsistenze senza reservation: legacy vs sconosciuto ──────────────────
describe('classifyPinState — utenti_pin senza reservation', () => {
  test('utenti_pin + utenti_pin_lookup -> LEGACY', async () => {
    await adminSdk.db.collection('utenti_pin').doc('u_leg').set({ uid: 'u_leg', pin: '410001' });
    await adminSdk.db.collection('utenti_pin_lookup').doc('410001').set({ uid: 'u_leg', email: 'x@y.z' });
    const r = await classifyPinState(deps, '410001');
    assert.equal(r.state, PIN_STATE.LEGACY);
  });

  test('utenti_pin senza lookup né reservation -> INCONSISTENT_NO_RESERVATION (limite dichiarato)', async () => {
    await adminSdk.db.collection('utenti_pin').doc('u_x').set({ uid: 'u_x', pin: '410002' });
    const r = await classifyPinState(deps, '410002');
    assert.equal(r.state, PIN_STATE.INCONSISTENT_NO_RESERVATION);
  });
});

// ── Cleanup: ownership + solo orfane, mai Auth/utenti, mai ACTIVE ───────────
describe('cleanupOrphanReservation — protezioni', () => {
  test('senza expectedUid -> DENIED, reservation intatta', async () => {
    await reservation('420001', { uid: 'r_a', status: 'RESERVED' });
    const out = await cleanupOrphanReservation(deps, '420001', undefined);
    assert.equal(out.action, 'DENIED');
    assert.equal((await adminSdk.db.collection('pin_reservations').doc('420001').get()).exists, true);
  });

  test('ownership mismatch -> DENIED, reservation intatta', async () => {
    await reservation('420002', { uid: 'r_owner', status: 'RESERVED' });
    const out = await cleanupOrphanReservation(deps, '420002', 'r_someone_else');
    assert.equal(out.action, 'DENIED');
    assert.match(out.reason, /ownership/);
    assert.equal((await adminSdk.db.collection('pin_reservations').doc('420002').get()).exists, true);
  });

  test('reservation ACTIVE -> DENIED anche con uid giusto', async () => {
    await reservation('420003', { uid: 'r_ok', status: 'ACTIVE', activatedAt: new Date() });
    const out = await cleanupOrphanReservation(deps, '420003', 'r_ok');
    assert.equal(out.action, 'DENIED');
    assert.equal((await adminSdk.db.collection('pin_reservations').doc('420003').get()).exists, true);
  });

  test('stato non orfano (RESERVED_STALE) -> SKIPPED, niente cancellazioni', async () => {
    await adminSdk.auth.createUser({ uid: 'r_stale2' });
    await adminSdk.db.collection('utenti').doc('r_stale2').set({ nome: 'S', comunitaId: 'itaca', stato: 'attivo' });
    await reservation('420004', { uid: 'r_stale2', status: 'RESERVED' });
    const out = await cleanupOrphanReservation(deps, '420004', 'r_stale2');
    assert.equal(out.action, 'SKIPPED');
    assert.equal((await adminSdk.db.collection('pin_reservations').doc('420004').get()).exists, true);
    assert.equal((await adminSdk.db.collection('utenti').doc('r_stale2').get()).exists, true, 'utenti intatto');
    assert.ok(await adminSdk.auth.getUser('r_stale2'), 'Auth intatto');
  });

  test('orfana vera + uid giusto -> DELETED; Auth/utenti mai toccati', async () => {
    await reservation('420005', { uid: 'r_gone', status: 'RESERVED' });
    const out = await cleanupOrphanReservation(deps, '420005', 'r_gone');
    assert.equal(out.action, 'DELETED');
    assert.equal((await adminSdk.db.collection('pin_reservations').doc('420005').get()).exists, false);
    // non esistevano e continuano a non esistere: nessuna creazione/cancellazione collaterale
    await assert.rejects(adminSdk.auth.getUser('r_gone'));
    assert.equal((await adminSdk.db.collection('utenti').doc('r_gone').get()).exists, false);
  });
});

// ── Diagnosi aggregata ─────────────────────────────────────────────────────
describe('reconcileAll — diagnosi strutturata', () => {
  test('classifica tutte le reservation presenti', async () => {
    await reservation('430001', { uid: 'r_o1', status: 'RESERVED' });               // ORPHAN
    await adminSdk.auth.createUser({ uid: 'r_o2' });
    await reservation('430002', { uid: 'r_o2', status: 'RESERVED' });               // INCOMPLETE_AUTH
    const c = await signInAs(LEGACY_ADMIN_UID);
    await call(c, 'creaRagazzoAdmin', { nome: 'K', comunitaId: 'itaca', pin: '430003', causale: 'x' }); // HEALTHY
    await signOutClient();

    const rep = await reconcileAll(deps, {});
    assert.equal(rep.scanned, 3);
    assert.equal(rep.byState[PIN_STATE.ORPHAN_RESERVATION], 1);
    assert.equal(rep.byState[PIN_STATE.INCOMPLETE_AUTH], 1);
    assert.equal(rep.byState[PIN_STATE.HEALTHY], 1);
  });
});
