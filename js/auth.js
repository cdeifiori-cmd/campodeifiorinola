import { auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

export function getCurrentUser() {
  return auth.currentUser;
}

export function onAuthChange(callback) {
  onAuthStateChanged(auth, callback);
}

export async function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
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
