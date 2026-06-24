import { auth, db, ADMIN_UID } from './robinson-firebase.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function waitForAuth() {
  return new Promise(resolve => {
    const timer = setTimeout(() => { unsub(); resolve(null); }, 5000);
    const unsub = onAuthStateChanged(auth, user => {
      clearTimeout(timer);
      unsub();
      resolve(user);
    });
  });
}

export function getAuthUser() {
  return waitForAuth();
}

export async function isAdmin(user) {
  if (!user) return false;
  if (user.uid === ADMIN_UID) return true;
  try {
    const snap = await getDoc(doc(db, 'utenti', user.uid));
    if (snap.exists() && snap.data().ruolo === 'admin') return true;
  } catch (_) {}
  return false;
}

export function setupNavAuth(slotId) {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  onAuthStateChanged(auth, async user => {
    if (!user) {
      slot.innerHTML = `<a href="https://campodeifiori.org/login.html" style="color:#fff;font-size:0.85rem;">Accedi</a>`;
      return;
    }
    let nome = user.displayName || 'Naufrago';
    let foto = null;
    let admin = user.uid === ADMIN_UID;
    try {
      const snap = await getDoc(doc(db, 'utenti', user.uid));
      if (snap.exists()) {
        const d = snap.data();
        nome = d.nome || nome;
        foto = d.fotoProfilo || null;
        if (d.ruolo === 'admin') admin = true;
      }
    } catch (_) {}
    const avatarHtml = foto
      ? `<img src="${foto}" alt="${nome}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid var(--oro);">`
      : `<span style="width:32px;height:32px;border-radius:50%;background:var(--oro);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1rem;">⚓</span>`;
    slot.innerHTML = `
      <div style="position:relative;">
        <button id="_navAvatarBtn" style="background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:6px;color:#fff;">
          ${avatarHtml}<span style="font-size:0.78rem;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${nome}</span>
        </button>
        <div id="_navDropdown" style="display:none;position:absolute;right:0;top:100%;background:#fff;border:2px solid var(--oro);border-radius:10px;min-width:180px;box-shadow:0 4px 16px rgba(0,0,0,0.15);z-index:300;overflow:hidden;">
          <a href="naufrago.html?uid=${user.uid}" style="display:block;padding:10px 16px;color:var(--inchiostro);text-decoration:none;font-size:0.85rem;border-bottom:1px solid #eee;">⚓ Il mio profilo</a>
          ${admin ? `<a href="admin-classifica.html" style="display:block;padding:10px 16px;color:var(--inchiostro);text-decoration:none;font-size:0.85rem;border-bottom:1px solid #eee;">📊 Classifica</a>` : ''}
          <button id="_navLogout" style="width:100%;padding:10px 16px;background:none;border:none;text-align:left;cursor:pointer;color:var(--rosso);font-size:0.85rem;">🚪 Logout</button>
        </div>
      </div>`;
    document.getElementById('_navAvatarBtn').addEventListener('click', e => {
      e.stopPropagation();
      const dd = document.getElementById('_navDropdown');
      dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => {
      const dd = document.getElementById('_navDropdown');
      if (dd) dd.style.display = 'none';
    });
    document.getElementById('_navLogout').addEventListener('click', async () => {
      const { signOut } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");
      await signOut(auth);
      location.href = 'index.html';
    });
  });
}
