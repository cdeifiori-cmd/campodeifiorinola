/**
 * Nav auth per Robinson — variante di nav-auth.js
 * Dropdown punta a naufrago.html invece di profilo.html
 * Logout → index.html (Robinson)
 */
import { auth, db } from './robinson-firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function setupNavAuth(slotId = 'nav-auth-slot') {
  const slot = document.getElementById(slotId);
  if (!slot) return;

  onAuthStateChanged(auth, async user => {
    if (!user) {
      slot.innerHTML = `<a class="btn-accedi" href="index.html">Accedi</a>`;
      return;
    }

    let foto = null;
    let nome = user.displayName || user.email || 'Naufrago';
    try {
      let snap = await getDoc(doc(db, 'utenti', user.uid));
      if (!snap.exists()) snap = await getDoc(doc(db, 'staff', user.uid));
      if (snap.exists()) {
        const d = snap.data();
        foto = d.fotoProfilo || null;
        nome = d.nome || nome;
      }
    } catch (_) {}

    const avatarInner = foto ? `<img src="${foto}" alt="${nome}">` : '⚓';

    slot.innerHTML = `
      <div class="nav-auth-wrap" id="nav-auth-wrap">
        <div class="user-avatar-btn" id="user-avatar-btn" title="${nome}">
          ${avatarInner}
        </div>
        <div class="user-dropdown" id="user-dropdown">
          <div class="dropdown-name">${nome}</div>
          <a href="naufrago.html?uid=${user.uid}">⚓ Il mio diario</a>
          <button class="logout-btn" id="btn-logout">🚪 Esci dall'isola</button>
        </div>
      </div>`;

    document.getElementById('user-avatar-btn').addEventListener('click', e => {
      e.stopPropagation();
      document.getElementById('user-dropdown').classList.toggle('open');
    });
    document.addEventListener('click', () => {
      document.getElementById('user-dropdown')?.classList.remove('open');
    });
    document.getElementById('btn-logout').addEventListener('click', async () => {
      await signOut(auth);
      location.href = 'index.html';
    });
  });
}

export function getAuthUser() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => { unsub(); resolve(user); });
  });
}
