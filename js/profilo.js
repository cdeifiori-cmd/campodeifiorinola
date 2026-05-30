import { db, auth } from './firebase-config.js';
import {
  doc, getDoc, collection, query, where,
  orderBy, getDocs, addDoc, deleteDoc, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { onAuthChange, setupNavAuth, logout } from './auth.js';

const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/dxqyprtzh/image/upload';
const CLOUDINARY_PRESET = 'campo_dei_fiori';

const params = new URLSearchParams(location.search);
const profileUid = params.get('uid');
let currentUser = null;
let isOwner = false;

// ---- DOM refs ----
const avatarWrap = document.getElementById('avatar-wrap');
const avatarImg = document.getElementById('avatar-img');
const nomeEl = document.getElementById('profilo-nome');
const comunitaEl = document.getElementById('profilo-comunita');
const audioSection = document.getElementById('audio-section');
const audioEl = document.getElementById('audio-player');
const miPresentoText = document.getElementById('mi-presento-text');
const btnEditPresento = document.getElementById('btn-edit-presento');
const diarioList = document.getElementById('diario-list');
const bottigliaList = document.getElementById('bottiglia-list');
const fabInput = document.getElementById('fab-input');
const btnMandaBottiglia = document.getElementById('btn-manda-bottiglia');

// Modals
const modalDiario = document.getElementById('modal-diario');
const modalDiarioText = document.getElementById('modal-diario-text');
const btnSaveDiario = document.getElementById('btn-save-diario');
const btnCancelDiario = document.getElementById('btn-cancel-diario');

const modalPresento = document.getElementById('modal-presento');
const modalPresentoText = document.getElementById('modal-presento-text');
const btnSavePresento = document.getElementById('btn-save-presento');
const btnCancelPresento = document.getElementById('btn-cancel-presento');

const modalBottiglia = document.getElementById('modal-bottiglia');
const modalBottigliaText = document.getElementById('modal-bottiglia-text');
const btnSaveBottiglia = document.getElementById('btn-save-bottiglia');
const btnCancelBottiglia = document.getElementById('btn-cancel-bottiglia');

// ---- Init ----
setupNavAuth();

onAuthChange(user => {
  currentUser = user;
  isOwner = user && user.uid === profileUid;
  renderOwnerUI();
});

async function init() {
  if (!profileUid) { nomeEl.textContent = 'Profilo non trovato'; return; }
  await loadProfilo();
  await loadDiario();
  await loadBottiglie();
}

async function loadProfilo() {
  try {
    const snap = await getDoc(doc(db, 'utenti', profileUid));
    if (!snap.exists()) { nomeEl.textContent = 'Profilo non trovato'; return; }
    const d = snap.data();
    nomeEl.textContent = d.nome || 'Senza nome';
    comunitaEl.textContent = d.comunitaId ? `🏡 ${d.comunitaId}` : '';
    if (d.fotoProfilo) {
      avatarImg.src = d.fotoProfilo;
      avatarImg.classList.remove('hidden');
      avatarWrap.querySelector('.avatar-emoji').classList.add('hidden');
    }
    if (d.audioUrl) {
      audioEl.src = d.audioUrl;
      audioSection.classList.remove('hidden');
    }
    if (d.miPresento) {
      miPresentoText.textContent = d.miPresento;
      miPresentoText.classList.remove('mi-presento-empty');
    } else {
      miPresentoText.textContent = 'Ancora nessuna presentazione...';
      miPresentoText.classList.add('mi-presento-empty');
    }
    // Store for modal
    modalPresentoText.value = d.miPresento || '';
  } catch (err) {
    nomeEl.textContent = 'Errore caricamento';
  }
}

async function loadDiario() {
  diarioList.innerHTML = '<div class="spinner"></div>';
  try {
    const snap = await getDocs(query(
      collection(db, 'diario'),
      where('uidRagazzo', '==', profileUid),
      orderBy('createdAt', 'desc')
    ));
    diarioList.innerHTML = '';
    if (snap.empty) {
      diarioList.innerHTML = '<p class="empty-msg">Il diario è ancora vuoto...</p>';
      return;
    }
    snap.forEach(d => renderDiarioCard(d.id, d.data()));
  } catch (err) {
    diarioList.innerHTML = `<p class="empty-msg">Errore: ${err.message}</p>`;
  }
}

function renderDiarioCard(id, d) {
  const data = d.createdAt?.toDate ? formatDate(d.createdAt.toDate()) : '';
  const img = d.immagineUrl ? `<img class="diario-img" src="${d.immagineUrl}" alt="foto">` : '';
  const deleteBtn = isOwner
    ? `<button class="btn-delete" data-id="${id}" title="Elimina">🗑️</button>` : '';
  const el = document.createElement('div');
  el.className = 'card-diario';
  el.dataset.id = id;
  el.innerHTML = `
    ${deleteBtn}
    <div class="diario-data">${data}</div>
    <div>${d.testo || ''}</div>
    ${img}
  `;
  if (isOwner) {
    el.querySelector('.btn-delete').addEventListener('click', () => deleteDiario(id));
  }
  diarioList.appendChild(el);
}

async function loadBottiglie() {
  bottigliaList.innerHTML = '<div class="spinner"></div>';
  try {
    const snap = await getDocs(query(
      collection(db, 'messaggiBottiglia'),
      where('uidDestinatario', '==', profileUid),
      orderBy('createdAt', 'desc')
    ));
    bottigliaList.innerHTML = '';
    if (snap.empty) {
      bottigliaList.innerHTML = '<p class="empty-msg">Nessun messaggio in bottiglia ancora 🍾</p>';
      return;
    }
    snap.forEach(d => renderBottigliaCard(d.id, d.data()));
  } catch (err) {
    bottigliaList.innerHTML = `<p class="empty-msg">Errore: ${err.message}</p>`;
  }
}

function renderBottigliaCard(id, d) {
  const data = d.createdAt?.toDate ? formatDate(d.createdAt.toDate()) : '';
  const deleteBtn = isOwner
    ? `<button class="btn-delete" data-id="${id}" title="Elimina">🗑️</button>` : '';
  const el = document.createElement('div');
  el.className = 'card-bottiglia';
  el.dataset.id = id;
  el.innerHTML = `
    ${deleteBtn}
    <div class="bottiglia-header">🍾 <strong>${d.nomeMittente || 'Anonimo'}</strong> · ${data}</div>
    <div class="bottiglia-testo">${d.testo || ''}</div>
  `;
  if (isOwner) {
    el.querySelector('.btn-delete').addEventListener('click', () => deleteBottiglia(id));
  }
  bottigliaList.appendChild(el);
}

function renderOwnerUI() {
  // Show/hide owner elements
  btnEditPresento.classList.toggle('hidden', !isOwner);
  fabInput.classList.toggle('hidden', !isOwner);
  // Bottiglia button: visible only to logged-in non-owners
  if (btnMandaBottiglia) {
    btnMandaBottiglia.classList.toggle('hidden', !currentUser || isOwner);
  }
  // Avatar click for upload
  if (isOwner) {
    avatarWrap.style.cursor = 'pointer';
    avatarWrap.title = 'Cambia foto';
  }
}

// ---- Upload avatar ----
avatarWrap.addEventListener('click', () => {
  if (!isOwner) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('upload_preset', CLOUDINARY_PRESET);
    try {
      const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: fd });
      const json = await res.json();
      const url = json.secure_url;
      await updateDoc(doc(db, 'utenti', profileUid), { fotoProfilo: url });
      avatarImg.src = url;
      avatarImg.classList.remove('hidden');
      avatarWrap.querySelector('.avatar-emoji').classList.add('hidden');
    } catch (e) { alert('Errore upload foto: ' + e.message); }
  };
  input.click();
});

// ---- Diario modal ----
fabInput.addEventListener('click', () => {
  modalDiarioText.value = '';
  modalDiario.classList.remove('hidden');
});
btnCancelDiario.addEventListener('click', () => modalDiario.classList.add('hidden'));
btnSaveDiario.addEventListener('click', async () => {
  const testo = modalDiarioText.value.trim();
  if (!testo || !currentUser) return;
  btnSaveDiario.disabled = true;
  try {
    const newDoc = await addDoc(collection(db, 'diario'), {
      uidRagazzo: profileUid,
      testo,
      immagineUrl: null,
      createdAt: serverTimestamp()
    });
    modalDiario.classList.add('hidden');
    // Optimistic render
    const tempDiv = document.createElement('div');
    tempDiv.className = 'card-diario';
    tempDiv.innerHTML = `<div class="diario-data">Adesso</div><div>${testo}</div>`;
    diarioList.prepend(tempDiv);
    const emptyMsg = diarioList.querySelector('.empty-msg');
    if (emptyMsg) emptyMsg.remove();
  } catch (e) { alert('Errore: ' + e.message); }
  btnSaveDiario.disabled = false;
});

// ---- Mi Presento modal ----
btnEditPresento.addEventListener('click', () => {
  modalPresento.classList.remove('hidden');
});
btnCancelPresento.addEventListener('click', () => modalPresento.classList.add('hidden'));
btnSavePresento.addEventListener('click', async () => {
  const testo = modalPresentoText.value.trim();
  if (!currentUser) return;
  btnSavePresento.disabled = true;
  try {
    await updateDoc(doc(db, 'utenti', profileUid), { miPresento: testo });
    miPresentoText.textContent = testo || 'Ancora nessuna presentazione...';
    miPresentoText.classList.toggle('mi-presento-empty', !testo);
    modalPresento.classList.add('hidden');
  } catch (e) { alert('Errore: ' + e.message); }
  btnSavePresento.disabled = false;
});

// ---- Bottiglia modal ----
if (btnMandaBottiglia) {
  btnMandaBottiglia.addEventListener('click', () => {
    modalBottigliaText.value = '';
    modalBottiglia.classList.remove('hidden');
  });
}
btnCancelBottiglia.addEventListener('click', () => modalBottiglia.classList.add('hidden'));
btnSaveBottiglia.addEventListener('click', async () => {
  const testo = modalBottigliaText.value.trim();
  if (!testo || !currentUser) return;
  btnSaveBottiglia.disabled = true;
  try {
    await addDoc(collection(db, 'messaggiBottiglia'), {
      uidMittente: currentUser.uid,
      nomeMittente: currentUser.displayName || currentUser.email || 'Anonimo',
      uidDestinatario: profileUid,
      testo,
      createdAt: serverTimestamp()
    });
    modalBottiglia.classList.add('hidden');
    alert('Messaggio inviato! 🍾');
  } catch (e) { alert('Errore: ' + e.message); }
  btnSaveBottiglia.disabled = false;
});

// ---- Delete ----
async function deleteDiario(id) {
  if (!confirm('Eliminare questa voce del diario?')) return;
  try {
    await deleteDoc(doc(db, 'diario', id));
    document.querySelector(`.card-diario[data-id="${id}"]`)?.remove();
    if (!diarioList.querySelector('.card-diario')) {
      diarioList.innerHTML = '<p class="empty-msg">Il diario è ancora vuoto...</p>';
    }
  } catch (e) { alert('Errore: ' + e.message); }
}

async function deleteBottiglia(id) {
  if (!confirm('Eliminare questo messaggio?')) return;
  try {
    await deleteDoc(doc(db, 'messaggiBottiglia', id));
    document.querySelector(`.card-bottiglia[data-id="${id}"]`)?.remove();
    if (!bottigliaList.querySelector('.card-bottiglia')) {
      bottigliaList.innerHTML = '<p class="empty-msg">Nessun messaggio in bottiglia ancora 🍾</p>';
    }
  } catch (e) { alert('Errore: ' + e.message); }
}

// ---- Helpers ----
function formatDate(date) {
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
}

// ---- Close modal on overlay click ----
[modalDiario, modalPresento, modalBottiglia].forEach(m => {
  m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
});

init();
