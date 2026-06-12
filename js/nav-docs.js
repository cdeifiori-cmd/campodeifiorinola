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

  // Nasconde il nav finché i dati utente non sono pronti,
  // così Documenti appare (o resta nascosta) senza riflussare il layout.
  const nav = document.querySelector('.bottom-nav');
  if (nav) {
    nav.style.opacity    = '0';
    nav.style.transition = 'opacity 0.15s';
  }
  const showNav = () => { if (nav) nav.style.opacity = ''; };

  // Fallback: mostra comunque dopo 2 s se onAuthStateChanged non si attiva
  const timer = setTimeout(showNav, 2000);

  let handled = false;

  onAuthStateChanged(auth, async user => {
    if (handled) return;
    handled = true;
    try {
      if (!user) return;

      const isAdmin   = user.uid === ADMIN_UID;
      let   hasAccess = isAdmin;

      if (!hasAccess) {
        for (const coll of ['utenti', 'staff', 'amici']) {
          try {
            const snap = await getDoc(doc(db, coll, user.uid));
            if (!snap.exists()) continue;
            const data = snap.data();
            if (coll === 'staff' && isRuoloConAccesso(data.ruolo)) { hasAccess = true; break; }
            if (data.accessoDocumenti === true)                     { hasAccess = true; break; }
          } catch (_) {}
        }
      }

      if (hasAccess) {
        document.querySelectorAll('.nav-doc-link').forEach(el => {
          el.style.display = '';
        });
      }
    } finally {
      clearTimeout(timer);
      showNav();
    }
  });
}
