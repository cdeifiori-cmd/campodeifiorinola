// test/rules/helpers.mjs
// Setup condiviso per i test delle Security Rules Firestore (Milestone A).
//
// SICUREZZA (decisione §18.12 / §5): questi test devono girare ESCLUSIVAMENTE
// contro l'emulatore locale, MAI contro il progetto reale `campo-dei-fiori`.
// La guardia anti-produzione fa `process.exit(1)` immediato se:
//   - non è configurato l'host dell'emulatore Firestore (o non è locale);
//   - il projectId non ha il prefisso di test `demo-campo-dei-fiori-test-`
//     (o coincide col reale `campo-dei-fiori`);
//   - è presente `GOOGLE_APPLICATION_CREDENTIALS`;
//   - `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT` puntano al progetto reale.
//
// Ogni file di test usa un projectId DEDICATO (`${PREFIX}-${suite}`): l'emulatore
// tiene i progetti separati, quindi il `clearFirestore()` di un file non tocca i
// dati di un altro file anche quando i file girano in parallelo.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const TEST_PROJECT_PREFIX = 'demo-campo-dei-fiori-test';
const REAL_PROJECT_ID = 'campo-dei-fiori';

// ── Guardia anti-produzione ────────────────────────────────────────────────
function assertEmulatorOnly(projectId) {
  const errors = [];

  const fsHost = process.env.FIRESTORE_EMULATOR_HOST;
  if (!fsHost) {
    errors.push(
      'FIRESTORE_EMULATOR_HOST non impostato. Esegui i test con `npm run test:rules` ' +
      '(che invoca `firebase emulators:exec` e imposta l\'host dell\'emulatore).'
    );
  } else if (!/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+$/.test(fsHost)) {
    errors.push(`FIRESTORE_EMULATOR_HOST sospetto ("${fsHost}"): atteso host locale.`);
  }

  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  if (authHost && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d+$/.test(authHost)) {
    errors.push(`FIREBASE_AUTH_EMULATOR_HOST sospetto ("${authHost}"): atteso host locale.`);
  }

  if (
    !projectId ||
    projectId === REAL_PROJECT_ID ||
    !projectId.startsWith('demo-') ||
    !projectId.startsWith(TEST_PROJECT_PREFIX + '-')
  ) {
    errors.push(
      `projectId di test non sicuro ("${projectId}"): deve iniziare con ` +
      `"${TEST_PROJECT_PREFIX}-" e non può essere il progetto reale "${REAL_PROJECT_ID}".`
    );
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    errors.push(
      `GOOGLE_APPLICATION_CREDENTIALS è impostato ("${process.env.GOOGLE_APPLICATION_CREDENTIALS}"). ` +
      `I test regole NON devono avere credenziali reali.`
    );
  }
  const gcp = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (gcp && gcp === REAL_PROJECT_ID) {
    errors.push(`GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT punta al progetto reale "${REAL_PROJECT_ID}".`);
  }

  if (errors.length) {
    console.error('\n[STOP] Guardia anti-produzione fallita:\n- ' + errors.join('\n- ') + '\n');
    process.exit(1);
  }
}

// ── Ambiente di test (uno per "suite" = per file) ─────────────────────────
const envs = new Map();

/**
 * @param {string} suite  slug del file di test, es. 'utenti', 'staff-amici'.
 *                        Diventa il suffisso del projectId dedicato.
 */
export async function getTestEnv(suite) {
  if (!/^[a-z0-9-]+$/.test(String(suite || ''))) {
    console.error(`\n[STOP] nome suite non valido: "${suite}" (atteso slug [a-z0-9-]).\n`);
    process.exit(1);
  }
  if (envs.has(suite)) return envs.get(suite);

  const projectId = `${TEST_PROJECT_PREFIX}-${suite}`;
  assertEmulatorOnly(projectId);

  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const rules = readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8');

  const env = await initializeTestEnvironment({
    projectId,
    firestore: { rules, host, port: Number(port) },
  });
  envs.set(suite, env);
  return env;
}

export const LEGACY_ADMIN_UID = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';

// ── UID di comodo per i contesti di test ──────────────────────────────────
export const UIDS = {
  ragazzo:     'ragazzo_fortapasc',
  ragazzo2:    'ragazzo_itaca',
  staffPlain:  'staff_educatore_itaca',      // nessun ruolo coord, no accessoDocumenti, no admin
  staffCoord:  'staff_coord_itaca',          // ruolo coordinatrice di Itaca
  staffDocs:   'staff_accessodoc_itaca',     // accessoDocumenti === true, comunità Itaca
  staffAdmin:  'staff_admin_nuovo_modello',  // admin === true (nuovo modello §8)
  legacyAdmin: LEGACY_ADMIN_UID,
  amico:       'amico_generico',
};

// Semina i documenti di identità di base con le regole disattivate.
export async function seedIdentities(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const { setDoc, doc } = await import('firebase/firestore');

    await setDoc(doc(db, 'utenti', UIDS.ragazzo), {
      nome: 'Adam', comunitaId: 'fortapasc', stato: 'attivo',
      admin: false, fotoProfilo: '', email: 'adam.ragazzo@campodeifiori.org',
      interazioni: { commentiScritti: 0 },
    });
    await setDoc(doc(db, 'utenti', UIDS.ragazzo2), {
      nome: 'Bilal', comunitaId: 'itaca', stato: 'attivo', admin: false,
    });
    await setDoc(doc(db, 'staff', UIDS.staffPlain), {
      nome: 'Educatore Semplice', ruolo: 'educatore', comunitaId: 'itaca',
      admin: false, email: 'edu@example.org',
    });
    await setDoc(doc(db, 'staff', UIDS.staffCoord), {
      nome: 'Coordinatrice Itaca', ruolo: 'Coordinatrice Comunità Itaca',
      comunitaId: 'itaca', admin: false, email: 'coord@example.org',
    });
    await setDoc(doc(db, 'staff', UIDS.staffDocs), {
      nome: 'Educatrice con accesso', ruolo: 'educatore',
      comunitaId: 'itaca', accessoDocumenti: true, admin: false,
      email: 'edudoc@example.org',
    });
    await setDoc(doc(db, 'staff', UIDS.staffAdmin), {
      nome: 'Admin Nuovo Modello', ruolo: 'coordinatore',
      comunitaId: 'itaca', admin: true, email: 'admin2@example.org',
    });
    await setDoc(doc(db, 'amici', UIDS.amico), {
      nome: 'Amico', email: 'amico@example.org',
    });
  });
}
