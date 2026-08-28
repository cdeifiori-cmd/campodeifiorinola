// test/rules/transfer.test.mjs
// Milestone D §18 — la TRANSAZIONE di trasferimento contro l'emulatore.
// Replica la sequenza di scritture di js/console/console-transfer.js:transferUtente
// (MANTENERE ALLINEATI). Verifica che le Rules ammettano il trasferimento reale,
// che gli scenari malformati falliscano e che il fallimento sia ATOMICO (rollback).

import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, collection, getDoc, getDocs, query, where, runTransaction, serverTimestamp,
} from 'firebase/firestore';
import { getTestEnv, seedIdentities, UIDS } from './helpers.mjs';

let env;
before(async () => { env = await getTestEnv('transfer'); });
after(async () => { await env.cleanup(); });

const KIDS = {
  legacyA: 'kid_legacy_a',   // comunitaId itaca, nessuno storico
  legacyB: 'kid_legacy_b',
  legacyC: 'kid_legacy_c',
  storico: 'kid_storico',    // comunitaId itaca + 1 appartenenza aperta
  afterUs: 'kid_afterus',    // comunitaId after-us
  conc:    'kid_concorrenza',
};

beforeEach(async () => {
  await env.clearFirestore();
  await seedIdentities(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const { setDoc, doc, Timestamp } = await import('firebase/firestore');
    for (const id of ['itaca', 'fortapasc', 'after-us', 'macrame']) {
      await setDoc(doc(db, 'comunita', id), { nomeComunita: id });
    }
    for (const id of [KIDS.legacyA, KIDS.legacyB, KIDS.legacyC, KIDS.conc]) {
      await setDoc(doc(db, 'utenti', id), { nome: id, comunitaId: 'itaca', stato: 'attivo' });
    }
    await setDoc(doc(db, 'utenti', KIDS.storico), { nome: 'Storico', comunitaId: 'itaca', stato: 'attivo' });
    await setDoc(doc(db, 'utenti', KIDS.afterUs), { nome: 'AfterUs', comunitaId: 'after-us', stato: 'attivo' });
    // appartenenza APERTA per KIDS.storico
    await setDoc(doc(db, 'utenti', KIDS.storico, 'appartenenze', 'ap_open'), {
      comunitaId: 'itaca', dal: Timestamp.fromDate(new Date('2026-02-01')), al: null,
      causale: 'ingresso', actorUid: UIDS.legacyAdmin, createdAt: Timestamp.fromDate(new Date('2026-02-01')),
    });
  });
});

// ── Replica di transferUtente (transazione) ────────────────────────────────
async function doTransfer(db, actorUid, uid, dest, causale = 'trasferimento struttura') {
  const uSnap = await getDoc(doc(db, 'utenti', uid));
  const before = (typeof uSnap.data().comunitaId === 'string' && uSnap.data().comunitaId)
    ? uSnap.data().comunitaId : null;
  const openSnap = await getDocs(query(collection(db, 'utenti', uid, 'appartenenze'), where('al', '==', null)));
  const openRef = openSnap.empty ? null : openSnap.docs[0].ref;
  const newApRef = doc(collection(db, 'utenti', uid, 'appartenenze'));
  const baselineRef = (!openRef && before) ? doc(collection(db, 'utenti', uid, 'appartenenze')) : null;
  const auditRef = doc(collection(db, 'admin_audit'));

  await runTransaction(db, async (tx) => {
    const u = await tx.get(doc(db, 'utenti', uid));
    const cur = (typeof u.data().comunitaId === 'string' && u.data().comunitaId) ? u.data().comunitaId : null;
    if (cur !== before) throw new Error('stato cambiato');
    if (openRef) {
      const o = await tx.get(openRef);
      if (o.data().al !== null) throw new Error('appartenenza aperta cambiata');
      tx.update(openRef, { al: serverTimestamp() });
    } else if (before) {
      tx.set(baselineRef, {
        comunitaId: before, dal: serverTimestamp(), al: serverTimestamp(),
        causale: `baseline legacy — "${before}" prima dello storico (data non nota)`,
        actorUid, createdAt: serverTimestamp(), legacyBaseline: true,
      });
    }
    tx.set(newApRef, {
      comunitaId: dest, dal: serverTimestamp(), al: null, causale, actorUid, createdAt: serverTimestamp(),
    });
    tx.update(doc(db, 'utenti', uid), { comunitaId: dest });
    tx.set(auditRef, {
      ts: serverTimestamp(), actorUid, action: 'USER_COMMUNITY_TRANSFER',
      targetType: 'utente', targetId: uid, before: { comunitaId: before }, after: { comunitaId: dest }, causale,
    });
  });
  return { before, newApId: newApRef.id, baselineId: baselineRef?.id ?? null, closedId: openRef?.id ?? null, auditId: auditRef.id };
}

// helper: legge con regole disattivate
async function read(fn) {
  let out;
  await env.withSecurityRulesDisabled(async (ctx) => { out = await fn(ctx.firestore()); });
  return out;
}
async function comunitaOf(uid) {
  const s = await read((db) => getDoc(doc(db, 'utenti', uid)));
  return s.data().comunitaId;
}
async function openCount(uid) {
  const s = await read((db) => getDocs(query(collection(db, 'utenti', uid, 'appartenenze'), where('al', '==', null))));
  return s.size;
}
async function allAppartenenze(uid) {
  const s = await read((db) => getDocs(collection(db, 'utenti', uid, 'appartenenze')));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}
async function auditCount(action) {
  const s = await read((db) => getDocs(query(collection(db, 'admin_audit'), where('action', '==', action))));
  return s.size;
}

const adminDb = () => env.authenticatedContext(UIDS.legacyAdmin).firestore();

describe('transfer — scenari validi (admin)', () => {
  test('legacy (nessuno storico): Itaca -> Fortapasc', async () => {
    await assertSucceeds(doTransfer(adminDb(), UIDS.legacyAdmin, KIDS.legacyA, 'fortapasc'));
    assert.equal(await comunitaOf(KIDS.legacyA), 'fortapasc');
    assert.equal(await openCount(KIDS.legacyA), 1);
    const recs = await allAppartenenze(KIDS.legacyA);
    const baseline = recs.find((r) => r.legacyBaseline === true);
    const open = recs.find((r) => r.al === null);
    assert.ok(baseline, 'baseline creato');
    assert.equal(baseline.comunitaId, 'itaca');
    assert.ok(baseline.al !== null, 'baseline chiuso alla nascita');
    assert.equal(open.comunitaId, 'fortapasc');
    assert.equal(await auditCount('USER_COMMUNITY_TRANSFER'), 1);
  });

  test('con storico aperto: chiude il precedente + apre il nuovo, 1 solo aperto', async () => {
    await assertSucceeds(doTransfer(adminDb(), UIDS.legacyAdmin, KIDS.storico, 'fortapasc'));
    assert.equal(await comunitaOf(KIDS.storico), 'fortapasc');
    assert.equal(await openCount(KIDS.storico), 1);
    const recs = await allAppartenenze(KIDS.storico);
    const old = recs.find((r) => r.id === 'ap_open');
    assert.ok(old.al !== null, 'appartenenza precedente chiusa');
    assert.ok(!recs.some((r) => r.legacyBaseline), 'nessun baseline (aveva storico)');
  });

  test('Itaca -> After Us', async () => {
    await assertSucceeds(doTransfer(adminDb(), UIDS.legacyAdmin, KIDS.legacyB, 'after-us'));
    assert.equal(await comunitaOf(KIDS.legacyB), 'after-us');
    assert.equal(await openCount(KIDS.legacyB), 1);
  });

  test('After Us -> Itaca', async () => {
    await assertSucceeds(doTransfer(adminDb(), UIDS.legacyAdmin, KIDS.afterUs, 'itaca'));
    assert.equal(await comunitaOf(KIDS.afterUs), 'itaca');
  });

  test('due trasferimenti sequenziali: sempre 1 solo aperto', async () => {
    await doTransfer(adminDb(), UIDS.legacyAdmin, KIDS.storico, 'fortapasc');
    await doTransfer(adminDb(), UIDS.legacyAdmin, KIDS.storico, 'macrame');
    assert.equal(await comunitaOf(KIDS.storico), 'macrame');
    assert.equal(await openCount(KIDS.storico), 1);
  });
});

describe('transfer — negato e ROLLBACK atomico', () => {
  test('staff non-admin: transazione DENY, utenti.comunitaId invariato', async () => {
    const db = env.authenticatedContext(UIDS.staffCoord).firestore();
    await assertFails(doTransfer(db, UIDS.staffCoord, KIDS.legacyC, 'fortapasc'));
    assert.equal(await comunitaOf(KIDS.legacyC), 'itaca');       // rollback
    assert.equal((await allAppartenenze(KIDS.legacyC)).length, 0);
    assert.equal(await auditCount('USER_COMMUNITY_TRANSFER'), 0);
  });

  test('audit con actorUid falsificato: intera transazione respinta, nessuna scrittura', async () => {
    // admin autentica, ma passa actorUid diverso -> audit create rule fallisce
    await assertFails(doTransfer(adminDb(), UIDS.staffCoord /* actorUid ≠ auth */, KIDS.legacyC, 'fortapasc'));
    assert.equal(await comunitaOf(KIDS.legacyC), 'itaca');       // rollback
    assert.equal((await allAppartenenze(KIDS.legacyC)).length, 0);
    assert.equal(await auditCount('USER_COMMUNITY_TRANSFER'), 0);
  });

  test('ragazzo proprietario non può eseguire la transazione', async () => {
    const db = env.authenticatedContext(KIDS.legacyC).firestore();
    await assertFails(doTransfer(db, KIDS.legacyC, KIDS.legacyC, 'fortapasc'));
    assert.equal(await comunitaOf(KIDS.legacyC), 'itaca');
  });
});

describe('transfer — concorrenza (§9)', () => {
  test('due trasferimenti concorrenti sullo stesso ragazzo: uno solo riesce, 1 solo aperto', async () => {
    const results = await Promise.allSettled([
      doTransfer(adminDb(), UIDS.legacyAdmin, KIDS.conc, 'fortapasc'),
      doTransfer(adminDb(), UIDS.legacyAdmin, KIDS.conc, 'macrame'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(ok, 1, 'esattamente un trasferimento riuscito');
    assert.equal(await openCount(KIDS.conc), 1, 'una sola appartenenza aperta');
    assert.ok(['fortapasc', 'macrame'].includes(await comunitaOf(KIDS.conc)));
    assert.equal(await auditCount('USER_COMMUNITY_TRANSFER'), 1);
  });
});
