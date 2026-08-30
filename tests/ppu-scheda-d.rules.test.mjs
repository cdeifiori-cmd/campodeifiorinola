// tests/ppu-scheda-d.rules.test.mjs
// Regole Firestore della Scheda D PPU (collezioni ppu_schede_d e
// ppu_schede_d_locks) + verifica di NON regressione sulle Schede A/B/C.
//
//   npm run test:rules
// (avvia l'emulatore Firestore via `firebase emulators:exec` e poi
//  `node --test` su questo file insieme a ppu-scheda-c.rules.test.mjs).
//
// Principio verificato:
//   - la D non è MAI creabile dal client (allow create: if false);
//   - contenutoAI + fonti + metadati della Function sono IMMUTABILI dal client
//     (l'update accetta solo stato/rilettura/validatedAt/validatedBy/updatedAt);
//   - transizioni di stato: GENERATA→{GENERATA,IN_RILETTURA,VALIDATA},
//     IN_RILETTURA→{IN_RILETTURA,VALIDATA}; VALIDATA è congelata;
//   - chi valida è l'utente corrente (validatedBy == auth.uid, validatedAt set);
//   - i lock non sono accessibili dal client in nessun modo.

import { test, before, after, beforeEach, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

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

// Documento D "come lo scrive la Cloud Function"
function schedaD(over = {}) {
  return {
    minorId: 'minore-1', comunitaId: 'itaca', createdBy: UIDS.coordItaca,
    stato: 'GENERATA',
    generatedAt: serverTimestamp(),
    ppuMoment: 'ingresso', ppuMomentNote: '',
    sourceAId: 'a1', sourceBId: 'b1', sourceCId: 'c1',
    fonti: { a: { schedaId: 'a1' }, b: { schedaId: 'b1' }, c: { schedaId: 'c1' } },
    modelloAI: 'claude-test', promptVersion: 1,
    contenutoAI: { sintesiGenerale: 's', pilastri: [], letturaTrasversale: {} },
    notaMetodologica: 'nota metodologica fissa',
    tentativiGenerazione: 1,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    validatedAt: null, validatedBy: null,
    rilettura: null,
    ...over,
  };
}

function riletturaOk(by = UIDS.coordItaca) {
  return {
    ipotesi: { 'pilastro.self.letturaEducativaPossibile': { valutazione: 'conferma', osservazioni: 'ok' } },
    osservazioniGenerali: 'nessuna integrazione',
    riletturaBy: [by],
    riletturaAt: serverTimestamp(),
  };
}

async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staff', UIDS.coordItaca),     { nome: 'Coord Itaca', ruolo: 'coordinatrice', comunitaId: 'itaca' });
    await setDoc(doc(db, 'staff', UIDS.coordForta),     { nome: 'Coord Forta', ruolo: 'responsabile',  comunitaId: 'fortapasc' });
    await setDoc(doc(db, 'staff', UIDS.staffDocsItaca), { nome: 'Educ Itaca',  ruolo: 'educatore',     comunitaId: 'itaca', accessoDocumenti: true });
    await setDoc(doc(db, 'staff', UIDS.staffPlain),     { nome: 'Educ Plain',  ruolo: 'educatore',     comunitaId: 'itaca' });

    await setDoc(doc(db, 'ppu_schede_d', 'd_gen'), schedaD());
    await setDoc(doc(db, 'ppu_schede_d', 'd_ril'), schedaD({ stato: 'IN_RILETTURA', rilettura: riletturaOk() }));
    await setDoc(doc(db, 'ppu_schede_d', 'd_val'), schedaD({
      stato: 'VALIDATA', validatedBy: UIDS.coordItaca, validatedAt: serverTimestamp(), rilettura: riletturaOk(),
    }));
    await setDoc(doc(db, 'ppu_schede_d', 'd_forta'), schedaD({
      comunitaId: 'fortapasc', minorId: 'minore-2', createdBy: UIDS.coordForta,
    }));

    await setDoc(doc(db, 'ppu_schede_d_locks', 'lock_1'), { startedAt: serverTimestamp(), by: UIDS.coordItaca });

    // per la non regressione A/B/C
    for (const coll of ['ppu_schede_a', 'ppu_schede_b', 'ppu_schede_c']) {
      await setDoc(doc(db, coll, `${coll}_itaca`), {
        comunitaId: 'itaca', minorId: 'minore-1', createdBy: UIDS.coordItaca,
        createdAt: '2026-05-01T09:00:00.000Z', status: 'bozza',
      });
      await setDoc(doc(db, coll, `${coll}_forta`), {
        comunitaId: 'fortapasc', minorId: 'minore-2', createdBy: UIDS.coordForta,
        createdAt: '2026-05-01T09:00:00.000Z', status: 'bozza',
      });
    }
  });
}

beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

const asUid = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const dGen = (db) => doc(db, 'ppu_schede_d', 'd_gen');
const dRil = (db) => doc(db, 'ppu_schede_d', 'd_ril');
const dVal = (db) => doc(db, 'ppu_schede_d', 'd_val');
const dForta = (db) => doc(db, 'ppu_schede_d', 'd_forta');
const lockRef = (db) => doc(db, 'ppu_schede_d_locks', 'lock_1');

// ════════════════════════════════════════════════════════════════════
//  READ
// ════════════════════════════════════════════════════════════════════
describe('ppu_schede_d — lettura per scope', () => {
  test('admin legge qualsiasi D', async () => {
    await assertSucceeds(getDoc(dGen(asUid(UIDS.admin))));
    await assertSucceeds(getDoc(dForta(asUid(UIDS.admin))));
  });
  test('coordinatrice di Itaca legge Itaca ma NON Fortapasc', async () => {
    await assertSucceeds(getDoc(dGen(asUid(UIDS.coordItaca))));
    await assertFails(getDoc(dForta(asUid(UIDS.coordItaca))));
  });
  test('staff con accessoDocumenti (Itaca) legge Itaca ma NON Fortapasc', async () => {
    await assertSucceeds(getDoc(dGen(asUid(UIDS.staffDocsItaca))));
    await assertFails(getDoc(dForta(asUid(UIDS.staffDocsItaca))));
  });
  test('staff senza ruolo coord e senza accessoDocumenti NON legge', async () => {
    await assertFails(getDoc(dGen(asUid(UIDS.staffPlain))));
  });
  test('un ragazzo (nessun doc staff) NON legge MAI', async () => {
    await assertFails(getDoc(dGen(asUid(UIDS.ragazzo))));
  });
  test('non autenticato NON legge', async () => {
    await assertFails(getDoc(dGen(anon())));
  });
});

// ════════════════════════════════════════════════════════════════════
//  CREATE — mai dal client
// ════════════════════════════════════════════════════════════════════
describe('ppu_schede_d — creazione vietata al client', () => {
  test('admin NON può creare una D', async () => {
    await assertFails(setDoc(doc(asUid(UIDS.admin), 'ppu_schede_d', 'nuova_admin'), schedaD()));
  });
  test('coordinatrice NON può creare una D', async () => {
    await assertFails(setDoc(doc(asUid(UIDS.coordItaca), 'ppu_schede_d', 'nuova_coord'), schedaD()));
  });
  test('un ragazzo NON può creare una D', async () => {
    await assertFails(setDoc(doc(asUid(UIDS.ragazzo), 'ppu_schede_d', 'nuova_ragazzo'), schedaD()));
  });
});

// ════════════════════════════════════════════════════════════════════
//  UPDATE — immutabilità del contenuto della Function
// ════════════════════════════════════════════════════════════════════
describe('ppu_schede_d — campi immutabili (D GENERATA)', () => {
  const IMMUTABILI = [
    ['minorId', 'minore-2'],
    ['comunitaId', 'fortapasc'],
    ['createdBy', UIDS.admin],
    ['generatedAt', serverTimestamp()],
    ['ppuMoment', 'uscita'],
    ['ppuMomentNote', 'alterato'],
    ['sourceAId', 'zzz'],
    ['sourceBId', 'zzz'],
    ['sourceCId', 'zzz'],
    ['fonti', { a: null, b: null, c: null }],
    ['modelloAI', 'altro-modello'],
    ['promptVersion', 2],
    ['contenutoAI', { hacked: true }],
    ['notaMetodologica', 'testo alterato'],
    ['tentativiGenerazione', 9],
    ['createdAt', serverTimestamp()],
  ];
  for (const [campo, val] of IMMUTABILI) {
    test(`update NON può cambiare "${campo}"`, async () => {
      await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), { [campo]: val }));
    });
  }
  test('update misto (stato lecito + campo immutabile) → deny', async () => {
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      stato: 'IN_RILETTURA', contenutoAI: { hacked: true },
    }));
  });
  test('staff senza scope NON può aggiornare', async () => {
    await assertFails(updateDoc(dGen(asUid(UIDS.staffPlain)), { stato: 'IN_RILETTURA', updatedAt: serverTimestamp() }));
  });
});

// ════════════════════════════════════════════════════════════════════
//  UPDATE — transizioni di stato
// ════════════════════════════════════════════════════════════════════
describe('ppu_schede_d — transizioni di stato', () => {
  test('GENERATA → IN_RILETTURA consentito', async () => {
    await assertSucceeds(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      stato: 'IN_RILETTURA', rilettura: riletturaOk(), updatedAt: serverTimestamp(),
    }));
  });
  test('GENERATA → VALIDATA consentito (con validatore coerente)', async () => {
    await assertSucceeds(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      stato: 'VALIDATA', validatedBy: UIDS.coordItaca, validatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
  test('GENERATA → GENERATA consentito (salvataggio rilettura senza cambio stato)', async () => {
    await assertSucceeds(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      rilettura: riletturaOk(), updatedAt: serverTimestamp(),
    }));
  });
  test('IN_RILETTURA → VALIDATA consentito', async () => {
    await assertSucceeds(updateDoc(dRil(asUid(UIDS.coordItaca)), {
      stato: 'VALIDATA', validatedBy: UIDS.coordItaca, validatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
  test('IN_RILETTURA → GENERATA negato', async () => {
    await assertFails(updateDoc(dRil(asUid(UIDS.coordItaca)), { stato: 'GENERATA', updatedAt: serverTimestamp() }));
  });
  test('stato arbitrario negato', async () => {
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), { stato: 'QUALCOSA', updatedAt: serverTimestamp() }));
  });
  test('stato NON_GENERABILE negato', async () => {
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), { stato: 'NON_GENERABILE', updatedAt: serverTimestamp() }));
  });
  test('stato DA_GENERARE negato', async () => {
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), { stato: 'DA_GENERARE', updatedAt: serverTimestamp() }));
  });
});

// ════════════════════════════════════════════════════════════════════
//  UPDATE — identità del validatore
// ════════════════════════════════════════════════════════════════════
describe('ppu_schede_d — validazione e identità', () => {
  test('VALIDATA richiede validatedBy == auth.uid', async () => {
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      stato: 'VALIDATA', validatedBy: UIDS.admin, validatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
  test('VALIDATA richiede validatedAt valorizzato', async () => {
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      stato: 'VALIDATA', validatedBy: UIDS.coordItaca, updatedAt: serverTimestamp(),
    }));
  });
  test('transizione non-VALIDATA con validatedBy valorizzato → deny', async () => {
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      stato: 'IN_RILETTURA', validatedBy: UIDS.coordItaca, updatedAt: serverTimestamp(),
    }));
  });
  test('transizione non-VALIDATA con validatedAt valorizzato → deny', async () => {
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      stato: 'IN_RILETTURA', validatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
  });
});

// ════════════════════════════════════════════════════════════════════
//  UPDATE — blocco rilettura
// ════════════════════════════════════════════════════════════════════
describe('ppu_schede_d — blocco rilettura', () => {
  test('rilettura con l\'utente corrente in riletturaBy → consentita', async () => {
    await assertSucceeds(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      rilettura: riletturaOk(UIDS.coordItaca), updatedAt: serverTimestamp(),
    }));
  });
  test('rilettura SENZA l\'utente corrente in riletturaBy → deny', async () => {
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      rilettura: riletturaOk(UIDS.admin), updatedAt: serverTimestamp(),
    }));
  });
  test('rilettura con riletturaBy non-lista → deny', async () => {
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      rilettura: { ...riletturaOk(), riletturaBy: UIDS.coordItaca }, updatedAt: serverTimestamp(),
    }));
  });
  test('rilettura senza riletturaAt (timestamp) → deny', async () => {
    const r = riletturaOk();
    delete r.riletturaAt;
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), { rilettura: r, updatedAt: serverTimestamp() }));
  });
  test('rilettura riportata a null → deny (una volta scritta deve restare oggetto)', async () => {
    await assertFails(updateDoc(dRil(asUid(UIDS.coordItaca)), { rilettura: null, updatedAt: serverTimestamp() }));
  });
  test('LIMITE NOTO: valore di "valutazione" arbitrario è ACCETTATO dalle Rules (validato lato app)', async () => {
    await assertSucceeds(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      rilettura: {
        ...riletturaOk(),
        ipotesi: { k: { valutazione: 'valore_inventato', osservazioni: '' } },
      },
      updatedAt: serverTimestamp(),
    }));
  });
});

// ════════════════════════════════════════════════════════════════════
//  IMMUTABILITÀ DOPO VALIDAZIONE
// ════════════════════════════════════════════════════════════════════
describe('ppu_schede_d — D VALIDATA congelata', () => {
  test('nessun update su una D VALIDATA (rilettura)', async () => {
    await assertFails(updateDoc(dVal(asUid(UIDS.coordItaca)), { rilettura: riletturaOk(), updatedAt: serverTimestamp() }));
  });
  test('non si può togliere la validazione', async () => {
    await assertFails(updateDoc(dVal(asUid(UIDS.coordItaca)), { stato: 'IN_RILETTURA', validatedAt: null, validatedBy: null }));
  });
  test('non si può sostituire validatedBy', async () => {
    await assertFails(updateDoc(dVal(asUid(UIDS.admin)), { validatedBy: UIDS.admin }));
  });
  test('non si può toccare updatedAt', async () => {
    await assertFails(updateDoc(dVal(asUid(UIDS.coordItaca)), { updatedAt: serverTimestamp() }));
  });
});

// ════════════════════════════════════════════════════════════════════
//  DELETE
// ════════════════════════════════════════════════════════════════════
describe('ppu_schede_d — cancellazione', () => {
  test('coordinatrice NON può cancellare una D', async () => {
    await assertFails(deleteDoc(dGen(asUid(UIDS.coordItaca))));
  });
  test('admin può cancellare una D NON validata (GENERATA / IN_RILETTURA)', async () => {
    await assertSucceeds(deleteDoc(dGen(asUid(UIDS.admin))));
    await assertSucceeds(deleteDoc(dRil(asUid(UIDS.admin))));
  });
  test('nemmeno l\'admin può cancellare una D VALIDATA', async () => {
    await assertFails(deleteDoc(dVal(asUid(UIDS.admin))));
  });
  test('un ragazzo NON può cancellare una D', async () => {
    await assertFails(deleteDoc(dGen(asUid(UIDS.ragazzo))));
  });
});

// ════════════════════════════════════════════════════════════════════
//  LOCK
// ════════════════════════════════════════════════════════════════════
describe('ppu_schede_d_locks — nessun accesso client', () => {
  test('admin non legge un lock', async () => {
    await assertFails(getDoc(lockRef(asUid(UIDS.admin))));
  });
  test('coordinatrice non legge un lock', async () => {
    await assertFails(getDoc(lockRef(asUid(UIDS.coordItaca))));
  });
  test('non autenticato non legge un lock', async () => {
    await assertFails(getDoc(lockRef(anon())));
  });
  test('nessun client scrive/aggiorna/cancella un lock', async () => {
    await assertFails(setDoc(doc(asUid(UIDS.admin), 'ppu_schede_d_locks', 'nuovo'), { x: 1 }));
    await assertFails(updateDoc(lockRef(asUid(UIDS.admin)), { by: UIDS.admin }));
    await assertFails(deleteDoc(lockRef(asUid(UIDS.admin))));
    await assertFails(deleteDoc(lockRef(asUid(UIDS.coordItaca))));
  });
});

// ════════════════════════════════════════════════════════════════════
//  NON REGRESSIONE — Schede A/B/C invariate
// ════════════════════════════════════════════════════════════════════
describe('NON regressione — Schede A/B/C', () => {
  for (const coll of ['ppu_schede_a', 'ppu_schede_b', 'ppu_schede_c']) {
    test(`${coll}: coordinatrice Itaca legge Itaca, non Fortapasc; ragazzo mai`, async () => {
      await assertSucceeds(getDoc(doc(asUid(UIDS.coordItaca), coll, `${coll}_itaca`)));
      await assertFails(getDoc(doc(asUid(UIDS.coordItaca), coll, `${coll}_forta`)));
      await assertFails(getDoc(doc(asUid(UIDS.ragazzo), coll, `${coll}_itaca`)));
    });
    test(`${coll}: creazione in scope con createdBy == uid; delete solo admin`, async () => {
      await assertSucceeds(setDoc(doc(asUid(UIDS.coordItaca), coll, `${coll}_new`), {
        comunitaId: 'itaca', minorId: 'minore-1', createdBy: UIDS.coordItaca,
        createdAt: '2026-07-01T09:00:00.000Z', status: 'bozza',
      }));
      await assertFails(deleteDoc(doc(asUid(UIDS.coordItaca), coll, `${coll}_itaca`)));
      await assertSucceeds(deleteDoc(doc(asUid(UIDS.admin), coll, `${coll}_itaca`)));
    });
  }
});

// ════════════════════════════════════════════════════════════════════
//  PASSO 5 — compatibilità delle scritture prodotte dalla UI di rilettura
//  (le Rules del Passo 3 non sono state modificate)
// ════════════════════════════════════════════════════════════════════
describe('ppu_schede_d — scritture della UI di rilettura (Passo 5)', () => {
  // forma prodotta da costruisciRiletturaDaValori + riletturaAt serverTimestamp
  const riletturaUI = (by = UIDS.coordItaca) => ({
    ipotesi: {
      'pilastro.self.letturaEducativaPossibile': { valutazione: 'conferma' },
      'pilastro.self.aspettoDaApprofondire': { osservazioni: 'osservato in mensa' },
      'trasversale.risorse.0': { valutazione: 'integra', osservazioni: 'da precisare' },
    },
    osservazioniGenerali: 'Confronto d’équipe del 20/09.',
    riletturaBy: [by],
    riletturaAt: serverTimestamp(),
  });

  test('salvataggio rilettura multi-ipotesi: GENERATA → IN_RILETTURA', async () => {
    await assertSucceeds(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      stato: 'IN_RILETTURA', rilettura: riletturaUI(), updatedAt: serverTimestamp(),
    }));
  });

  test('salvataggio senza cambio stato: IN_RILETTURA resta IN_RILETTURA', async () => {
    await assertSucceeds(updateDoc(dRil(asUid(UIDS.coordItaca)), {
      rilettura: riletturaUI(), updatedAt: serverTimestamp(),
    }));
  });

  test('secondo operatore: riletturaBy accumula gli UID, incluso il proprio', async () => {
    await assertSucceeds(updateDoc(dRil(asUid(UIDS.staffDocsItaca)), {
      rilettura: { ...riletturaUI(), riletturaBy: [UIDS.coordItaca, UIDS.staffDocsItaca] },
      updatedAt: serverTimestamp(),
    }));
  });

  test('secondo operatore che NON si include in riletturaBy → deny', async () => {
    await assertFails(updateDoc(dRil(asUid(UIDS.staffDocsItaca)), {
      rilettura: { ...riletturaUI(), riletturaBy: [UIDS.coordItaca] },
      updatedAt: serverTimestamp(),
    }));
  });

  test('validazione da IN_RILETTURA preservando la rilettura', async () => {
    await assertSucceeds(updateDoc(dRil(asUid(UIDS.coordItaca)), {
      stato: 'VALIDATA',
      validatedBy: UIDS.coordItaca,
      validatedAt: serverTimestamp(),
      rilettura: riletturaUI(),
      updatedAt: serverTimestamp(),
    }));
  });

  test('validazione diretta da GENERATA senza rilettura (rilettura resta null)', async () => {
    await assertSucceeds(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      stato: 'VALIDATA',
      validatedBy: UIDS.coordItaca,
      validatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  test('la scrittura di rilettura non può toccare contenutoAI/fonti/source*', async () => {
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      rilettura: riletturaUI(), contenutoAI: { hacked: true }, updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(dGen(asUid(UIDS.coordItaca)), {
      rilettura: riletturaUI(), sourceAId: 'x', updatedAt: serverTimestamp(),
    }));
  });
});
