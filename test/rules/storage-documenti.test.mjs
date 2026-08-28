// test/rules/storage-documenti.test.mjs
// Storage Rules — Area Documenti (Milestone C §5 / §12).
// Semantica TRI-STATE + scope comunità per documenti/{comunitaId}/** e
// documenti/documenti-generali/**.
//
// storage.rules legge lo staff da Firestore (firestore.get / firestore.exists):
// la suite gira con firestore+auth+storage (vedi package.json "test:rules") e
// semina i doc staff a regole disattivate. Usa il projectId del flag --project
// (baseProject:true) perché il cross-service firestore.get() risolve in modo
// affidabile solo su quel projectId. Gira in un `node --test` DEDICATO (dopo la
// suite Firestore) per non competere con gli altri file sull'emulatore.
//
// read/create/update condividono la stessa condizione (canAccessDocumenti*):
// la matrice è verificata su upload (allow create) e, per alcuni casi, su
// getDownloadURL (allow read) di un oggetto seminato.

import { test, before, after, describe } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { getTestEnv, seedIdentities, seedTriState, UIDS } from './helpers.mjs';

let env;
let n = 0;
const freshPath = (com) => `documenti/${com}/minorX/Sanitaria/u_${Date.now()}_${n++}.txt`;
const genPath = () => `documenti/documenti-generali/u_${Date.now()}_${n++}.txt`;
const uploadAs = (uid, path) => uploadString(ref(env.authenticatedContext(uid).storage(), path), 'y');
const SEED_ITACA = 'documenti/itaca/minor1/Sanitaria/seed.txt';
const readSeedAs = (uid, path) => getDownloadURL(ref(env.authenticatedContext(uid).storage(), path));

before(async () => {
  env = await getTestEnv('storage-documenti', { baseProject: true });
  if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
    console.error('\n[STOP] emulatore Storage non attivo: esegui con `npm run test:rules`.\n');
    process.exit(1);
  }
  await env.clearFirestore();
  await env.clearStorage();
  await seedIdentities(env);
  await seedTriState(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await uploadString(ref(ctx.storage(), SEED_ITACA), 'x');
    await uploadString(ref(ctx.storage(), 'documenti/documenti-generali/seed.txt'), 'x');
  });
  // Warm-up: inizializza la pipeline Storage+Rules+cross-service prima dei test.
  for (let i = 0; i < 3; i++) {
    try { await uploadAs(UIDS.legacyAdmin, freshPath('itaca')); } catch (_) {}
  }
});
after(async () => { await env.cleanup(); });

describe('Storage documenti/{comunitaId}/** — TRI-STATE (create in Itaca)', () => {
  test('coordinatore SENZA campo -> ALLOW (legacy)', async () => {
    await assertSucceeds(uploadAs(UIDS.staffCoord, freshPath('itaca')));
  });
  test('coordinatore accessoDocumenti === true -> ALLOW', async () => {
    await assertSucceeds(uploadAs(UIDS.coordTrue, freshPath('itaca')));
  });
  test('coordinatore accessoDocumenti === false -> DENY (prevale sul ruolo)', async () => {
    await assertFails(uploadAs(UIDS.coordFalse, freshPath('itaca')));
  });
  test('educatore SENZA campo -> DENY', async () => {
    await assertFails(uploadAs(UIDS.staffPlain, freshPath('itaca')));
  });
  test('educatore accessoDocumenti === true -> ALLOW', async () => {
    await assertSucceeds(uploadAs(UIDS.staffDocs, freshPath('itaca')));
  });
  test('educatore accessoDocumenti === false -> DENY', async () => {
    await assertFails(uploadAs(UIDS.eduFalse, freshPath('itaca')));
  });
  test('ragazzo (nessun doc staff) -> DENY', async () => {
    await assertFails(uploadAs(UIDS.ragazzo, freshPath('itaca')));
  });
});

describe('Storage documenti/{comunitaId}/** — lettura (getDownloadURL su oggetto seminato)', () => {
  test('coordinatore SENZA campo legge la scheda di Itaca', async () => {
    await assertSucceeds(readSeedAs(UIDS.staffCoord, SEED_ITACA));
  });
  test('coordinatore con false NON legge', async () => {
    await assertFails(readSeedAs(UIDS.coordFalse, SEED_ITACA));
  });
  test('legacy admin legge', async () => {
    await assertSucceeds(readSeedAs(UIDS.legacyAdmin, SEED_ITACA));
  });
  test('ragazzo NON legge', async () => {
    await assertFails(readSeedAs(UIDS.ragazzo, SEED_ITACA));
  });
});

describe('Storage documenti/{comunitaId}/** — SCOPE comunità', () => {
  test('staff Itaca (true): Itaca ALLOW, Fortapasc DENY', async () => {
    await assertSucceeds(uploadAs(UIDS.staffDocs, freshPath('itaca')));
    await assertFails(uploadAs(UIDS.staffDocs, freshPath('fortapasc')));
  });
  test('staff comunitaId array [Itaca, Fortapasc] (true): entrambe ALLOW', async () => {
    await assertSucceeds(uploadAs(UIDS.multiTrue, freshPath('itaca')));
    await assertSucceeds(uploadAs(UIDS.multiTrue, freshPath('fortapasc')));
  });
  test('staff accessoDocumenti true ma comunitaId ASSENTE -> DENY', async () => {
    await assertFails(uploadAs(UIDS.noComunita, freshPath('itaca')));
    await assertFails(uploadAs(UIDS.noComunita, freshPath('fortapasc')));
  });
  test('coordinatore Itaca SENZA campo: Fortapasc DENY (scope)', async () => {
    await assertFails(uploadAs(UIDS.staffCoord, freshPath('fortapasc')));
  });
});

describe('Storage documenti/documenti-generali/** — TRI-STATE senza scope', () => {
  test('coordinatore SENZA campo -> ALLOW', async () => {
    await assertSucceeds(uploadAs(UIDS.staffCoord, genPath()));
  });
  test('coordinatore false -> DENY', async () => {
    await assertFails(uploadAs(UIDS.coordFalse, genPath()));
  });
  test('educatore true -> ALLOW', async () => {
    await assertSucceeds(uploadAs(UIDS.staffDocs, genPath()));
  });
  test('educatore SENZA campo -> DENY', async () => {
    await assertFails(uploadAs(UIDS.staffPlain, genPath()));
  });
});

describe('Storage documenti/** — super-user e admin "nuovo modello"', () => {
  test('legacy admin: upload in qualsiasi comunità e in Generali', async () => {
    await assertSucceeds(uploadAs(UIDS.legacyAdmin, freshPath('itaca')));
    await assertSucceeds(uploadAs(UIDS.legacyAdmin, freshPath('fortapasc')));
    await assertSucceeds(uploadAs(UIDS.legacyAdmin, genPath()));
  });
  // NOTA (documentata nel report): storage.rules isAdmin() è ancora solo UID legacy;
  // un admin "nuovo modello" (staff.admin===true) NON è super-user in Storage e
  // accede solo via ruolo/flag+scope. staffAdmin qui è coordinatore di Itaca.
  test('admin nuovo modello: Itaca ALLOW (via ruolo), Fortapasc DENY (scope)', async () => {
    await assertSucceeds(uploadAs(UIDS.staffAdmin, freshPath('itaca')));
    await assertFails(uploadAs(UIDS.staffAdmin, freshPath('fortapasc')));
  });
});
