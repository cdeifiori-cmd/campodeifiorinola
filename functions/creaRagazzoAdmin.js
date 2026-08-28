/**
 * creaRagazzoAdmin — Cloud Function callable (Milestone E)
 *
 * L'admin della Console crea una NUOVA persona (ragazzo) e la inserisce
 * direttamente in una comunità (ordinaria o After Us). Tutto server-side con
 * Admin SDK: verifica admin, validazione, unicità PIN atomica, creazione
 * account Auth, documenti Firestore, appartenenza iniziale, audit.
 *
 * MODELLO CREDENZIALI:
 *  - Il ragazzo accede SOLO con il PIN -> callable loginRagazzoConPin -> custom token.
 *  - La password Firebase è un segreto interno: generata con crypto sicuro, usata
 *    solo per createUser, MAI restituita al client, MAI salvata in Firestore
 *    (né utenti, né utenti_pin), MAI in audit, MAI loggata.
 *  - NON viene creato utenti_pin_lookup (il vettore di enumerazione pubblica).
 *  - utenti_pin/{uid}.pin resta in chiaro ma admin-only (scelta transitoria per
 *    "mostra/copia/cambia PIN" dalla Console).
 *
 * ATOMICITÀ: Auth e Firestore non condividono una transazione. Strategia:
 *  1) transazione: verifica PIN libero (pin_reservations + utenti_pin + lookup
 *     legacy) e crea pin_reservations/{pin} = { uid, createdAt };
 *  2) admin.auth().createUser({ uid, email, password: random });
 *     se fallisce -> rilascia la reservation (solo se .uid === uid) e termina;
 *  3) batch Firestore: utenti/{uid} + utenti_pin/{uid} + appartenenza aperta +
 *     admin_audit(USER_CREATED); se fallisce -> deleteUser(uid) + rilascia
 *     reservation. Se anche la compensazione fallisce -> errore amministrativo
 *     esplicito che nomina l'orfano (uid), senza dati sensibili.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('crypto');

const REGION = 'europe-west1';
const LEGACY_ADMIN_UID = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';
const PIN_RE = /^\d{4,6}$/;            // formato reale accettato dall'app (4-6 cifre)
const NOME_MAX = 200;
const CAUSALE_MAX = 500;

function slug(s) {
  return String(s || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.').replace(/\.+/g, '.').replace(/^\.|\.$/g, '')
    .slice(0, 40) || 'ragazzo';
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

exports.creaRagazzoAdmin = onCall({ region: REGION }, async (request) => {
  const db = getFirestore();
  const auth = getAuth();

  const actorUid = await assertAdmin(db, request.auth);

  // ── Validazione input ────────────────────────────────────────────────────
  const nome = String(request.data && request.data.nome || '').trim();
  const comunitaId = String(request.data && request.data.comunitaId || '').trim();
  const pin = String(request.data && request.data.pin || '').trim();
  const causale = String(request.data && request.data.causale || '').trim();

  if (!nome) throw new HttpsError('invalid-argument', 'Il nome è obbligatorio.');
  if (nome.length > NOME_MAX) throw new HttpsError('invalid-argument', 'Nome troppo lungo.');
  if (!comunitaId) throw new HttpsError('invalid-argument', 'La comunità è obbligatoria.');
  if (!PIN_RE.test(pin)) throw new HttpsError('invalid-argument', 'PIN non valido: 4-6 cifre.');
  if (!causale) throw new HttpsError('invalid-argument', 'La causale è obbligatoria.');
  if (causale.length > CAUSALE_MAX) throw new HttpsError('invalid-argument', 'Causale troppo lunga.');

  const comSnap = await db.collection('comunita').doc(comunitaId).get();
  if (!comSnap.exists) {
    throw new HttpsError('failed-precondition',
      `La comunità "${comunitaId}" non esiste nella collezione canonica "comunita".`);
  }

  // ── UID e credenziali generati server-side ───────────────────────────────
  const uid = 'r_' + crypto.randomBytes(14).toString('hex');           // 30 char, valido come Auth UID
  const email = `${slug(nome)}.${uid.slice(-10)}.ragazzo@campodeifiori.org`;
  const password = crypto.randomBytes(32).toString('base64url');       // segreto interno, mai persistito

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
        throw new HttpsError('already-exists', 'Questo PIN è già in uso. Sceglierne un altro.');
      }
      tx.set(pinRef, { uid, createdAt: FieldValue.serverTimestamp() });
    });
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('aborted', 'Impossibile riservare il PIN, riprova.');
  }

  // ── (2) Account Auth ───────────────────────────────────────────────────
  try {
    await auth.createUser({ uid, email, password, displayName: nome, disabled: false });
  } catch (e) {
    await releaseReservation(db, pin, uid);   // rollback reservation (ownership-checked)
    throw new HttpsError('internal', 'Creazione account non riuscita.');
  }

  // ── (3) Firestore: utenti + utenti_pin + appartenenza + audit ───────────
  try {
    // FAULT INJECTION SOLO PER TEST — PROD-INERTE: viene onorata unicamente su
    // un progetto emulatore ("demo-*"); in produzione GCLOUD_PROJECT è
    // "campo-dei-fiori" e il flag è ignorato. Serve a testare la compensazione
    // (Auth creato -> lo step Firestore fallisce -> deleteUser + release
    // reservation). Nessun percorso di produzione lo raggiunge.
    if (request.data && request.data.__testFailAfterAuth === true
        && /^demo-/.test(process.env.GCLOUD_PROJECT || '')) {
      throw new Error('injected: firestore step failed (test only, demo project)');
    }

    const batch = db.batch();
    batch.set(db.collection('utenti').doc(uid), {
      nome, comunitaId, email, admin: false, stato: 'attivo',
      fotoProfilo: '', createdAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('utenti_pin').doc(uid), {
      uid, nome, pin, comunitaId,
      createdAt: FieldValue.serverTimestamp(), lastLogin: null,
    }); // NB: nessuna password, nessun utenti_pin_lookup
    batch.set(db.collection('utenti').doc(uid).collection('appartenenze').doc(), {
      comunitaId,
      dal: FieldValue.serverTimestamp(),
      al: null,
      causale,
      actorUid,
      createdAt: FieldValue.serverTimestamp(),
    }); // appartenenza APERTA, nessun legacyBaseline
    batch.set(db.collection('admin_audit').doc(), {
      ts: FieldValue.serverTimestamp(),
      actorUid,
      action: 'USER_CREATED',
      targetType: 'utente',
      targetId: uid,
      before: {},
      after: { comunitaId, stato: 'attivo' },
    }); // NB: nessun pin, nessuna password
    await batch.commit();
  } catch (e) {
    // Compensazione: elimina l'account Auth e rilascia la reservation.
    const problems = [];
    try { await auth.deleteUser(uid); } catch (_) { problems.push('auth'); }
    try { await releaseReservation(db, pin, uid); } catch (_) { problems.push('reservation'); }
    if (problems.length) {
      throw new HttpsError('internal',
        `Creazione fallita e compensazione incompleta (residui: ${problems.join(', ')}). ` +
        `Serve pulizia manuale dell'oggetto uid=${uid}.`);
    }
    throw new HttpsError('internal', 'Creazione non riuscita. Nessuna modifica applicata.');
  }

  // Non si restituisce né la password né il PIN (il client lo possiede già).
  return { uid, comunitaId, stato: 'attivo' };
});

async function releaseReservation(db, pin, uid) {
  const ref = db.collection('pin_reservations').doc(pin);
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists && s.data() && s.data().uid === uid) tx.delete(ref); // solo se è NOSTRA
  });
}
