import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, setPersistence, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC18lzwqhYcW29TsEO6Oy4Bqvb2PMBUmAg",
  authDomain: "campo-dei-fiori.firebaseapp.com",
  projectId: "campo-dei-fiori",
  storageBucket: "campo-dei-fiori.appspot.com",
  messagingSenderId: "325163062652",
  appId: "1:325163062652:web:2feeed4ffc43fb1e2e0afc"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Persistenza Auth ESPLICITA (prima si affidava solo alla catena di default della SDK):
// IndexedDB -> localStorage -> memoria. Su alcuni browser mobile (Safari iOS in privata, WebView
// in-app di Instagram/WhatsApp) IndexedDB e localStorage possono essere bloccati o instabili:
// senza un fallback esplicito la sessione scivola silenziosamente su "solo memoria" (non
// sopravvive a un reload della pagina) senza che il codice se ne accorga o possa segnalarlo.
setPersistence(auth, indexedDBLocalPersistence)
  .catch(() => setPersistence(auth, browserLocalPersistence))
  .catch(() => setPersistence(auth, inMemoryPersistence).then(() => {
    console.warn('[robinson-firebase] Persistenza di sessione limitata alla memoria: IndexedDB e localStorage non disponibili su questo browser/dispositivo. La sessione NON sopravvivrà a un ricaricamento della pagina.');
  }))
  .catch(err => console.error('[robinson-firebase] Impossibile impostare alcuna persistenza Auth:', err));
export const CLOUD_NAME = 'dxqyprtzh';
export const CLOUD_PRESET = 'campo_dei_fiori';
export const ADMIN_UID = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';
export const EMOJIS = ['❤️','😂','👏','🔥','😢'];
