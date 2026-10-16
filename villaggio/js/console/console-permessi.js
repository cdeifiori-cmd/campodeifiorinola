// js/console/console-permessi.js
// UNICA funzione di scrittura della Console in Milestone C.
// Modifica ESCLUSIVAMENTE staff/{uid}.accessoDocumenti (tri-state) e, in modo
// ATOMICO (writeBatch), registra la modifica in admin_audit.
//
// Nessun altro campo staff viene toccato (né admin, né ruolo, né comunitaId,
// né nome/email). La firma è dedicata (setAccessoDocumenti(uid, value)) e non
// una updateStaff() generica che potrebbe accettare campi arbitrari.

import { db, auth } from '../firebase-config.js';
import {
  doc, getDoc, collection, writeBatch, serverTimestamp, deleteField,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// value ammessi: true | false | 'legacy'
const ACTION_BY_KEY = {
  true:   'DOCUMENTI_ACCESS_GRANTED',
  false:  'DOCUMENTI_ACCESS_DENIED',
  legacy: 'DOCUMENTI_ACCESS_RESET_LEGACY',
};

function keyOf(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (value === 'legacy') return 'legacy';
  return null; // non valido
}

/**
 * @param {string} uid  document id dello staff
 * @param {true|false|'legacy'} value
 *        true    -> accessoDocumenti = true   (accesso esplicitamente concesso)
 *        false   -> accessoDocumenti = false  (accesso esplicitamente negato)
 *        'legacy'-> rimuove SOLO il campo accessoDocumenti (deleteField()),
 *                   NON il documento staff: l'accesso torna a dipendere dal ruolo.
 * @returns {Promise<{changed:boolean, before:(true|false|null), after:(true|false|null), action?:string, auditId?:string}>}
 */
export async function setAccessoDocumenti(uid, value) {
  const key = keyOf(value);
  if (!key) {
    throw new Error(`Valore non valido: ${JSON.stringify(value)}. Ammessi: true, false, 'legacy'.`);
  }
  if (typeof uid !== 'string' || !uid) throw new Error('uid operatore mancante.');

  const actor = auth.currentUser;
  if (!actor) throw new Error('Sessione non autenticata.');

  const staffRef = doc(db, 'staff', uid);
  const snap = await getDoc(staffRef);
  if (!snap.exists()) throw new Error('Operatore non trovato nella collezione "staff".');

  const cur = snap.data() || {};
  const before = Object.prototype.hasOwnProperty.call(cur, 'accessoDocumenti')
    ? cur.accessoDocumenti
    : null; // null rappresenta "campo assente" (Firestore non memorizza undefined)

  let fieldValue;
  let after;
  if (key === 'true')  { fieldValue = true;  after = true; }
  else if (key === 'false') { fieldValue = false; after = false; }
  else { fieldValue = deleteField(); after = null; }

  // No-op: nessuna scrittura, nessun audit se lo stato non cambia davvero.
  if (before === after) {
    return { changed: false, before, after };
  }

  const auditRef = doc(collection(db, 'admin_audit'));
  const batch = writeBatch(db);

  // (1) modifica del SOLO campo accessoDocumenti
  batch.update(staffRef, { accessoDocumenti: fieldValue });

  // (2) voce di audit — atomica con (1): se una fallisce, fallisce tutto
  batch.set(auditRef, {
    ts: serverTimestamp(),
    actorUid: actor.uid,
    action: ACTION_BY_KEY[key],
    targetType: 'staff',
    targetId: uid,
    before: { accessoDocumenti: before },
    after: { accessoDocumenti: after },
  });

  await batch.commit();

  return { changed: true, before, after, action: ACTION_BY_KEY[key], auditId: auditRef.id };
}
