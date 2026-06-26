import { auth, db, ADMIN_UID } from './robinson-firebase.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export function setupNavAuth(slotId = 'nav-auth-slot') {
  const slot = document.getElementById(slotId);
  if (!slot) return;

  let navResolved = false;
  const navUnsub = onAuthStateChanged(auth, async user => {
    if (navResolved) return;
    navResolved = true;
    navUnsub();

    if (!user) {
      const _ru = encodeURIComponent(window.location.pathname);
      slot.innerHTML = `<a href="login.html?returnUrl=${_ru}" style="color:#fff;font-size:0.85rem;text-decoration:none;padding:6px 12px;border:1px solid rgba(255,255,255,0.4);border-radius:6px;">Accedi</a>`;
      return;
    }

    let nome = user.displayName || user.email?.split('@')[0] || 'Naufrago';
    let foto = null;
    let admin = user.uid === ADMIN_UID;
    try {
      const snap = await getDoc(doc(db, 'utenti', user.uid));
      if (snap.exists()) {
        const d = snap.data();
        if (d.nome) nome = d.nome;
        if (d.fotoProfilo) foto = d.fotoProfilo;
        if (d.ruolo === 'admin') admin = true;
      }
      // Fallback: leggi da staff/{uid} se foto ancora mancante
      if (!foto) {
        const snapStaff = await getDoc(doc(db, 'staff', user.uid));
        if (snapStaff.exists()) {
          const ds = snapStaff.data();
          if (ds.fotoProfilo) foto = ds.fotoProfilo;
          if (!nome || nome === user.email?.split('@')[0]) { if (ds.nome) nome = ds.nome; }
        }
      }
    } catch (e) { console.warn('robinson-nav: errore lettura profilo', e); }

    const avatarHtml = foto
      ? `<img src="${foto}" alt="${nome}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;border:2px solid var(--oro);">`
      : `<div style="width:32px;height:32px;border-radius:50%;background:var(--oro);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1rem;">⚓</div>`;

    slot.innerHTML = `
      <div style="position:relative;">
        <button id="_navAvatarBtn" style="background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:6px;color:#fff;padding:4px;">
          ${avatarHtml}
          <span style="font-size:0.78rem;max-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${nome}</span>
          <span style="font-size:0.6rem;opacity:0.7;">▼</span>
        </button>
        <div id="_navDropdown" style="display:none;position:absolute;right:0;top:calc(100% + 4px);background:#fff;border:2px solid var(--oro);border-radius:10px;min-width:190px;box-shadow:0 6px 20px rgba(0,0,0,0.18);z-index:300;overflow:hidden;">
          <div style="padding:10px 16px;font-size:0.78rem;color:var(--muted);border-bottom:1px solid #f0e8d8;font-style:italic;">${nome}</div>
          <a href="naufrago.html?uid=${user.uid}" style="display:block;padding:10px 16px;color:var(--inchiostro);text-decoration:none;font-size:0.85rem;border-bottom:1px solid #f0e8d8;">⚓ Il mio profilo</a>
          ${admin ? `<a href="admin-classifica.html" style="display:block;padding:10px 16px;color:var(--inchiostro);text-decoration:none;font-size:0.85rem;border-bottom:1px solid #f0e8d8;">📊 Classifica</a>` : ''}
          ${admin ? `<a href="admin-isola.html" style="display:block;padding:10px 16px;color:var(--inchiostro);text-decoration:none;font-size:0.85rem;border-bottom:1px solid #f0e8d8;">🏝️ Admin Isola</a>` : ''}
          ${admin ? `<a href="admin-pin.html" style="display:block;padding:10px 16px;color:var(--inchiostro);text-decoration:none;font-size:0.85rem;border-bottom:1px solid #f0e8d8;">🔑 Gestione PIN</a>` : ''}
          <button id="_navLogout" style="width:100%;padding:10px 16px;background:none;border:none;text-align:left;cursor:pointer;color:var(--rosso);font-size:0.85rem;">🚪 Esci dall'isola</button>
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
