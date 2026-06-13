import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC18lzwqhYcW29TsEO6Oy4Bqvb2PMBUmAg",
  authDomain: "campo-dei-fiori.firebaseapp.com",
  projectId: "campo-dei-fiori",
  storageBucket: "campo-dei-fiori.firebasestorage.app",
  messagingSenderId: "928976798756",
  appId: "1:928976798756:web:1b90027ec9f03b203e44b1"
};

const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

const CSS = `
  .nav-auth-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .btn-accedi {
    background: rgba(255,255,255,0.22);
    color: #fff;
    border: none;
    border-radius: 20px;
    padding: 6px 14px;
    font-family: 'Nunito', sans-serif;
    font-weight: 700;
    font-size: 0.82rem;
    cursor: pointer;
    text-decoration: none;
    transition: background 0.2s;
    white-space: nowrap;
  }
  .btn-accedi:hover { background: rgba(255,255,255,0.38); }

  .user-avatar-btn {
    width: 34px; height: 34px;
    border-radius: 50%;
    border: 2px solid rgba(255,255,255,0.7);
    overflow: hidden;
    cursor: pointer;
    background: rgba(255,255,255,0.2);
    display: flex; align-items: center; justify-content: center;
    font-size: 1.1rem;
    flex-shrink: 0;
    transition: border-color 0.2s;
  }
  .user-avatar-btn:hover { border-color: #fff; }
  .user-avatar-btn img { width: 100%; height: 100%; object-fit: cover; }

  .user-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.18);
    min-width: 190px;
    overflow: hidden;
    z-index: 999;
    display: none;
  }
  .user-dropdown.open { display: block; }
  .user-dropdown .dropdown-name {
    padding: 12px 16px 8px;
    font-weight: 800;
    font-size: 0.9rem;
    color: #333;
    border-bottom: 1px solid #f0f0f0;
  }
  .user-dropdown a,
  .user-dropdown button {
    display: block; width: 100%;
    padding: 11px 16px;
    text-align: left;
    background: none; border: none;
    font-family: 'Nunito', sans-serif;
    font-size: 0.88rem; font-weight: 600;
    color: #333; text-decoration: none;
    cursor: pointer;
    transition: background 0.15s;
  }
  .user-dropdown a:hover,
  .user-dropdown button:hover { background: #f5f5f5; }
  .user-dropdown .logout-btn { color: #e74c3c; }
`;

function injectCSS() {
  if (document.getElementById('nav-auth-css')) return;
  const style = document.createElement('style');
  style.id = 'nav-auth-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

export function setupNavAuth(slotId = 'nav-auth-slot') {
  injectCSS();
  const slot = document.getElementById(slotId);
  if (!slot) return;

  onAuthStateChanged(auth, async user => {
    if (!user) {
      slot.innerHTML = `<a class="btn-accedi" href="login.html">Accedi</a>`;
      return;
    }

    // Setup notifiche push (silenzioso, non blocca il rendering)
    import('./notifiche.js').then(m => m.setupNotifiche(user)).catch(() => {});

    // Leggi foto profilo da Firestore (utenti o staff)
    let foto = null;
    let nome = user.displayName || user.email || 'Utente';
    try {
      let snap = await getDoc(doc(db, 'utenti', user.uid));
      if (!snap.exists()) snap = await getDoc(doc(db, 'staff', user.uid));
      if (snap.exists()) {
        const d = snap.data();
        foto = d.fotoProfilo || null;
        nome = d.nome || nome;
        // Primo accesso: imposta timestamp se non già presente
        if (!d.primoAccesso) {
          const coll = snap.ref.parent.id;
          if (coll === 'utenti') {
            updateDoc(doc(db, 'utenti', user.uid), { primoAccesso: serverTimestamp() }).catch(() => {});
          }
        }
      }
    } catch (_) {}

    const avatarInner = foto
      ? `<img src="${foto}" alt="${nome}">`
      : '👤';

    slot.innerHTML = `
      <div class="nav-auth-wrap" id="nav-auth-wrap">
        <div class="user-avatar-btn" id="user-avatar-btn" title="${nome}">
          ${avatarInner}
        </div>
        <div class="user-dropdown" id="user-dropdown">
          <div class="dropdown-name">${nome}</div>
          <a href="profilo.html?uid=${user.uid}">👤 Il mio profilo</a>
          <button class="logout-btn" id="btn-logout">🚪 Esci</button>
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
