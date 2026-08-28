/**
 * assegnaPinRagazzoAdmin — Cloud Function callable (Patch: primo PIN per ragazzo esistente)
 *
 * Assegna il PRIMO PIN a un ragazzo GIÀ presente in `utenti/{uid}`, senza creare
 * duplicati e senza toccare il percorso legacy (`js/ragazzi-pin.js` / Identity
 * Toolkit dal browser). Tutto server-side con Admin SDK.
 *
 * NON crea `utenti/{uid}`. NON cambia `comunitaId`. NON tocca le appartenenze.
 * NON scrive `utenti_pin_lookup/{pin}`. NON persiste/logga/restituisce password.
 *
 * MODELLO CREDENZIALI (identico a creaRagazzoAdmin):
 *  - Il ragazzo accede SOLO con il PIN -> callable loginRagazzoConPin -> custom token.
 *  - Se l'account Auth con quell'uid NON esiste, viene creato con una password
 *    casuale server-side, MAI restituita/salvata/loggata. Se ESISTE già, viene
 *    lasciato del tutto invariato (nessun cambio password/email).
 *
 * UNICITÀ PIN: riserva deterministica in `pin_reservations/{pin}`
 *   RESERVED -> ACTIVE (ACTIVE scritto nello stesso batch che crea utenti_pin).
 *
 * COMPENSAZIONE: Auth e Firestore non condividono transazione.
 *  - createUser fallisce            -> rilascia la reservation (ownership-checked).
 *  - batch Firestore fallisce       -> se ABBIAMO creato noi l'account Auth in
 *                                      questa chiamata lo eliminiamo; un account
 *                                      Auth PRE-ESISTENTE non viene MAI toccato.
 *                                      Poi rilascio reservation.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('crypto');

const REGION = 'europe-west1';
const LEGACY_ADMIN_UID = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';
// Formato PIN reale dell'app ragazzi: 4-6 cifre. Vedi CONSOLE-ADMIN-PLAN.md (Patch E.1).
const PIN_RE = /^\d{4,6}$/;
const EMAIL_DOMAIN = 'campodeifiori.org';

// Email sintetica: local-part = SOLO l'uid. Deterministica per quell'account,
// indipendente dal nome e dal PIN, senza collisioni.
function syntheticEmail(uid) {
  return `${uid}.ragazzo@${EMAIL_DOMAIN}`;
}

async function assertAdmin(db, auth) {
  if (!auth || !auth.uid) {
    throw new HttpsError('unauthenticated', 'Autenticazione richiesta.');
  }
  if (auth.uid === LEGACY_ADMIN_UID) return auth.uid;
  const staff = await db.collection('staff').doc(auth.uid).get();
  if (staff.exists && staff.data() && staff.data().admin === true) return auth.uid;
  throw new HttpsError('permission-denied', 'Operazione riservata agli amministratori.');
}

// Rilascia la reservation SOLO se è di questa operazione (uid combacia) e NON
// è ancora ACTIVE.
async function releaseReservation(db, pin, uid) {
  const ref = db.collection('pin_reservations').doc(pin);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || !s.data()) return;
    if (s.data().uid !== uid) return;
    if (s.data().status === 'ACTIVE') return;
    tx.delete(ref);
  });
}

exports.assegnaPinRagazzoAdmin = onCall({ region: REGION }, async (request) => {
  const db = getFirestore();
  const auth = getAuth();

  const actorUid = await assertAdmin(db, request.auth);

  // ── Validazione input ────────────────────────────────────────────────────
  const uid = String(request.data && request.data.uid || '').trim();
  const pin = String(request.data && request.data.pin || '').trim();

  if (!uid) throw new HttpsError('invalid-argument', 'uid obbligatorio.');
  if (!PIN_RE.test(pin)) throw new HttpsError('invalid-argument', 'PIN non valido: 4-6 cifre.');

  // ── Il ragazzo deve esistere, essere non archiviato e non avere già un PIN ─
  const utenteSnap = await db.collection('utenti').doc(uid).get();
  if (!utenteSnap.exists) {
    throw new HttpsError('failed-precondition', `Nessun ragazzo con uid "${uid}" in utenti.`);
  }
  const utente = utenteSnap.data() || {};
  if (utente.stato === 'archiviato') {
    throw new HttpsError('failed-precondition', 'Il ragazzo è archiviato: riattivarlo prima di assegnare un PIN.');
  }
  const pinDocSnap = await db.collection('utenti_pin').doc(uid).get();
  if (pinDocSnap.exists) {
    throw new HttpsError('failed-precondition', 'Questo ragazzo ha già un PIN. Questa funzione assegna solo il PRIMO PIN.');
  }

  const nome = typeof utente.nome === 'string' ? utente.nome : '';
  const comunitaId = typeof utente.comunitaId === 'string' ? utente.comunitaId : null;

  // ── (1) Riserva PIN in transazione ──────────────────────────────────────
  const pinRef = db.collection('pin_reservations').doc(pin);
  try {
    await db.runTransaction(async (tx) => {
      const [resSnap, lookupSnap, pinQ] = await Promise.all([
        tx.get(pinRef),
        tx.get(db.collection('utenti_pin_lookup').doc(pin)),
        tx.get(db.collection('utenti_pin').where('pin', '==', pin).limit(1)),
      ]);
      if (resSnap.exists || lookupSnap.exists || !pinQ.empty) {
        // Nessun valore di PIN nel messaggio d'errore.
        throw new HttpsError('already-exists', 'Questo PIN è già in uso. Sceglierne un altro.');
      }
      tx.set(pinRef, { uid, status: 'RESERVED', createdAt: FieldValue.serverTimestamp() });
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('aborted', 'Impossibile riservare il PIN, riprova.');
  }

  // ── (2) Account Auth: crealo SOLO se manca; se esiste, non toccarlo ─────
  let authCreated = false;
  try {
    await auth.getUser(uid);
    // esiste già: lasciato invariato (nessun cambio password/email)
  } catch (e) {
    if (e && e.code === 'auth/user-not-found') {
      const password = crypto.randomBytes(32).toString('base64url'); // segreto interno, mai persistito
      try {
        await auth.createUser({
          uid, email: syntheticEmail(uid), password,
          displayName: nome || undefined, disabled: false,
        });
        authCreated = true;
      } catch (ce) {
        await releaseReservation(db, pin, uid);
        throw new HttpsError('internal', 'Creazione account non riuscita.');
      }
    } else {
      await releaseReservation(db, pin, uid);
      throw new HttpsError('internal', 'Verifica account non riuscita.');
    }
  }

  // ── (3) Firestore: utenti_pin + audit + reservation -> ACTIVE ──────────
  try {
    // FAULT INJECTION SOLO PER TEST — PROD-INERTE: onorata solo su progetto
    // emulatore ("demo-*"); in produzione GCLOUD_PROJECT è "campo-dei-fiori".
    if (request.data && request.data.__testFailAfterAuth === true
        && /^demo-/.test(process.env.GCLOUD_PROJECT || '')) {
      throw new Error('injected: firestore step failed (test only, demo project)');
    }

    const batch = db.batch();
    batch.set(db.collection('utenti_pin').doc(uid), {
      uid, nome, pin, comunitaId,
      createdAt: FieldValue.serverTimestamp(), lastLogin: null,
    }); // NB: nessuna password, nessun utenti_pin_lookup
    batch.set(db.collection('admin_audit').doc(), {
      ts: FieldValue.serverTimestamp(),
      actorUid,
      action: 'PIN_ASSIGNED',
      targetType: 'utente',
      targetId: uid,
      before: {},
      after: { comunitaId, authCreated },
    }); // NB: nessun pin, nessuna password
    batch.update(pinRef, {
      status: 'ACTIVE',
      activatedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();
  } catch (e) {
    const problems = [];
    // Un account Auth PRE-ESISTENTE non viene MAI eliminato dalla compensazione.
    if (authCreated) {
      try { await auth.deleteUser(uid); } catch (_) { problems.push('auth'); }
    }
    try { await releaseReservation(db, pin, uid); } catch (_) { problems.push('reservation'); }
    if (problems.length) {
      throw new HttpsError('internal',
        `Assegnazione fallita e compensazione incompleta (residui: ${problems.join(', ')}). ` +
        `Serve pulizia manuale dell'oggetto uid=${uid}.`);
    }
    throw new HttpsError('internal', 'Assegnazione non riuscita. Nessuna modifica applicata.');
  }

  // Non si restituisce né la password né il PIN (il client lo possiede già).
  return { uid, comunitaId, authCreated };
});
