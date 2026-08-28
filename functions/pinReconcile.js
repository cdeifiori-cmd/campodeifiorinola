/**
 * pinReconcile — riconciliazione fuori banda dello stato PIN (Patch E.1)
 *
 * NON è una callable e NON è esposta ai client. È un helper SERVER-SIDE, a
 * iniezione di dipendenze ({ db, auth } dell'Admin SDK), pensato per essere
 * invocato manualmente (script una tantum) o da un futuro strumento admin
 * esplicito. Nessun job automatico.
 *
 * PERCHÉ ESISTE: creaRagazzoAdmin compensa gli errori *gestiti*. Se il processo
 * si interrompe tra createUser e il batch Firestore, nessun catch scatta e resta
 * uno stato parziale. Qui lo si classifica e, SOLO per il caso realmente
 * innocuo (reservation orfana senza account né profilo), si offre un cleanup
 * protetto da ownership. Non cancella MAI account Auth né documenti `utenti`.
 *
 * MODELLO reservation: pin_reservations/{pin} = { uid, status, createdAt, activatedAt? }
 *   status RESERVED : creazione in corso o interrotta.
 *   status ACTIVE   : profilo creato (scritto nello stesso batch del profilo).
 */

const PIN_STATE = Object.freeze({
  NOT_FOUND: 'NOT_FOUND',                       // nessuna traccia del PIN
  HEALTHY: 'HEALTHY',                           // ACTIVE + Auth + utenti + utenti_pin coerenti
  ORPHAN_RESERVATION: 'ORPHAN_RESERVATION',     // RESERVED, niente Auth, niente utenti  -> recuperabile
  INCOMPLETE_AUTH: 'INCOMPLETE_AUTH',           // RESERVED + Auth, niente utenti        -> Auth orfano
  RESERVED_STALE: 'RESERVED_STALE',             // RESERVED ma Auth+utenti esistono      -> batch ACTIVE perso; revisione manuale
  INCONSISTENT_ACTIVE: 'INCONSISTENT_ACTIVE',   // ACTIVE ma manca Auth o utenti o utenti_pin
  INCONSISTENT: 'INCONSISTENT',                 // combinazione non prevista (es. utenti senza Auth)
  LEGACY: 'LEGACY',                             // niente reservation ma utenti_pin(+lookup) legacy
  INCONSISTENT_NO_RESERVATION: 'INCONSISTENT_NO_RESERVATION', // utenti_pin nuovo-stile senza reservation, senza lookup
});

/**
 * Classifica lo stato di un PIN incrociando pin_reservations, utenti_pin,
 * utenti_pin_lookup, Auth e utenti. Sola lettura: nessuna mutazione.
 *
 * @param {{db: FirebaseFirestore.Firestore, auth: import('firebase-admin/auth').Auth}} deps
 * @param {string} pin
 * @returns {Promise<{pin:string, state:string, uid:(string|null), details:object}>}
 */
async function classifyPinState({ db, auth }, pin) {
  const p = String(pin || '').trim();
  const [resSnap, lookupSnap, pinQ] = await Promise.all([
    db.collection('pin_reservations').doc(p).get(),
    db.collection('utenti_pin_lookup').doc(p).get(),
    db.collection('utenti_pin').where('pin', '==', p).limit(1).get(),
  ]);

  const res = resSnap.exists ? resSnap.data() : null;
  const lookup = lookupSnap.exists ? lookupSnap.data() : null;
  const upDoc = pinQ.empty ? null : pinQ.docs[0];
  const upUid = upDoc ? upDoc.id : null;

  const resolvedUid = (res && res.uid) || upUid || (lookup && lookup.uid) || null;

  let authExists = false;
  let utenteExists = false;
  if (resolvedUid) {
    authExists = await auth.getUser(resolvedUid).then(() => true).catch(() => false);
    utenteExists = await db.collection('utenti').doc(resolvedUid).get()
      .then((s) => s.exists).catch(() => false);
  }

  const details = {
    reservation: res ? { uid: res.uid, status: res.status || null } : null,
    utentiPinUid: upUid,
    lookup: !!lookup,
    resolvedUid,
    authExists,
    utenteExists,
  };

  // Nessuna traccia
  if (!res && !upDoc && !lookup) {
    return { pin: p, state: PIN_STATE.NOT_FOUND, uid: null, details };
  }

  // C'è una reservation
  if (res) {
    const status = res.status || 'RESERVED';
    if (status === 'ACTIVE') {
      const coerente = authExists && utenteExists && upUid && upUid === res.uid;
      return {
        pin: p,
        state: coerente ? PIN_STATE.HEALTHY : PIN_STATE.INCONSISTENT_ACTIVE,
        uid: resolvedUid,
        details,
      };
    }
    // status RESERVED
    if (!authExists && !utenteExists) {
      return { pin: p, state: PIN_STATE.ORPHAN_RESERVATION, uid: resolvedUid, details };
    }
    if (authExists && !utenteExists) {
      return { pin: p, state: PIN_STATE.INCOMPLETE_AUTH, uid: resolvedUid, details };
    }
    if (authExists && utenteExists) {
      return { pin: p, state: PIN_STATE.RESERVED_STALE, uid: resolvedUid, details };
    }
    return { pin: p, state: PIN_STATE.INCONSISTENT, uid: resolvedUid, details };
  }

  // Nessuna reservation, ma il PIN esiste in utenti_pin e/o lookup.
  // Discriminante affidabile: SOLO il percorso legacy (js/ragazzi-pin.js) scrive
  // utenti_pin_lookup. Se il lookup c'è -> legacy. Se manca, non possiamo
  // distinguere con certezza "legacy con lookup cancellato" da "creazione nuova
  // rotta": lo dichiariamo e NON applichiamo euristiche pericolose.
  if (lookup) {
    return { pin: p, state: PIN_STATE.LEGACY, uid: resolvedUid, details };
  }
  return { pin: p, state: PIN_STATE.INCONSISTENT_NO_RESERVATION, uid: resolvedUid, details };
}

/**
 * Diagnosi strutturata su TUTTE le reservation. Sola lettura.
 * @returns {Promise<{scanned:number, byState:object, items:Array}>}
 */
async function reconcileAll({ db, auth }, { limit = 500 } = {}) {
  const snap = await db.collection('pin_reservations').limit(limit).get();
  const items = [];
  for (const d of snap.docs) {
    items.push(await classifyPinState({ db, auth }, d.id));
  }
  const byState = {};
  for (const it of items) byState[it.state] = (byState[it.state] || 0) + 1;
  return { scanned: snap.size, byState, items };
}

/**
 * Cleanup di UNA sola reservation, e solo se è un'orfana innocua.
 * Vincoli NON negoziabili:
 *   - expectedUid obbligatorio; reservation.uid deve combaciare (ownership);
 *   - status !== 'ACTIVE';
 *   - lo stato classificato deve essere ORPHAN_RESERVATION (niente Auth, niente utenti);
 *   - non tocca MAI Auth né la collezione `utenti`.
 *
 * @returns {Promise<{pin:string, action:'DELETED'|'DENIED'|'SKIPPED'|'NOOP', reason:string, state?:string}>}
 */
async function cleanupOrphanReservation({ db, auth }, pin, expectedUid) {
  const p = String(pin || '').trim();
  if (!expectedUid) {
    return { pin: p, action: 'DENIED', reason: 'expectedUid obbligatorio' };
  }

  const ref = db.collection('pin_reservations').doc(p);
  const pre = await ref.get();
  if (!pre.exists) return { pin: p, action: 'NOOP', reason: 'nessuna reservation' };
  if (pre.data().uid !== expectedUid) {
    return { pin: p, action: 'DENIED', reason: 'ownership mismatch' };
  }
  if ((pre.data().status || 'RESERVED') === 'ACTIVE') {
    return { pin: p, action: 'DENIED', reason: 'reservation ACTIVE: creazione completata' };
  }

  const cls = await classifyPinState({ db, auth }, p);
  if (cls.state !== PIN_STATE.ORPHAN_RESERVATION) {
    return { pin: p, action: 'SKIPPED', reason: 'stato non orfano', state: cls.state };
  }

  let done = false;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists || !s.data()) return;
    if (s.data().uid !== expectedUid) return;
    if ((s.data().status || 'RESERVED') === 'ACTIVE') return;
    tx.delete(ref);
    done = true;
  });
  return done
    ? { pin: p, action: 'DELETED', reason: 'reservation orfana rimossa', state: cls.state }
    : { pin: p, action: 'SKIPPED', reason: 'stato cambiato durante il cleanup' };
}

module.exports = { PIN_STATE, classifyPinState, reconcileAll, cleanupOrphanReservation };
