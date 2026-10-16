import { auth, db } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, getDoc, updateDoc, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function getCurrentUser() {
  return auth.currentUser;
}

export function onAuthChange(callback) {
  onAuthStateChanged(auth, callback);
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  try {
    let ref = doc(db, 'utenti', uid);
    let snap = await getDoc(ref);
    if (!snap.exists()) {
      ref = doc(db, 'staff', uid);
      snap = await getDoc(ref);
    }
    if (snap.exists()) {
      await updateDoc(ref, { numeroAccessi: increment(1) });
    }
  } catch (_) {}
  return cred;
}

export async function logout() {
  return signOut(auth);
}

// Inject nav auth controls into any page that has #nav-auth-slot
export function setupNavAuth() {
  const slot = document.getElementById('nav-auth-slot');
  if (!slot) return;

  onAuthStateChanged(auth, user => {
    if (user) {
      slot.innerHTML = `
        <a href="profilo.html?uid=${user.uid}" class="btn-nav">Profilo</a>
        <button class="btn-nav accent" id="btn-logout">Esci</button>
      `;
      document.getElementById('btn-logout').addEventListener('click', () => logout());
    } else {
      slot.innerHTML = `<a href="login.html" class="btn-nav accent">Accedi</a>`;
    }
  });
}
