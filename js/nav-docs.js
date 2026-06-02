import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const ADMIN_UID   = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';
const MASSIMO_UID = '0u41pvwSTAaryAGWAG8gwuxrZ293';

export function setupDocumentiNav() {
  const auth = getAuth();
  const db   = getFirestore();

  onAuthStateChanged(auth, async user => {
    if (!user) return;

    const isAdmin   = user.uid === ADMIN_UID;
    const isMassimo = user.uid === MASSIMO_UID;
    let   isCoord   = false;

    if (!isAdmin && !isMassimo) {
      const snap = await getDoc(doc(db, 'staff', user.uid));
      if (snap.exists()) {
        const ruolo = snap.data().ruolo || '';
        isCoord = ruolo.includes('Coordinatrice');
      }
    }

    if (isAdmin || isMassimo || isCoord) {
      document.querySelectorAll('.nav-doc-link').forEach(el => {
        el.style.display = '';
      });
    }
  });
}
