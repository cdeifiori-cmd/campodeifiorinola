import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC0KFMjiJwJy0mEpZBJfB3DOoFBe_4_kFo",
  authDomain: "campo-dei-fiori.firebaseapp.com",
  projectId: "campo-dei-fiori",
  storageBucket: "campo-dei-fiori.appspot.com",
  messagingSenderId: "325163062652",
  appId: "1:325163062652:web:2feeed4ffc43fb1e2e0afc"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const CLOUD_NAME = 'dxqyprtzh';
export const CLOUD_PRESET = 'campo_dei_fiori';
export const ADMIN_UID = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';
export const EMOJIS = ['❤️','😂','👏','🔥','😢'];
