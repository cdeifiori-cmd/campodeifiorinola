// test/rules/documenti-ppu.test.mjs
// Verifica che le regole ESISTENTI di ppu_schede_a / ppu_schede_b restino
// coerenti dopo il nuovo isAdmin() (decisione §8) e che:
//   - staff senza scope NON accede (§12.8)
//   - staff coord/responsabile o accessoDocumenti accede SOLO nella propria comunità (§12.9/§12.10)
//   - admin (legacy E nuovo modello staff.admin) accede a tutto (§12.11)
//   - un ragazzo NON accede mai a una scheda PPU
//   - i campi storici comunitaId/minorId/createdBy/createdAt restano immutabili (§12.13)
//
// NB: le regole ppu_schede_* NON vengono modificate in Milestone A: qui si
// testano così come sono, per garantire nessuna regressione.

import { test, before, after, beforeEach, describe } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { getTestEnv, seedIdentities, seedTriState, UIDS } from './helpers.mjs';

let env;
before(async () => { env = await getTestEnv('documenti-ppu'); });
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedIdentities(env); await seedTriState(env); });

const SCHEDA_ITACA = 'scheda_itaca_a';
const SCHEDA_FORTAPASC = 'scheda_fortapasc_a';
const CREATED_AT = '2026-05-01T09:00:00.000Z';

async function seedSchede(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const { setDoc, doc } = await import('firebase/firestore');
    const db = ctx.firestore();
    await setDoc(doc(db, 'ppu_schede_a', SCHEDA_ITACA), {
      comunitaId: 'itaca', minorId: UIDS.ragazzo2, createdBy: UIDS.staffCoord,
      createdAt: CREATED_AT, stato: 'bozza', momento: 'ingresso',
    });
    await setDoc(doc(db, 'ppu_schede_a', SCHEDA_FORTAPASC), {
      comunitaId: 'fortapasc', minorId: UIDS.ragazzo, createdBy: UIDS.staffCoord,
      createdAt: CREATED_AT, stato: 'bozza', momento: 'ingresso',
    });
  });
}
beforeEach(async () => { await seedSchede(env); });

const rItaca = (db) => doc(db, 'ppu_schede_a', SCHEDA_ITACA);
const rForta = (db) => doc(db, 'ppu_schede_a', SCHEDA_FORTAPASC);

describe('ppu_schede_a — lettura per scope', () => {
  test('§12.8 — staff senza ruolo coord e senza accessoDocumenti NON legge', async () => {
    const db = env.authenticatedContext(UIDS.staffPlain).firestore();
    await assertFails(getDoc(rItaca(db)));
  });

  test('§12.9 — coordinatrice di Itaca legge la scheda di Itaca ma NON quella di Fortapasc', async () => {
    const db = env.authenticatedContext(UIDS.staffCoord).firestore();
    await assertSucceeds(getDoc(rItaca(db)));
    await assertFails(getDoc(rForta(db)));
  });

  test('§12.10 — staff con accessoDocumenti (comunità Itaca) legge Itaca ma NON Fortapasc', async () => {
    const db = env.authenticatedContext(UIDS.staffDocs).firestore();
    await assertSucceeds(getDoc(rItaca(db)));
    await assertFails(getDoc(rForta(db)));
  });

  test('§12.11 — legacy admin legge qualsiasi scheda', async () => {
    const db = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertSucceeds(getDoc(rItaca(db)));
    await assertSucceeds(getDoc(rForta(db)));
  });

  test('§12.11bis — admin "nuovo modello" (staff.admin===true) legge qualsiasi scheda', async () => {
    const db = env.authenticatedContext(UIDS.staffAdmin).firestore();
    await assertSucceeds(getDoc(rItaca(db)));
    await assertSucceeds(getDoc(rForta(db)));
  });

  test('un ragazzo (PIN) NON legge MAI una scheda PPU', async () => {
    const db = env.authenticatedContext(UIDS.ragazzo).firestore();
    await assertFails(getDoc(rForta(db)));
    await assertFails(getDoc(rItaca(db)));
  });
});

describe('ppu_schede_a — TRI-STATE (Milestone C §11) su lettura scheda Itaca', () => {
  const read = (uid) => getDoc(rItaca(env.authenticatedContext(uid).firestore()));

  test('coordinatore SENZA campo accessoDocumenti -> ALLOW (legacy)', async () => {
    await assertSucceeds(read(UIDS.staffCoord));
  });
  test('coordinatore con accessoDocumenti === true -> ALLOW', async () => {
    await assertSucceeds(read(UIDS.coordTrue));
  });
  test('coordinatore con accessoDocumenti === false -> DENY (il false prevale sul ruolo)', async () => {
    await assertFails(read(UIDS.coordFalse));
  });
  test('educatore SENZA campo -> DENY', async () => {
    await assertFails(read(UIDS.staffPlain));
  });
  test('educatore con accessoDocumenti === true -> ALLOW', async () => {
    await assertSucceeds(read(UIDS.staffDocs));
  });
  test('educatore con accessoDocumenti === false -> DENY', async () => {
    await assertFails(read(UIDS.eduFalse));
  });
});

describe('ppu_schede_a — SCOPE comunità (§11)', () => {
  const readItaca = (uid) => getDoc(rItaca(env.authenticatedContext(uid).firestore()));
  const readForta = (uid) => getDoc(rForta(env.authenticatedContext(uid).firestore()));

  test('staff Itaca (true) -> Itaca ALLOW, Fortapasc DENY', async () => {
    await assertSucceeds(readItaca(UIDS.staffDocs));
    await assertFails(readForta(UIDS.staffDocs));
  });
  test('staff comunitaId array [Itaca, Fortapasc] (true) -> entrambe ALLOW', async () => {
    await assertSucceeds(readItaca(UIDS.multiTrue));
    await assertSucceeds(readForta(UIDS.multiTrue));
  });
  test('staff con accessoDocumenti true ma comunitaId ASSENTE -> DENY su entrambe', async () => {
    await assertFails(readItaca(UIDS.noComunita));
    await assertFails(readForta(UIDS.noComunita));
  });
});

describe('ppu_schede_a — TRI-STATE su create/update', () => {
  test('coordinatore con false NON può creare una scheda nella propria comunità', async () => {
    const db = env.authenticatedContext(UIDS.coordFalse).firestore();
    await assertFails(setDoc(doc(db, 'ppu_schede_a', 'nuova_x'), {
      comunitaId: 'itaca', minorId: UIDS.ragazzo2, createdBy: UIDS.coordFalse,
      createdAt: CREATED_AT, stato: 'bozza',
    }));
  });
  test('coordinatore con true PUÒ aggiornare un campo di contenuto in scope', async () => {
    const db = env.authenticatedContext(UIDS.coordTrue).firestore();
    await assertSucceeds(updateDoc(rItaca(db), { stato: 'completata' }));
  });
  test('coordinatore con false NON può aggiornare (nemmeno un campo di contenuto)', async () => {
    const db = env.authenticatedContext(UIDS.coordFalse).firestore();
    await assertFails(updateDoc(rItaca(db), { stato: 'completata' }));
  });
});

describe('ppu_schede_a — PPU storica immutabile (§12.13)', () => {
  test('la coordinatrice di Itaca può aggiornare un campo di contenuto della scheda in scope', async () => {
    const db = env.authenticatedContext(UIDS.staffCoord).firestore();
    await assertSucceeds(updateDoc(rItaca(db), { stato: 'completata' }));
  });

  test('NESSUNO può cambiare comunitaId / minorId / createdBy / createdAt', async () => {
    const adminDb = env.authenticatedContext(UIDS.legacyAdmin).firestore();
    await assertFails(updateDoc(rItaca(adminDb), { comunitaId: 'fortapasc' }));
    await assertFails(updateDoc(rItaca(adminDb), { minorId: UIDS.ragazzo }));
    await assertFails(updateDoc(rItaca(adminDb), { createdBy: UIDS.legacyAdmin }));
    await assertFails(updateDoc(rItaca(adminDb), { createdAt: '2020-01-01T00:00:00.000Z' }));

    const coordDb = env.authenticatedContext(UIDS.staffCoord).firestore();
    await assertFails(updateDoc(rItaca(coordDb), { comunitaId: 'fortapasc' }));
  });
});
