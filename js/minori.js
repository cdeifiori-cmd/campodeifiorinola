import { db } from './firebase-config.js';
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { setupNavAuth } from './auth.js';

async function loadMinori() {
  setupNavAuth();
  const params = new URLSearchParams(location.search);
  const comunitaId = params.get('comunita');

  const title = document.getElementById('comunita-title');
  const list = document.getElementById('list-minori');

  if (!comunitaId) {
    list.innerHTML = '<p class="empty-msg">Comunità non specificata.</p>';
    return;
  }

  // Show comunita name from header
  try {
    const { doc, getDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const snap = await getDoc(doc(db, 'comunita', comunitaId));
    if (snap.exists()) {
      title.textContent = snap.data().nomeComunita;
      document.getElementById('page-subtitle').textContent = snap.data().descrizione || '';
    }
  } catch (_) {}

  list.innerHTML = '<div class="spinner"></div>';

  try {
    const snap = await getDocs(query(
      collection(db, 'utenti'),
      where('comunitaId', '==', comunitaId)
    ));
    list.innerHTML = '';
    if (snap.empty) {
      list.innerHTML = '<p class="empty-msg">Nessun ragazzo/a in questa comunità.</p>';
      return;
    }
    snap.forEach(docSnap => {
      const d = docSnap.data();
      const avatar = d.fotoProfilo
        ? `<div class="avatar"><img src="${d.fotoProfilo}" alt="${d.nome}"></div>`
        : `<div class="avatar">🧒</div>`;
      list.innerHTML += `
        <a class="card-minore" href="profilo.html?uid=${docSnap.id}">
          ${avatar}
          <div>
            <div class="nome">${d.nome}</div>
            <div class="comunita-tag">🏡 ${d.comunitaId || ''}</div>
          </div>
        </a>
      `;
    });
  } catch (err) {
    list.innerHTML = `<p class="empty-msg">Errore: ${err.message}</p>`;
  }
}

loadMinori();
