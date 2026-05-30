import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { setupNavAuth } from './auth.js';

const EMOJI_MAP = {
  'bella-mbriana': '🌸',
  'itaca': '⚓',
  'willy-coyote': '🐺',
  'fortapasc': '🏠',
  'macrame': '🧶',
  'after-us': '🌟'
};

async function loadComunita() {
  setupNavAuth();
  const grid = document.getElementById('grid-comunita');
  grid.innerHTML = '<div class="spinner"></div>';

  try {
    const snap = await getDocs(query(collection(db, 'comunita'), orderBy('nomeComunita')));
    grid.innerHTML = '';
    if (snap.empty) {
      grid.innerHTML = '<p class="empty-msg">Nessuna comunità trovata.</p>';
      return;
    }
    snap.forEach(doc => {
      const d = doc.data();
      const emoji = EMOJI_MAP[doc.id] || '🏡';
      const thumb = d.immagineUrl
        ? `<img src="${d.immagineUrl}" alt="${d.nomeComunita}" loading="lazy">`
        : emoji;
      grid.innerHTML += `
        <a class="card-comunita" href="minori.html?comunita=${doc.id}">
          <div class="thumb">${thumb}</div>
          <div class="info">
            <h3>${d.nomeComunita}</h3>
            <p>${d.descrizione || ''}</p>
          </div>
        </a>
      `;
    });
  } catch (err) {
    grid.innerHTML = `<p class="empty-msg">Errore nel caricamento: ${err.message}</p>`;
  }
}

loadComunita();
