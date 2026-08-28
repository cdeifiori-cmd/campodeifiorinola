// test/functions/fn-helpers.mjs
// Setup per i test di integrazione delle Cloud Functions callable
// (creaRagazzoAdmin, loginRagazzoConPin) contro l'emulatore.
//
// SICUREZZA: gira SOLO su emulatore, projectId "demo-*". Guardia anti-produzione
// che fa exit(1) se l'ambiente non è quello atteso.
//
// La callable, dentro l'emulatore, inizializza l'Admin SDK sul progetto
// configurato all'avvio (GCLOUD_PROJECT = "demo-campo-dei-fiori-test"), quindi
// client di test E seeding admin usano lo stesso projectId "base".

import { initializeApp as initClient, deleteApp } from 'firebase/app';
import {
  getAuth, connectAuthEmulator, signInWithCustomToken, signOut,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'firebase/functions';
import admin from 'firebase-admin';

export const PROJECT_ID = 'demo-campo-dei-fiori-test';
const REAL_PROJECT_ID = 'campo-dei-fiori';
export const REGION = 'europe-west1';
export const LEGACY_ADMIN_UID = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';

function parseHost(v, dflt) {
  const s = v || dflt;
  const [host, port] = String(s).split(':');
  return { host, port: Number(port) };
}

function assertEmulatorOnly() {
  const errs = [];
  const fs = process.env.FIRESTORE_EMULATOR_HOST;
  const au = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (!fs || !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+$/.test(fs)) {
    errs.push(`FIRESTORE_EMULATOR_HOST non locale ("${fs}"). Esegui con: npm run test:rules`);
  }
  if (!au || !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+$/.test(au)) {
    errs.push(`FIREBASE_AUTH_EMULATOR_HOST non locale ("${au}").`);
  }
  if (PROJECT_ID === REAL_PROJECT_ID || !PROJECT_ID.startsWith('demo-')) {
    errs.push(`PROJECT_ID non sicuro ("${PROJECT_ID}").`);
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    errs.push('GOOGLE_APPLICATION_CREDENTIALS impostato: rimuovilo prima dei test.');
  }
  if (errs.length) {
    console.error('\n[STOP] Guardia anti-produzione fallita:\n- ' + errs.join('\n- ') + '\n');
    process.exit(1);
  }
}

// ── Admin SDK (emulatore) ────────────────────────────────────────────────
let _admin = null;
export function getAdmin() {
  if (_admin) return _admin;
  assertEmulatorOnly();
  const app = admin.apps.length
    ? admin.app()
    : admin.initializeApp({ projectId: PROJECT_ID });
  _admin = { app, auth: admin.auth(app), db: admin.firestore(app) };
  return _admin;
}

// ── Client SDK (emulatore) ──────────────────────────────────────────────
let _client = null;
export function getClient() {
  if (_client) return _client;
  assertEmulatorOnly();
  const app = initClient({ projectId: PROJECT_ID, apiKey: 'fake-api-key' }, 'fn-test-' + Date.now());
  const auth = getAuth(app);
  const fs = parseHost(process.env.FIRESTORE_EMULATOR_HOST);
  const fn = parseHost(process.env.FUNCTIONS_EMULATOR_HOST, '127.0.0.1:5001');
  connectAuthEmulator(auth, `http://${parseHost(process.env.FIREBASE_AUTH_EMULATOR_HOST).host}:${parseHost(process.env.FIREBASE_AUTH_EMULATOR_HOST).port}`, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, fs.host, fs.port);
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, fn.host, fn.port);
  _client = { app, auth, db, functions };
  return _client;
}

export async function teardownClient() {
  if (_client) { try { await deleteApp(_client.app); } catch (_) {} _client = null; }
}

// ── Utilità ─────────────────────────────────────────────────────────────

/** Cancella tutti gli utenti Auth e i documenti delle collezioni indicate (Admin SDK). */
export async function wipeEmulator(collections = [
  'utenti', 'utenti_pin', 'utenti_pin_lookup', 'pin_reservations',
  'pin_login_rate', 'admin_audit', 'staff', 'comunita',
]) {
  const { auth, db } = getAdmin();
  // Auth
  let page = await auth.listUsers(1000);
  while (page.users.length) {
    await auth.deleteUsers(page.users.map((u) => u.uid)).catch(() => {});
    if (!page.pageToken) break;
    page = await auth.listUsers(1000, page.pageToken);
  }
  // Firestore (ricorsivo)
  for (const c of collections) {
    await db.recursiveDelete(db.collection(c)).catch(() => {});
  }
}

export async function seedComunita(ids = ['itaca', 'fortapasc', 'after-us']) {
  const { db } = getAdmin();
  const b = db.batch();
  for (const id of ids) b.set(db.collection('comunita').doc(id), { nomeComunita: id });
  await b.commit();
}

export async function seedStaff(uid, data) {
  const { db } = getAdmin();
  await db.collection('staff').doc(uid).set({ nome: uid, ...data });
}

/** Firma un idToken emulatore per `uid` e ritorna il client autenticato come quell'uid. */
export async function signInAs(uid) {
  const { auth: adminAuth } = getAdmin();
  try { await adminAuth.getUser(uid); }
  catch { await adminAuth.createUser({ uid }); }
  const token = await adminAuth.createCustomToken(uid); // non firmato nell'emulatore
  const c = getClient();
  await signInWithCustomToken(c.auth, token);
  return c;
}

export async function signOutClient() {
  const c = getClient();
  try { await signOut(c.auth); } catch (_) {}
}

export function call(client, name, data) {
  return httpsCallable(client.functions, name)(data);
}
