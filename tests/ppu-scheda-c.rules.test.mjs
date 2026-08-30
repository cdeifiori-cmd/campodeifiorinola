// tests/ppu-scheda-c.rules.test.mjs
// Regole Firestore della Scheda C PPU (collezione ppu_schede_c) + verifica
// di NON regressione sulle Schede A/B.
//
//   npm run test:rules
// (avvia l'emulatore Firestore via `firebase emulators:exec` e poi
//  `node --test` su questo file).
//
// Le regole di ppu_schede_c riusano canAccessPPU(): admin (uid legacy),
// coordinatore/responsabile per comunità, staff con accessoDocumenti per
// comunità. Un ragazzo (login PIN, nessun doc "staff") non accede mai.

import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-campo-dei-fiori-test';
const ADMIN_UID = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';

const UIDS = {
  admin: ADMIN_UID,
  coordItaca: 'coord-itaca',
  coordForta: 'coord-forta',
  staffDocsItaca: 'staff-docs-itaca',
  staffPlain: 'staff-plain',        // staff senza ruolo coord e senza accessoDocumenti
  ragazzo: 'ragazzo-pin',           // nessun doc staff
};

const CREATED_AT = '2026-05-01T09:00:00.000Z';

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});
after(async () => { await env.cleanup(); });

async function seedIdentitiesAndSchede() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staff', UIDS.coordItaca),     { nome: 'Coord Itaca',   ruolo: 'coordinatrice', comunitaId: 'itaca' });
    await setDoc(doc(db, 'staff', UIDS.coordForta),     { nome: 'Coord Forta',   ruolo: 'responsabile',  comunitaId: 'fortapasc' });
    await setDoc(doc(db, 'staff', UIDS.staffDocsItaca), { nome: 'Educ Itaca',    ruolo: 'educatore',     comunitaId: 'itaca', accessoDocumenti: true });
    await setDoc(doc(db, 'staff', UIDS.staffPlain),     { nome: 'Educ Plain',    ruolo: 'educatore',     comunitaId: 'itaca' });

    for (const coll of ['ppu_schede_a', 'ppu_schede_b', 'ppu_schede_c']) {
      await setDoc(doc(db, coll, `${coll}_itaca`), {
        comunitaId: 'itaca', minorId: 'minore-1', createdBy: UIDS.coordItaca,
        createdAt: CREATED_AT, status: 'bozza',
      });
      await setDoc(doc(db, coll, `${coll}_forta`), {
        comunitaId: 'fortapasc', minorId: 'minore-2', createdBy: UIDS.coordForta,
        createdAt: CREATED_AT, status: 'bozza',
      });
    }
    // storico: due Schede C dello STESSO minore, non sovrapposte
    await setDoc(doc(db, 'ppu_schede_c', 'storico_1'), {
      comunitaId: 'itaca', minorId: 'minore-1', createdBy: UIDS.coordItaca,
      createdAt: '2026-01-10T09:00:00.000Z', status: 'completata',
    });
    await setDoc(doc(db, 'ppu_schede_c', 'storico_2'), {
      comunitaId: 'itaca', minorId: 'minore-1', createdBy: UIDS.coordItaca,
      createdAt: '2026-06-10T09:00:00.000Z', status: 'bozza',
    });
  });
}

beforeEach(async () => {
  await env.clearFirestore();
  await seedIdentitiesAndSchede();
});

const asUid  = (uid) => env.authenticatedContext(uid).firestore();
const cItaca = (db) => doc(db, 'ppu_schede_c', 'ppu_schede_c_itaca');
const cForta = (db) => doc(db, 'ppu_schede_c', 'ppu_schede_c_forta');

describe('ppu_schede_c — lettura per scope', () => {
  test('staff senza ruolo coord e senza accessoDocumenti NON legge', async () => {
    await assertFails(getDoc(cItaca(asUid(UIDS.staffPlain))));
  });
  test('coordinatrice di Itaca legge Itaca ma NON Fortapasc', async () => {
    await assertSucceeds(getDoc(cItaca(asUid(UIDS.coordItaca))));
    await assertFails(getDoc(cForta(asUid(UIDS.coordItaca))));
  });
  test('staff con accessoDocumenti (Itaca) legge Itaca ma NON Fortapasc', async () => {
    await assertSucceeds(getDoc(cItaca(asUid(UIDS.staffDocsItaca))));
    await assertFails(getDoc(cForta(asUid(UIDS.staffDocsItaca))));
  });
  test('admin legge qualsiasi Scheda C', async () => {
    await assertSucceeds(getDoc(cItaca(asUid(UIDS.admin))));
    await assertSucceeds(getDoc(cForta(asUid(UIDS.admin))));
  });
  test('un ragazzo (login PIN, nessun doc staff) NON legge MAI una Scheda C', async () => {
    await assertFails(getDoc(cItaca(asUid(UIDS.ragazzo))));
    await assertFails(getDoc(cForta(asUid(UIDS.ragazzo))));
  });
});

describe('ppu_schede_c — creazione', () => {
  test('coordinatrice di Itaca crea una Scheda C nella propria comunità con createdBy == uid', async () => {
    const db = asUid(UIDS.coordItaca);
    await assertSucceeds(setDoc(doc(db, 'ppu_schede_c', 'nuova_ok'), {
      comunitaId: 'itaca', minorId: 'minore-1', createdBy: UIDS.coordItaca,
      createdAt: CREATED_AT, status: 'bozza',
    }));
  });
  test('createdBy diverso dall’utente autenticato -> DENY', async () => {
    const db = asUid(UIDS.coordItaca);
    await assertFails(setDoc(doc(db, 'ppu_schede_c', 'nuova_ko'), {
      comunitaId: 'itaca', minorId: 'minore-1', createdBy: UIDS.admin,
      createdAt: CREATED_AT, status: 'bozza',
    }));
  });
  test('creazione fuori dal proprio scope di comunità -> DENY', async () => {
    const db = asUid(UIDS.coordItaca);
    await assertFails(setDoc(doc(db, 'ppu_schede_c', 'nuova_forta'), {
      comunitaId: 'fortapasc', minorId: 'minore-2', createdBy: UIDS.coordItaca,
      createdAt: CREATED_AT, status: 'bozza',
    }));
  });
  test('un ragazzo NON può creare una Scheda C', async () => {
    const db = asUid(UIDS.ragazzo);
    await assertFails(setDoc(doc(db, 'ppu_schede_c', 'nuova_ragazzo'), {
      comunitaId: 'itaca', minorId: 'minore-1', createdBy: UIDS.ragazzo,
      createdAt: CREATED_AT, status: 'bozza',
    }));
  });
});

describe('ppu_schede_c — aggiornamento e campi immutabili', () => {
  test('coordinatrice in scope può aggiornare un campo di contenuto', async () => {
    await assertSucceeds(updateDoc(cItaca(asUid(UIDS.coordItaca)), {
      status: 'completata', 'sociogrammi': { vicinanza: { nodes: [], edges: [] }, fatica: { nodes: [], edges: [] } },
    }));
  });
  test('staff senza scope NON può aggiornare', async () => {
    await assertFails(updateDoc(cItaca(asUid(UIDS.staffPlain)), { status: 'completata' }));
  });
  test('NESSUNO può cambiare comunitaId / minorId / createdBy / createdAt', async () => {
    const admin = asUid(UIDS.admin);
    await assertFails(updateDoc(cItaca(admin), { comunitaId: 'fortapasc' }));
    await assertFails(updateDoc(cItaca(admin), { minorId: 'minore-2' }));
    await assertFails(updateDoc(cItaca(admin), { createdBy: UIDS.admin }));
    await assertFails(updateDoc(cItaca(admin), { createdAt: '2020-01-01T00:00:00.000Z' }));
    await assertFails(updateDoc(cItaca(asUid(UIDS.coordItaca)), { comunitaId: 'fortapasc' }));
  });
});

describe('ppu_schede_c — cancellazione', () => {
  test('solo admin può eliminare una Scheda C', async () => {
    await assertFails(deleteDoc(cItaca(asUid(UIDS.coordItaca))));
    await assertSucceeds(deleteDoc(cItaca(asUid(UIDS.admin))));
  });
});

describe('ppu_schede_c — storicizzazione', () => {
  test('più Schede C dello stesso minore coesistono e sono tutte leggibili in scope', async () => {
    const db = asUid(UIDS.coordItaca);
    await assertSucceeds(getDoc(doc(db, 'ppu_schede_c', 'storico_1')));
    await assertSucceeds(getDoc(doc(db, 'ppu_schede_c', 'storico_2')));
  });
  test('creare una nuova Scheda C non richiede né tocca le precedenti', async () => {
    const db = asUid(UIDS.coordItaca);
    await assertSucceeds(setDoc(doc(db, 'ppu_schede_c', 'storico_3'), {
      comunitaId: 'itaca', minorId: 'minore-1', createdBy: UIDS.coordItaca,
      createdAt: '2026-09-01T09:00:00.000Z', status: 'bozza',
    }));
    await assertSucceeds(getDoc(doc(db, 'ppu_schede_c', 'storico_1')));
  });
});

describe('NON regressione — Schede A e B invariate', () => {
  const aItaca = (db) => doc(db, 'ppu_schede_a', 'ppu_schede_a_itaca');
  const aForta = (db) => doc(db, 'ppu_schede_a', 'ppu_schede_a_forta');
  const bItaca = (db) => doc(db, 'ppu_schede_b', 'ppu_schede_b_itaca');
  const bForta = (db) => doc(db, 'ppu_schede_b', 'ppu_schede_b_forta');

  test('Scheda A: coordinatrice Itaca legge Itaca, non Fortapasc; ragazzo mai', async () => {
    await assertSucceeds(getDoc(aItaca(asUid(UIDS.coordItaca))));
    await assertFails(getDoc(aForta(asUid(UIDS.coordItaca))));
    await assertFails(getDoc(aItaca(asUid(UIDS.ragazzo))));
  });
  test('Scheda B: coordinatrice Itaca legge Itaca, non Fortapasc; ragazzo mai', async () => {
    await assertSucceeds(getDoc(bItaca(asUid(UIDS.coordItaca))));
    await assertFails(getDoc(bForta(asUid(UIDS.coordItaca))));
    await assertFails(getDoc(bItaca(asUid(UIDS.ragazzo))));
  });
  test('Scheda A/B: campi storici immutabili anche per admin', async () => {
    await assertFails(updateDoc(aItaca(asUid(UIDS.admin)), { minorId: 'minore-2' }));
    await assertFails(updateDoc(bItaca(asUid(UIDS.admin)), { comunitaId: 'fortapasc' }));
  });
  test('Scheda A/B: delete solo admin', async () => {
    await assertFails(deleteDoc(aItaca(asUid(UIDS.coordItaca))));
    await assertSucceeds(deleteDoc(aItaca(asUid(UIDS.admin))));
    await assertFails(deleteDoc(bItaca(asUid(UIDS.coordItaca))));
    await assertSucceeds(deleteDoc(bItaca(asUid(UIDS.admin))));
  });
});
