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
    let   isCoord = false;

    if (!isAdmin) {
      const snap = await getDoc(doc(db, 'staff', user.uid));
      if (snap.exists()) {
        isCoord = isRuoloConAccesso(snap.data().ruolo);
      }
    }

    if (isAdmin || isCoord) {
      document.querySelectorAll('.nav-doc-link').forEach(el => {
        el.style.display = '';
      });
    }
  });
}
