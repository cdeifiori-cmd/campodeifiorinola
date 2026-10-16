// js/console/console-auth.js
// Guardia admin per la Console (SOLO lettura in Milestone B).
//
// Modello admin identico alla Milestone A / firestore.rules:
//   isAdmin = legacy ADMIN_UID  OR  staff/{uid}.admin === true
//
// Questo controllo client serve SOLO a UX/navigazione: la protezione reale
// dei dati è nelle Security Rules. Nessun Custom Claim in questa milestone.

import { auth, db } from '../firebase-config.js';
import { onAuthStateChanged, signOut }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { doc, getDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export const LEGACY_ADMIN_UID = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';

/**
 * Osserva lo stato di autenticazione e risolve lo stato admin.
 * @param {(state: {user: import('firebase/auth').User|null, isAdmin: boolean, via: 'legacy'|'staff.admin'|null}) => void} callback
 * @returns {() => void} unsubscribe
 */
export function onAdminState(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback({ user: null, isAdmin: false, via: null });
      return;
    }
    if (user.uid === LEGACY_ADMIN_UID) {
      callback({ user, isAdmin: true, via: 'legacy' });
      return;
    }
    let isAdmin = false;
    let via = null;
    try {
      const snap = await getDoc(doc(db, 'staff', user.uid));
      if (snap.exists() && snap.data().admin === true) {
        isAdmin = true;
        via = 'staff.admin';
      }
    } catch (_) {
      // La lettura di staff/{uid} è pubblica; in caso di errore imprevisto
      // si resta (in modo prudente) non-admin: la Console non si apre.
    }
    callback({ user, isAdmin, via });
  });
}

export async function logout() {
  await signOut(auth);
}
