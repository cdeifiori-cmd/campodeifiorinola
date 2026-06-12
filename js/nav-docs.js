import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const ADMIN_UID = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';

function isRuoloConAccesso(ruolo) {
  const r = (ruolo || '').toLowerCase();
  return r.includes('coordinat') || r.includes('responsabil');
}

export function setupDocumentiNav() {
  const auth = getAuth();
  const db   = getFirestore();

  onAuthStateChanged(auth, async user => {
    if (!user) return;

    const isAdmin = user.uid === ADMIN_UID;
    let   hasAccess = isAdmin;

    if (!hasAccess) {
      // Cerca il documento utente in tutte le collezioni
      for (const coll of ['utenti', 'staff', 'amici']) {
        try {
          const snap = await getDoc(doc(db, coll, user.uid));
          if (!snap.exists()) continue;
          const data = snap.data();
          // Accesso per ruolo coordinatrice/responsabile (solo staff)
          if (coll === 'staff' && isRuoloConAccesso(data.ruolo)) { hasAccess = true; break; }
          // Accesso speciale esplicito (qualsiasi collezione)
          if (data.accessoDocumenti === true) { hasAccess = true; break; }
        } catch (_) {}
      }
    }

    if (hasAccess) {
      document.querySelectorAll('.nav-doc-link').forEach(el => {
        el.style.display = '';
      });
    }
  });
}
