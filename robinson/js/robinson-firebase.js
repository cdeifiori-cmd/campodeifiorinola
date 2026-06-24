import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey:            "AIzaSyC18lzwqhYcW29TsEO6Oy4Bqvb2PMBUmAg",
  authDomain:        "campo-dei-fiori.firebaseapp.com",
  projectId:         "campo-dei-fiori",
  storageBucket:     "campo-dei-fiori.firebasestorage.app",
  messagingSenderId: "928976798756",
  appId:             "1:928976798756:web:1b90027ec9f03b203e44b1"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth         = getAuth(app);
export const db           = getFirestore(app);
export const CLOUD_NAME   = 'dxqyprtzh';
export const CLOUD_PRESET = 'campo_dei_fiori';
export const ADMIN_UID    = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';
export const EMOJIS       = ['❤️','😂','👏','🔥','😢'];
export const MAX_FILES    = 10;
