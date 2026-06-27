// robinson-modal-profilo.js — modal stack: scelta → carta|diario → giorno
import { db, auth, ADMIN_UID } from './robinson-firebase.js';
import { esc, uploadOne } from './robinson-utils.js';
import {
  doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc,
  collection, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Stato modulo ──────────────────────────────────────────────────────────
let _currentUser = null;
let _stack = [];
let _modal = null;
let _content = null;
let _cartaParams = null;

const EMOJIS = ['❤️','😂','👏','🔥','😢'];

const METEO_INTERP = {
  '🌞': 'Giornata piena di luce',
  '🌤️': 'Abbastanza bene',
  '⛅': 'Così così',
  '🌧️': 'Momenti difficili',
  '⛈️': 'Giornata pesante',
  '🌪️': 'Tutto sottosopra',
  '🌈': "Ce l'ha fatta nonostante tutto",
  '⭐': 'Momento speciale'
};

// ── Init ──────────────────────────────────────────────────────────────────
export function init(currentUser) {
  _currentUser = currentUser;
  if (!document.getElementById('rmp-modal')) _createModal();
}

function _createModal() {
  // CSS
  const style = document.createElement('style');
  style.textContent = `
    .rmp-scelta-btn {
      width:100%; padding:16px; margin-bottom:10px;
      background:#faf7f0; border:1.5px solid #c8860a; border-radius:8px;
      cursor:pointer; font-family:'Playfair Display',serif; font-size:16px;
      color:#1a3a5c; text-align:left; display:flex; flex-direction:column; gap:4px;
      transition:background 0.2s;
    }
    .rmp-scelta-btn:hover { background:#ede8dc; }
    .rmp-scelta-sub { font-family:'Lora',serif; font-size:11px; color:#888; font-style:italic; font-weight:normal; }
    .rmp-acc-toggle {
      background:#1a3a5c; color:#c8860a; font-family:'Playfair Display',serif;
      padding:10px 12px; font-size:0.82rem; font-weight:700; cursor:pointer;
      border-radius:4px; display:flex; justify-content:space-between; align-items:center;
      margin-top:8px;
    }
    .rmp-acc-body {
      display:none; background:#faf7f0; padding:10px 12px;
      border:1px solid #c8860a40; border-top:none; border-radius:0 0 4px 4px;
    }
    .rmp-back-btn {
      background:none; border:none; color:#c8860a; font-size:1.1rem; cursor:pointer; padding:0 6px 0 0;
    }
    .rmp-np-media-btn {
      background:#faf7f0; border:1.5px solid #c8b89a; border-radius:20px;
      padding:5px 12px; cursor:pointer; font-family:'Lora',serif; font-size:0.8rem; color:#1a3a5c;
    }
    .rmp-cal-cell {
      aspect-ratio:1; display:flex; align-items:center; justify-content:center;
      border-radius:50%; font-size:13px; font-family:'Lora',serif;
    }
    .rmp-cal-cell.compilato { background:#c8860a; color:#fff; cursor:pointer; font-weight:500; }
    .rmp-cal-cell.compilato:hover { background:#a06808; }
    .rmp-cal-cell.oggi { outline:2px solid #1a3a5c; }
  `;
  document.head.appendChild(style);

  // Modal DOM
  const m = document.createElement('div');
  m.id = 'rmp-modal';
  m.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:1000;overflow-y:auto;padding:20px 12px;';
  m.innerHTML = `
    <div id="rmp-box" style="background:#f5f0e8;background-image:radial-gradient(circle,#c8b89a22 1px,transparent 1px);background-size:20px 20px;max-width:480px;margin:0 auto;border-radius:12px;position:relative;overflow:hidden;">
      <button id="rmp-close" style="position:absolute;top:10px;right:12px;background:none;border:none;font-size:1.4rem;cursor:pointer;color:#1a3a5c;z-index:10;">✕</button>
      <div id="rmp-content"></div>
    </div>`;
  document.body.appendChild(m);
  _modal = m;
  _content = document.getElementById('rmp-content');

  document.getElementById('rmp-close').addEventListener('click', _chiudi);
  m.addEventListener('click', e => { if (e.target === m) _chiudi(); });
  window.addEventListener('popstate', () => { if (_modal.style.display !== 'none') _chiudi(); });

  // Accordion delegation
  document.addEventListener('click', e => {
    const toggle = e.target.closest('.rmp-acc-toggle');
    if (!toggle) return;
    const body = toggle.nextElementSibling;
    if (body?.classList.contains('rmp-acc-body')) {
      body.style.display = body.style.display === 'block' ? 'none' : 'block';
      const arrow = toggle.querySelector('.rmp-arr');
      if (arrow) arrow.textContent = body.style.display === 'block' ? '▲' : '▼';
    }
  });
}

function _chiudi() {
  _modal.style.display = 'none';
  _stack = [];
  if (history.state?.rmpModal) history.back();
}

// ── Navigazione ───────────────────────────────────────────────────────────
export async function apriModal(uid, params = {}) {
  _stack = [];
  _modal.style.display = 'block';
  _loading();
  history.pushState({ rmpModal: true, uid }, '', location.href);

  try {
    const [snapN, snapU] = await Promise.all([
      getDoc(doc(db, 'robinson_naufraghi', uid)),
      getDoc(doc(db, 'utenti', uid))
    ]);
    const dN = snapN.exists() ? snapN.data() : {};
    const dU = snapU.exists() ? snapU.data() : {};
    const foto = dN.fotoProfilo || dU.fotoProfilo || dU.photoURL || params.foto || '';
    const nome = dN.nome || dU.nome || dU.displayName || params.nome || 'Naufrago';
    const ruolo = params.ruolo || dN.ruolo || dU.ruolo || '';
    await _push('scelta', { uid, nome, foto, ruolo });
  } catch(e) {
    _content.innerHTML = `<div style="padding:20px;color:red;">Errore: ${esc(e.message)}</div>`;
  }
}

async function _push(nome, params) {
  _stack.push({ nome, params });
  await _render(nome, params);
}

async function _back() {
  _stack.pop();
  const prev = _stack[_stack.length - 1];
  await _render(prev.nome, prev.params);
}
window._rmpBack = () => _back();

function _loading() {
  _content.innerHTML = '<div style="padding:40px;text-align:center;color:#1a3a5c;">⏳</div>';
}

async function _render(nome, params) {
  _loading();
  if (nome === 'scelta') await _scelta(params);
  else if (nome === 'carta') await _carta(params);
  else if (nome === 'diario') await _diario(params);
  else if (nome === 'giorno') await _giorno(params);
}

// ── Helpers ───────────────────────────────────────────────────────────────
const _isAdmin = () => _currentUser?.uid === ADMIN_UID;

function _header(foto, nome, ruolo, backBtn = false) {
  const fotoHtml = foto
    ? `<img src="${esc(foto)}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #c8860a;flex-shrink:0;">`
    : '<div style="width:56px;height:56px;border-radius:50%;background:#c8b89a;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;">⚓</div>';
  return `<div style="background:#1a3a5c;padding:16px;display:flex;align-items:center;gap:10px;border-radius:12px 12px 0 0;">
    ${backBtn ? '<button class="rmp-back-btn" onclick="window._rmpBack()">←</button>' : ''}
    ${fotoHtml}
    <div style="min-width:0;">
      <div style="font-family:\'Playfair Display\',serif;font-size:1.05rem;font-weight:700;color:#f5f0e8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(nome)}</div>
      ${ruolo ? `<div style="font-size:0.72rem;color:#c8b89a;margin-top:2px;">${esc(ruolo)}</div>` : ''}
    </div>
  </div>`;
}

function _acc(titolo, contenuto) {
  if (!contenuto?.trim()) return '';
  return `<div class="rmp-acc-toggle">${titolo} <span class="rmp-arr">▼</span></div>
    <div class="rmp-acc-body">${contenuto}</div>`;
}

function _riga(label, val) {
  return val ? `<div style="margin-bottom:6px;"><span style="font-size:0.72rem;color:#1a3a5c;font-weight:600;">${label}:</span> <span style="font-size:0.86rem;">${esc(val)}</span></div>` : '';
}

function _fmtGiorno(key) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const gg = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  const mm = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  return `${gg[dt.getDay()]} ${d} ${mm[m-1]} ${y}`;
}

function _nomeMese(y, m) {
  const mm = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  return `${mm[m]} ${y}`;
}

// ── SCELTA ────────────────────────────────────────────────────────────────
async function _scelta({ uid, nome, foto, ruolo }) {
  _content.innerHTML = `
    ${_header(foto, nome, ruolo, false)}
    <div style="padding:20px;">
      <button class="rmp-scelta-btn" id="rmp-btn-ci">
        🪪 La Carta d'Identità
        <span class="rmp-scelta-sub">Chi sono, cosa mi porto, la mia storia</span>
      </button>
      <button class="rmp-scelta-btn" id="rmp-btn-d">
        📖 Il Diario
        <span class="rmp-scelta-sub">I giorni sull'isola</span>
      </button>
    </div>`;
  document.getElementById('rmp-btn-ci').onclick = () => _push('carta', { uid, nome, foto, ruolo });
  document.getElementById('rmp-btn-d').onclick = () => _push('diario', { uid, nome, foto, ruolo });
}

// ── CARTA D'IDENTITÀ ─────────────────────────────────────────────────────
async function _carta({ uid, nome, foto, ruolo }) {
  _cartaParams = { uid, nome, foto, ruolo };
  const isOwner = _currentUser?.uid === uid;

  _content.innerHTML = `
    ${_header(foto, nome, ruolo, true)}
    <div id="rmp-ci-body" style="padding:16px;"><div style="text-align:center;">⏳</div></div>`;

  const ciBody = document.getElementById('rmp-ci-body');

  try {
    const snapCI = await getDoc(doc(db, 'robinson_naufraghi', uid, 'carta_identita', 'dati'));
    const ci = snapCI.exists() ? snapCI.data() : null;

    let html = '';
    if (!ci) {
      html = '<div style="text-align:center;color:#1a3a5c;font-style:italic;padding:12px;">Carta d\'Identità non ancora compilata.</div>';
    } else {
      const treParole = (ci.treParole||[]).filter(Boolean).join(' · ');
      let ritratto = treParole ? `<div style="margin-bottom:8px;font-size:0.9rem;font-style:italic;color:#1a3a5c;">"${esc(treParole)}"</div>` : '';
      ritratto += _riga('Difficoltà', ci.difficolta) + _riga('Pregio', ci.pregio) + _riga('Vorrei imparare', ci.vorreiImparare) + _riga('So fare bene', ci.soFareBene);

      let bussola = _riga('Cosa mi rende felice', ci.rendeFelice) + _riga('Cosa mi fa arrabbiare', ci.faArrabbiare) + _riga('Quando sono triste', ci.quandoTriste);

      const persone = (ci.persone||[]).filter(Boolean).join(', ');
      const qualita = (ci.qualita||[]).join(', ');

      const ID_KEYS = ['libro','canzone','film','serie','piatto','dolce','alimento','bevanda','persona','animale','gioco','sport','colore','luogo','casa','oggetto_caro','oggetto_utile','foto','parola','ricordo','sogno','qualita','valore','famoso','personaggio','pianta','profumo','momento','emozione','una_cosa'];
      const ID_LABELS = {'libro':'📚 Libro','canzone':'🎵 Canzone','film':'🎬 Film','serie':'📺 Serie','piatto':'🍕 Piatto','dolce':'🍰 Dolce','alimento':'🍎 Alimento','bevanda':'🥤 Bevanda','persona':'👤 Persona','animale':'🐶 Animale','gioco':'🎮 Gioco','sport':'⚽ Sport','colore':'🎨 Colore','luogo':'🌳 Luogo','casa':'🏠 Casa','oggetto_caro':'🧸 Oggetto caro','oggetto_utile':'🎒 Oggetto utile','foto':'📷 Foto','parola':'💬 Parola','ricordo':'❤️ Ricordo','sogno':'🌟 Sogno','qualita':'💪 Qualità','valore':'🤝 Valore','famoso':'😂 Famoso/a','personaggio':'🎭 Personaggio','pianta':'🌴 Pianta','profumo':'🌊 Profumo','momento':'⏰ Momento','emozione':'🌦️ Emozione','una_cosa':'⭐ La cosa più importante'};
      const id = ci.isolaDeserta || {};
      let isolaHtml = '';
      if (ID_KEYS.some(k => id[k]) || id.altro) {
        isolaHtml = ID_KEYS.filter(k => id[k]).map(k => _riga(ID_LABELS[k], id[k])).join('');
        if (id.altro) isolaHtml += _riga('✏️ Altro', id.altro);
      }

      html += _acc('🖼️ Ritratto di Me', ritratto);
      html += _acc('🧭 La Mia Bussola', bussola);
      html += _acc('🤝 Le Mie Risorse', _riga('Persone su cui conto', persone) + _riga('Le mie qualità', qualita));
      html += _acc('⚔️ La Mia Sfida', _riga('', ci.sfida));
      html += _acc('💬 Il Mio Motto', ci.motto ? `<div style="font-style:italic;font-size:0.9rem;">"${esc(ci.motto)}"</div>` : '');
      if (isolaHtml) html += _acc("🏝️ Cosa mi porto sull'isola", isolaHtml);

      if (ci.firma) html += `<div style="text-align:center;margin:16px 0 8px;font-family:'Dancing Script',cursive;font-size:1.4rem;color:#1a3a5c;">${esc(ci.firma)}</div>`;
      html += `<div style="width:80px;height:80px;border:3px solid #c8860a;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;margin:16px auto 8px;opacity:0.4;transform:rotate(-15deg);">
        <div style="font-size:0.42rem;font-weight:700;color:#1a3a5c;letter-spacing:0.12em;text-align:center;line-height:1.4;">🌴<br>ROBINSON<br>REPUBLIC</div>
      </div>`;
    }

    ciBody.innerHTML = html;

    // Notte prima di partire
    await _nottePartenza(uid, isOwner, ciBody);

    // Dicono di me
    await _diconoDiMe(uid, ciBody);

  } catch(e) {
    ciBody.innerHTML = `<div style="color:red;padding:16px;">Errore: ${esc(e.message)}</div>`;
  }
}

// ── NOTTE PRIMA DI PARTIRE ────────────────────────────────────────────────
async function _nottePartenza(uid, isOwner, container) {
  const snapNP = await getDoc(doc(db, 'robinson_naufraghi', uid, 'notte_partenza', 'dati')).catch(() => null);
  const np = snapNP?.exists() ? snapNP.data() : null;
  const salvato = np?.salvato === true;

  let bodyHtml = '';

  if (salvato) {
    if (np.testo) bodyHtml += `<div style="font-style:italic;font-size:0.88rem;line-height:1.6;white-space:pre-wrap;color:#2c1810;margin-bottom:10px;">${esc(np.testo)}</div>`;
    if (np.videoUrl) bodyHtml += `<video src="${esc(np.videoUrl)}" controls style="width:100%;border-radius:6px;margin-bottom:8px;"></video>`;
    if (np.audioUrl) bodyHtml += `<audio src="${esc(np.audioUrl)}" controls style="width:100%;margin-bottom:8px;"></audio>`;
    if (_isAdmin()) bodyHtml += `<button id="rmp-np-sblocca" style="background:#c8860a;color:#1a3a5c;border:none;padding:6px 14px;border-radius:20px;cursor:pointer;font-family:'Lora',serif;font-size:12px;">🔓 Modifica (Admin)</button>`;
  } else if (isOwner || _isAdmin()) {
    bodyHtml = `
      <div style="font-size:0.8rem;color:#8a6a3a;margin-bottom:8px;font-style:italic;">Cosa mi aspetto da questa esperienza?</div>
      <textarea id="rmp-np-testo" rows="3" placeholder="Scrivi qui..." style="width:100%;padding:8px 10px;border:1.5px solid #c8b89a;border-radius:6px;font-family:'Lora',serif;font-size:0.85rem;background:#fff8ee;resize:vertical;box-sizing:border-box;"></textarea>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;">
        <button class="rmp-np-media-btn" id="rmp-np-vup">📹 Video</button>
        <button class="rmp-np-media-btn" id="rmp-np-vrec">📷 Registra video</button>
        <button class="rmp-np-media-btn" id="rmp-np-aup">🎵 Audio</button>
        <button class="rmp-np-media-btn" id="rmp-np-arec">🎤 Registra audio</button>
      </div>
      <input type="file" id="rmp-np-vi" accept="video/*" style="display:none;">
      <input type="file" id="rmp-np-vri" accept="video/*" capture="environment" style="display:none;">
      <input type="file" id="rmp-np-ai" accept="audio/*" style="display:none;">
      <input type="file" id="rmp-np-ari" accept="audio/*" capture="microphone" style="display:none;">
      <div id="rmp-np-preview"></div>
      <div id="rmp-np-prog" style="display:none;font-size:0.8rem;color:#c8860a;margin:4px 0;">⏳ Caricamento...</div>
      <button id="rmp-np-salva" style="width:100%;background:#1a3a5c;color:#c8860a;border:none;border-radius:6px;padding:9px;cursor:pointer;font-family:'Lora',serif;font-size:0.88rem;margin-top:4px;">💾 Salva</button>
      <div id="rmp-np-msg" style="margin-top:4px;font-size:0.75rem;"></div>`;
  } else {
    bodyHtml = '<div style="color:#999;font-style:italic;font-size:0.8rem;text-align:center;padding:8px;">Non ancora compilato.</div>';
  }

  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="rmp-acc-toggle">🌅 Notte prima di partire <span class="rmp-arr">▼</span></div>
    <div class="rmp-acc-body">${bodyHtml}</div>`;
  container.appendChild(wrap);

  if (!salvato && (isOwner || _isAdmin())) {
    let _vidUrl = null, _audUrl = null;

    const wire = (btnId, inpId, type) => {
      const btn = document.getElementById(btnId);
      const inp = document.getElementById(inpId);
      if (!btn || !inp) return;
      btn.onclick = () => inp.click();
      inp.onchange = async () => {
        const file = inp.files[0];
        if (!file) return;
        const prog = document.getElementById('rmp-np-prog');
        prog.style.display = 'block';
        try {
          const url = await uploadOne(file, 'notte_partenza');
          if (type === 'video') { _vidUrl = url; }
          else { _audUrl = url; }
          const pv = document.getElementById('rmp-np-preview');
          if (type === 'video') pv.innerHTML = `<video src="${esc(url)}" controls style="width:100%;border-radius:6px;margin-top:4px;"></video>`;
          else pv.innerHTML += `<audio src="${esc(url)}" controls style="width:100%;margin-top:4px;display:block;"></audio>`;
          prog.style.display = 'none';
        } catch(e) {
          prog.textContent = 'Errore: ' + e.message;
        }
      };
    };
    wire('rmp-np-vup','rmp-np-vi','video');
    wire('rmp-np-vrec','rmp-np-vri','video');
    wire('rmp-np-aup','rmp-np-ai','audio');
    wire('rmp-np-arec','rmp-np-ari','audio');

    document.getElementById('rmp-np-salva')?.addEventListener('click', async () => {
      const testo = document.getElementById('rmp-np-testo')?.value.trim() || '';
      const msg = document.getElementById('rmp-np-msg');
      try {
        await setDoc(doc(db, 'robinson_naufraghi', uid, 'notte_partenza', 'dati'), {
          testo, videoUrl: _vidUrl || null, audioUrl: _audUrl || null,
          salvato: true, salvatoAt: serverTimestamp()
        });
        msg.style.color = '#c8860a'; msg.textContent = '✅ Salvato!';
        setTimeout(() => { if (_cartaParams) _render('carta', _cartaParams); }, 1200);
      } catch(e) { msg.textContent = 'Errore: ' + e.message; }
    });
  }

  if (salvato && _isAdmin()) {
    document.getElementById('rmp-np-sblocca')?.addEventListener('click', async () => {
      await updateDoc(doc(db, 'robinson_naufraghi', uid, 'notte_partenza', 'dati'), { salvato: false });
      if (_cartaParams) await _render('carta', _cartaParams);
    });
  }
}

// ── DICONO DI ME ─────────────────────────────────────────────────────────
async function _diconoDiMe(uid, container) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding-bottom:16px;';

  const box = document.createElement('div');
  box.style.cssText = 'border:2px dashed #c8860a;border-radius:8px;margin:12px 0;overflow:hidden;';
  box.innerHTML = `<div style="background:#1a3a5c;color:#c8860a;font-family:'Playfair Display',serif;padding:8px 12px;font-size:0.82rem;font-weight:700;">💬 Dicono di me</div>`;

  const body = document.createElement('div');
  body.style.cssText = 'background:#faf7f0;padding:10px 12px;';

  if (_currentUser && _currentUser.uid !== uid) {
    const formDiv = document.createElement('div');
    formDiv.style.marginBottom = '12px';
    formDiv.innerHTML = `
      <textarea id="rdm-t-${uid}" rows="2" placeholder="Scrivi qualcosa..." style="width:100%;padding:7px 9px;border:1.5px solid #c8b89a;border-radius:6px;font-family:'Lora',serif;font-size:0.85rem;background:#fff8ee;resize:vertical;box-sizing:border-box;"></textarea>
      <button id="rdm-pub-${uid}" style="margin-top:7px;width:100%;background:#1a3a5c;color:#c8860a;border:none;border-radius:6px;padding:7px;cursor:pointer;font-family:'Lora',serif;font-size:0.82rem;">📨 Pubblica</button>
      <div id="rdm-msg-${uid}" style="margin-top:4px;font-size:0.75rem;"></div>`;
    body.appendChild(formDiv);

    const feedDiv = document.createElement('div');
    body.appendChild(feedDiv);
    box.appendChild(body); wrap.appendChild(box); container.appendChild(wrap);

    formDiv.querySelector(`#rdm-pub-${uid}`).addEventListener('click', async () => {
      const testo = formDiv.querySelector(`#rdm-t-${uid}`).value.trim();
      if (!testo) return;
      let nomeA = _currentUser.displayName || ''; let fotoA = '';
      try { const su = await getDoc(doc(db, 'utenti', _currentUser.uid)); if (su.exists()) { nomeA = su.data().nome || nomeA; fotoA = su.data().fotoProfilo || ''; } } catch(_) {}
      await addDoc(collection(db, 'robinson_dicono', uid, 'posts'), {
        testo, mediaUrl:'', mediaType:'', autorId:_currentUser.uid, autoreNome:nomeA, autoreFoto:fotoA, timestamp:serverTimestamp()
      });
      formDiv.querySelector(`#rdm-t-${uid}`).value = '';
      const msg = formDiv.querySelector(`#rdm-msg-${uid}`);
      msg.style.color = '#c8860a'; msg.textContent = '✅ Pubblicato!';
      setTimeout(() => msg.textContent = '', 2000);
      await _diconoFeed(uid, feedDiv);
    });
    await _diconoFeed(uid, feedDiv);
  } else {
    const feedDiv = document.createElement('div');
    body.appendChild(feedDiv);
    box.appendChild(body); wrap.appendChild(box); container.appendChild(wrap);
    await _diconoFeed(uid, feedDiv);
  }
}

async function _diconoFeed(uid, container) {
  container.innerHTML = '<div style="text-align:center;font-size:0.8rem;color:#999;">⏳</div>';
  try {
    const snap = await getDocs(query(collection(db, 'robinson_dicono', uid, 'posts'), orderBy('timestamp','desc')));
    if (snap.empty) { container.innerHTML = '<div style="text-align:center;color:#999;font-style:italic;font-size:0.8rem;padding:8px;">Ancora nessun messaggio.</div>'; return; }
    container.innerHTML = '';
    for (const d of snap.docs) {
      const pid = d.id; const data = d.data();
      const nA = data.autoreNome || '?'; const fA = data.autoreFoto || '';
      const ds = data.timestamp?.toDate ? data.timestamp.toDate().toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'numeric'}) : '';
      const el = document.createElement('div');
      el.style.cssText = 'background:#fff8ee;border:1px solid #e0d0b0;border-radius:8px;padding:8px 10px;margin-bottom:8px;';
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
          ${fA?`<img src="${esc(fA)}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;border:1px solid #c8860a;">`:'<span style="font-size:0.9rem;">⚓</span>'}
          <span style="font-weight:600;font-size:0.8rem;color:#1a3a5c;">${esc(nA)}</span>
          <span style="font-size:0.68rem;color:#999;margin-left:auto;">${esc(ds)}</span>
        </div>
        ${data.testo?`<p style="font-size:0.85rem;color:#2c1810;margin:0 0 5px;white-space:pre-wrap;">${esc(data.testo)}</p>`:''}
        <div class="rdm-react-${uid}-${pid}" style="display:flex;gap:3px;flex-wrap:wrap;margin-top:4px;"></div>`;
      container.appendChild(el);
      await _loadReact(uid, pid, el.querySelector(`.rdm-react-${uid}-${pid}`));
    }
  } catch(e) { container.innerHTML = `<div style="color:red;font-size:0.78rem;">${esc(e.message)}</div>`; }
}

async function _loadReact(uid, pid, container) {
  if (!container) return;
  try {
    const snap = await getDocs(collection(db, 'robinson_dicono', uid, 'posts', pid, 'reactions'));
    const counts = {}; const myR = new Set();
    snap.forEach(d => { const e=d.data().emoji; counts[e]=(counts[e]||0)+1; if(_currentUser&&d.data().uid===_currentUser.uid) myR.add(e); });
    container.innerHTML = EMOJIS.map(e => {
      const c=counts[e]||0; const active=myR.has(e);
      return `<button class="rdm-rb" data-e="${e}" style="background:${active?'#c8860a22':'#f5f0e8'};border:1.5px solid ${active?'#c8860a':'#c8b89a'};border-radius:20px;padding:2px 7px;cursor:pointer;font-size:0.78rem;display:flex;align-items:center;gap:2px;">${e}${c>0?`<span style="font-size:0.68rem;color:#1a3a5c;">${c}</span>`:''}</button>`;
    }).join('');
    container.querySelectorAll('.rdm-rb').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!_currentUser) return;
        const e=btn.dataset.e; const rId=_currentUser.uid+'_'+e;
        const rRef=doc(db,'robinson_dicono',uid,'posts',pid,'reactions',rId);
        const rSnap=await getDoc(rRef);
        if(rSnap.exists()) await deleteDoc(rRef); else await setDoc(rRef,{uid:_currentUser.uid,emoji:e,timestamp:serverTimestamp()});
        await _loadReact(uid,pid,container);
      });
    });
  } catch(_) {}
}

// ── DIARIO / CALENDARIO ───────────────────────────────────────────────────
async function _diario({ uid, nome, foto, ruolo }) {
  const now = new Date();
  let year = now.getFullYear(); let month = now.getMonth();

  let savedDates = new Set();
  try {
    const snap = await getDocs(collection(db, 'robinson_diari', uid, 'posts'));
    snap.forEach(d => { if (d.data().salvato === true) savedDates.add(d.id); });
  } catch(_) {}

  const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  _content.innerHTML = `
    ${_header(foto, nome, ruolo, true)}
    <div style="padding:16px;">
      <div style="font-family:'Playfair Display',serif;font-size:1rem;font-weight:700;color:#1a3a5c;margin-bottom:14px;text-align:center;">📖 Il diario di ${esc(nome)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <button id="rmp-cal-prev" style="background:#1a3a5c;color:#c8860a;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1.1rem;line-height:1;">‹</button>
        <div id="rmp-cal-label" style="font-family:'Playfair Display',serif;font-weight:700;color:#1a3a5c;font-size:0.95rem;"></div>
        <button id="rmp-cal-next" style="background:#1a3a5c;color:#c8860a;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1.1rem;line-height:1;">›</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:6px;">
        ${['L','M','M','G','V','S','D'].map(g=>`<div style="text-align:center;font-size:0.65rem;color:#8a9ab0;font-weight:700;padding:4px 0;">${g}</div>`).join('')}
      </div>
      <div id="rmp-cal-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;"></div>
      ${savedDates.size===0?'<div style="text-align:center;color:#999;font-style:italic;font-size:0.85rem;margin-top:16px;">Nessun diario salvato ancora.</div>':''}
    </div>`;

  const renderCal = () => {
    const label = document.getElementById('rmp-cal-label');
    const grid = document.getElementById('rmp-cal-grid');
    if (!label || !grid) return;
    label.textContent = _nomeMese(year, month);

    const first = new Date(year, month, 1);
    const last = new Date(year, month+1, 0);
    let startCol = first.getDay() - 1; if (startCol < 0) startCol = 6;

    let html = '<div></div>'.repeat(startCol);
    for (let d = 1; d <= last.getDate(); d++) {
      const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const comp = savedDates.has(key);
      const oggi = key === todayStr;
      html += `<div class="rmp-cal-cell${comp?' compilato':''}${oggi?' oggi':''}"
        style="aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:13px;font-family:'Lora',serif;cursor:${comp?'pointer':'default'};color:${comp?'#fff':'#aaa'};background:${comp?'#c8860a':'transparent'};${oggi?'outline:2px solid #1a3a5c;':''};font-weight:${comp?'500':'400'};"
        data-key="${key}">${d}</div>`;
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.rmp-cal-cell.compilato').forEach(cell => {
      cell.addEventListener('click', () => _push('giorno', { uid, nome, foto, ruolo, dataKey: cell.dataset.key }));
    });
  };

  document.getElementById('rmp-cal-prev').onclick = () => { month--; if(month<0){month=11;year--;} renderCal(); };
  document.getElementById('rmp-cal-next').onclick = () => { month++; if(month>11){month=0;year++;} renderCal(); };
  renderCal();
}

// ── GIORNO ────────────────────────────────────────────────────────────────
async function _giorno({ uid, nome, foto, ruolo, dataKey }) {
  _content.innerHTML = `
    <div style="background:#1a3a5c;padding:14px 16px;display:flex;align-items:center;gap:10px;border-radius:12px 12px 0 0;">
      <button class="rmp-back-btn" onclick="window._rmpBack()">←</button>
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:0.98rem;font-weight:700;color:#f5f0e8;">📅 ${esc(_fmtGiorno(dataKey))}</div>
        <div style="font-size:0.72rem;color:#a0b4c8;margin-top:2px;">${esc(nome)}</div>
      </div>
    </div>
    <div id="rmp-g-body" style="padding:16px;"><div style="text-align:center;">⏳</div></div>`;

  try {
    const [snapP, snapI] = await Promise.all([
      getDoc(doc(db, 'robinson_diari', uid, 'posts', dataKey)),
      getDoc(doc(db, 'robinson_isola', uid, 'notti', dataKey))
    ]);
    const p = snapP.exists() ? snapP.data() : {};
    const r = p.riflessioni || {};
    const body = document.getElementById('rmp-g-body');
    const isAdm = _isAdmin();

    let html = '';
    if (p.titolo) html += `<div style="font-style:italic;font-family:'Lora',serif;font-size:1rem;color:#1a3a5c;text-align:center;margin-bottom:12px;">"${esc(p.titolo)}"</div>`;

    // A) La Giornata
    let gHtml = '';
    if (p.approdo) gHtml += `<div style="font-size:0.88rem;font-style:italic;line-height:1.6;white-space:pre-wrap;">${esc(p.approdo)}</div>`;
    html += _acc('📅 La Giornata', gHtml);

    // B) Meteo
    const mEmoji = p.meteoUmore || p.meteo || '';
    let mHtml = '';
    if (mEmoji) mHtml += `<div style="font-size:1.4rem;margin-bottom:8px;">${esc(mEmoji)}<span style="font-size:0.85rem;font-style:italic;color:#5a6a7a;margin-left:8px;">${esc(METEO_INTERP[mEmoji]||'')}</span></div>`;
    if (p.sensazione) mHtml += `<div style="font-size:0.88rem;font-style:italic;line-height:1.6;">${esc(p.sensazione)}</div>`;
    html += _acc("☀️ Meteo dell'umore", mHtml);

    // C) Emozioni
    const em = p.emozioni || {};
    let eHtml = '';
    const ENomi = {gioia:'Gioia',paura:'Paura',tristezza:'Tristezza',rabbia:'Rabbia',sorpresa:'Sorpresa',disgusto:'Disgusto',ansia:'Ansia',speranza:'Speranza'};
    Object.entries(ENomi).forEach(([k,l]) => {
      if (em[k]>0) eHtml += `<div style="margin-bottom:6px;font-size:0.88rem;"><span style="color:#1a3a5c;font-weight:600;">${l}:</span> <span style="color:#c8860a;">${'★'.repeat(em[k])}${'☆'.repeat(5-em[k])}</span></div>`;
    });
    if (p.seMare) eHtml += `<div style="margin-bottom:6px;font-size:0.88rem;"><span style="color:#1a3a5c;font-weight:600;">Se fossi il mare:</span> ${esc(p.seMare)}</div>`;
    if (p.bussola) eHtml += `<div style="margin-bottom:6px;font-size:0.88rem;"><span style="color:#1a3a5c;font-weight:600;">La bussola puntava verso:</span> ${esc(p.bussola)}</div>`;
    if (p.bussolaAltro) eHtml += `<div style="font-size:0.88rem;font-style:italic;margin-bottom:4px;">${esc(p.bussolaAltro)}</div>`;
    if (p.emozioniAltro) eHtml += `<div style="font-size:0.88rem;font-style:italic;color:#5a6a7a;">${esc(p.emozioniAltro)}</div>`;
    html += _acc('🧭 Emozioni', eHtml);

    // D) Riflessioni
    const RIF = [
      {k:'scoperto',kn:'scoperta',l:'🌴 Ho scoperto che...'},
      {k:'bello',kn:'momentoBello',l:'⭐ Il momento più bello'},
      {k:'scoglio',kn:'scoglio',l:'🦈 Lo scoglio incontrato'},
      {k:'tesoro',kn:'tesoro',l:'🐚 Il tesoro che mi porto'},
    ];
    let rfHtml = '';
    RIF.forEach(({k,kn,l}) => {
      const val = r[kn] || r[k];
      if (!val) return;
      const priv = typeof val==='object' ? val.privato : false;
      const testo = typeof val==='object' ? val.testo : val;
      if (priv && !isAdm) rfHtml += `<div style="margin-bottom:8px;"><span style="font-size:0.78rem;color:#8a6a3a;font-weight:600;">${l}</span><div style="font-size:11px;color:#8a6a3a;font-style:italic;margin-top:2px;">🔒 Contenuto privato</div></div>`;
      else if (testo) rfHtml += `<div style="margin-bottom:8px;"><span style="font-size:0.78rem;color:#1a3a5c;font-weight:600;">${l}</span><div style="font-size:0.88rem;font-style:italic;line-height:1.5;margin-top:2px;">${esc(testo)}</div></div>`;
    });
    // Falò
    if (r.falo) {
      const priv = r.falo.privato;
      if (priv && !isAdm) rfHtml += `<div style="margin-bottom:8px;"><span style="font-size:0.78rem;color:#8a6a3a;font-weight:600;">🔥 Falò della sera</span><div style="font-size:11px;color:#8a6a3a;font-style:italic;margin-top:2px;">🔒 Contenuto privato</div></div>`;
      else {
        const voci = Array.isArray(r.falo) ? r.falo : (r.falo.voci||[]);
        const altro = r.falo.altro||'';
        const elenco = [...voci,...(altro?[altro]:[])].join(', ');
        if (elenco) rfHtml += `<div style="margin-bottom:8px;"><span style="font-size:0.78rem;color:#1a3a5c;font-weight:600;">🔥 Falò della sera</span><div style="font-size:0.88rem;font-style:italic;line-height:1.5;margin-top:2px;">${esc(elenco)}</div></div>`;
      }
    }
    html += _acc('🌴 Riflessioni', rfHtml);

    // E) Tesori
    const media = p.media || [];
    let tHtml = '';
    media.forEach(m => {
      const type = m.type||m.mediaType||'';
      if (type==='image') tHtml += `<img src="${esc(m.url)}" style="max-width:100%;border-radius:6px;margin-bottom:8px;display:block;">`;
      else if (type==='video') tHtml += `<video src="${esc(m.url)}" controls style="max-width:100%;border-radius:6px;margin-bottom:8px;display:block;"></video>`;
      else if (type==='audio') tHtml += `<audio src="${esc(m.url)}" controls style="width:100%;margin-bottom:8px;display:block;"></audio>`;
    });
    html += _acc('📸 Tesori', tHtml);

    // F) Isola
    let iHtml = '';
    if (snapI.exists()) {
      const id = snapI.data();
      iHtml = `<div style="font-size:0.9rem;margin-bottom:6px;">${esc(id.luogoEmoji||'🗺️')} <strong>${esc(id.luogoNome||id.luogoId||'')}</strong></div>`;
      if (id.meteo) iHtml += `<div style="font-size:0.82rem;color:#5a6a7a;">Meteo isola: ${esc(id.meteo)}</div>`;
      if (id.pensiero) iHtml += `<div style="font-size:0.88rem;font-style:italic;margin-top:6px;">"${esc(id.pensiero)}"</div>`;
    } else {
      iHtml = '<div style="color:#999;font-style:italic;font-size:0.85rem;">Nessuna notte registrata sull\'isola.</div>';
    }
    html += _acc("🗺️ Isola", iHtml);

    body.innerHTML = html;
  } catch(e) {
    document.getElementById('rmp-g-body').innerHTML = `<div style="color:red;padding:16px;">${esc(e.message)}</div>`;
  }
}
