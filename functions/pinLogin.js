/**
 * Login PIN ragazzi — Cloud Function callable
 *
 * Sostituisce la risoluzione PIN → credenziali fatta lato client. Il browser
 * invia solo il PIN; questa funzione (Admin SDK, bypassa le regole Firestore)
 * risolve il PIN, applica un rate limit per IP, verifica che il ragazzo sia
 * attivo e restituisce un Firebase Custom Token — mai email/password.
 *
 * Il client scambia il token con signInWithCustomToken(): la sessione che ne
 * risulta è una normale sessione Firebase Auth, identica a qualunque altra.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('crypto');

const REGION = 'europe-west1';

// Rate limit per IP: MAX_ATTEMPTS tentativi (validi o no) ogni WINDOW_MS,
// poi blocco di LOCKOUT_MS. Ogni tentativo consuma budget anche se il PIN
// non esiste, altrimenti l'enumerazione dei "non trovati" resterebbe gratis.
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 10 * 60 * 1000;   // 10 minuti
const LOCKOUT_MS = 15 * 60 * 1000;  // 15 minuti di blocco
const MAX_DELAY_MS = 2000;          // ritardo progressivo, tetto a 2s

// Risposta identica per "PIN inesistente" e "ragazzo archiviato": un
// attaccante non deve poter distinguere le due situazioni (altrimenti un PIN
// che dà quell'errore specifico gli confermerebbe che è appartenuto a un
// account reale).
const MSG_PIN_INVALIDO = 'PIN non valido.';

function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || 'unknown')).digest('hex');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getClientIp(request) {
  const raw = request.rawRequest;
  return raw?.ip
    || raw?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || 'unknown';
}

exports.loginRagazzoConPin = onCall({ region: REGION }, async (request) => {
  const pin = String(request.data?.pin || '').trim();
  if (!/^\d{4,6}$/.test(pin)) {
    throw new HttpsError('invalid-argument', 'Inserisci un PIN valido.');
  }

  const db = getFirestore();
  const auth = getAuth();

  // ── Rate limit per IP ─────────────────────────────────────────────────
  const ip = getClientIp(request);
  const rateRef = db.collection('pin_login_rate').doc(hashIp(ip));
  const now = Date.now();
  const rateSnap = await rateRef.get();
  const rate = rateSnap.exists ? rateSnap.data() : null;

  if (rate?.lockedUntil && rate.lockedUntil > now) {
    throw new HttpsError('resource-exhausted', 'Troppi tentativi. Riprova tra qualche minuto.');
  }

  let count = 1;
  let windowStart = now;
  if (rate?.windowStart && (now - rate.windowStart) < WINDOW_MS) {
    count = (rate.count || 0) + 1;
    windowStart = rate.windowStart;
  }

  if (count > MAX_ATTEMPTS) {
    await rateRef.set({
      count, windowStart, lockedUntil: now + LOCKOUT_MS,
      lastAttemptAt: FieldValue.serverTimestamp()
    }, { merge: true });
    throw new HttpsError('resource-exhausted', 'Troppi tentativi. Riprova tra qualche minuto.');
  }

  await rateRef.set({
    count, windowStart, lockedUntil: null,
    lastAttemptAt: FieldValue.serverTimestamp()
  }, { merge: true });

  // Ritardo progressivo: rallenta i tentativi rapidi senza penalizzare un
  // singolo login legittimo (il primo tentativo non aspetta).
  const delay = Math.min((count - 1) * 250, MAX_DELAY_MS);
  if (delay > 0) await sleep(delay);

  // ── Risoluzione PIN (solo l'Admin SDK vede questa collezione) ──────────
  const lookupSnap = await db.collection('utenti_pin_lookup').doc(pin).get();
  if (!lookupSnap.exists || !lookupSnap.data()?.uid) {
    throw new HttpsError('not-found', MSG_PIN_INVALIDO);
  }
  const { uid } = lookupSnap.data();

  const utenteSnap = await db.collection('utenti').doc(uid).get();
  if (!utenteSnap.exists || utenteSnap.data().stato === 'archiviato') {
    throw new HttpsError('not-found', MSG_PIN_INVALIDO);
  }

  // ── Login riuscito ───────────────────────────────────────────────────
  // Azzera il contatore di questo IP (evita di penalizzare un dispositivo
  // condiviso da più ragazzi solo perché uno ha sbagliato PIN prima).
  await rateRef.set({ count: 0, windowStart: now, lockedUntil: null }, { merge: true });
  await db.collection('utenti_pin').doc(uid).set(
    { lastLogin: FieldValue.serverTimestamp() }, { merge: true }
  );

  const token = await auth.createCustomToken(uid);
  return { token };
});
