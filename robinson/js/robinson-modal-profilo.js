// robinson-modal-profilo.js — modal stack con 3 ruoli: proprietario | visitatore | admin
import { db, auth, ADMIN_UID, CLOUD_NAME, CLOUD_PRESET } from './robinson-firebase.js';
import { esc, uploadOne } from './robinson-utils.js';
import {
  doc, getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc,
  collection, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Stato ─────────────────────────────────────────────────────────────────
let _cu = null;       // currentUser
let _stack = [];
let _modal = null;
let _content = null;
let _cartaParams = null;

const EMOJIS = ['❤️','😂','👏','🔥','😢'];

const METEO_INTERP = {
  '🌞':'Giornata piena di luce','🌤️':'Abbastanza bene','⛅':'Così così',
  '🌧️':'Momenti difficili','⛈️':'Giornata pesante','🌪️':'Tutto sottosopra',
  '🌈':"Ce l'ha fatta nonostante tutto",'⭐':'Momento speciale'
};
const METEO_OPTS = ['🌞','🌤️','⛅','🌧️','⛈️','🌪️','🌈','⭐'];

const ID_KEYS = ['libro','canzone','film','serie','piatto','dolce','alimento','bevanda',
  'persona','animale','gioco','sport','colore','luogo','casa','oggetto_caro','oggetto_utile',
  'foto','parola','ricordo','sogno','qualita','valore','famoso','personaggio',
  'pianta','profumo','momento','emozione','una_cosa'];
const ID_LABELS = {
  'libro':'📚 Libro','canzone':'🎵 Canzone','film':'🎬 Film','serie':'📺 Serie',
  'piatto':'🍕 Piatto','dolce':'🍰 Dolce','alimento':'🍎 Alimento','bevanda':'🥤 Bevanda',
  'persona':'👤 Persona','animale':'🐶 Animale','gioco':'🎮 Gioco','sport':'⚽ Sport',
  'colore':'🎨 Colore','luogo':'🌳 Luogo','casa':'🏠 Casa','oggetto_caro':'🧸 Oggetto caro',
  'oggetto_utile':'🎒 Oggetto utile','foto':'📷 Foto','parola':'💬 Parola',
  'ricordo':'❤️ Ricordo','sogno':'🌟 Sogno','qualita':'💪 Qualità','valore':'🤝 Valore',
  'famoso':'😂 Famoso/a','personaggio':'🎭 Personaggio','pianta':'🌴 Pianta',
  'profumo':'🌊 Profumo','momento':'⏰ Momento','emozione':'🌦️ Emozione',
  'una_cosa':'⭐ La cosa più importante'
};

// ── Init / Export ─────────────────────────────────────────────────────────
export function init(currentUser) {
  _cu = currentUser;
  if (!document.getElementById('rmp-modal')) _createModal();
}

export async function apriModal(uid, params = {}) {
  _stack = [];
  _modal.style.display = 'block';
  _loading();
  history.pushState({ rmpModal:true, uid }, '', location.href);

  try {
    const ruolo = await _getRuolo(uid);
    const [snapN, snapU] = await Promise.all([
      getDoc(doc(db, 'robinson_naufraghi', uid)),
      getDoc(doc(db, 'utenti', uid))
    ]);
    const dN = snapN.exists() ? snapN.data() : {};
    const dU = snapU.exists() ? snapU.data() : {};
    const foto = dN.fotoRobinson || dN.fotoProfilo || dU.fotoProfilo || dU.photoURL || params.foto || '';
    const nome = dN.nome || dU.nome || dU.displayName || params.nome || 'Naufrago';
    const ruoloLabel = params.ruolo || dN.ruolo || dU.ruolo || '';
    await _push('scelta', { uid, nome, foto, ruolo, ruoloLabel });
  } catch(e) {
    _content.innerHTML = `<div style="padding:20px;color:red;">${esc(e.message)}</div>`;
  }
}

// ── Ruolo ─────────────────────────────────────────────────────────────────
async function _getRuolo(uid) {
  if (!_cu) return 'visitatore';
  if (_cu.uid === uid) return 'proprietario';
  if (_cu.uid === ADMIN_UID) return 'admin';
  try {
    const snap = await getDoc(doc(db, 'utenti', _cu.uid));
    if (snap.exists() && snap.data().ruolo === 'admin') return 'admin';
  } catch(_) {}
  return 'visitatore';
}
const _isAdmin = (ruolo) => ruolo === 'admin';
const _isOwner = (ruolo) => ruolo === 'proprietario';

// ── Navigazione ───────────────────────────────────────────────────────────
async function _push(nome, params) { _stack.push({ nome, params }); await _render(nome, params); }
async function _back() { _stack.pop(); const p = _stack[_stack.length-1]; await _render(p.nome, p.params); }
window._rmpBack = () => _back();
function _chiudi() { _modal.style.display='none'; _stack=[]; if(history.state?.rmpModal) history.back(); }
function _loading() { _content.innerHTML = '<div style="padding:40px;text-align:center;color:#1a3a5c;">⏳</div>'; }

async function _render(nome, params) {
  _loading();
  if (nome==='scelta')  await _scelta(params);
  else if (nome==='carta')  await _carta(params);
  else if (nome==='diario') await _diario(params);
  else if (nome==='giorno') await _giorno(params);
}

// ── Creazione modal DOM ────────────────────────────────────────────────────
function _createModal() {
  const style = document.createElement('style');
  style.textContent = `
    .rmp-scelta-btn {
      width:100%; padding:16px; margin-bottom:10px;
      background:#faf7f0; border:1.5px solid #c8860a; border-radius:8px;
      cursor:pointer; font-family:'Playfair Display',serif; font-size:15px;
      color:#1a3a5c; text-align:left; display:flex; flex-direction:column; gap:4px;
      transition:background 0.2s;
    }
    .rmp-scelta-btn:hover { background:#ede8dc; }
    .rmp-scelta-btn.muted { border-color:#aaa; opacity:0.82; }
    .rmp-scelta-sub { font-family:'Lora',serif;font-size:11px;color:#888;font-style:italic;font-weight:normal; }
    .rmp-acc-toggle {
      background:#1a3a5c;color:#c8860a;font-family:'Playfair Display',serif;
      padding:10px 12px;font-size:0.82rem;font-weight:700;cursor:pointer;
      border-radius:4px;display:flex;justify-content:space-between;align-items:center;margin-top:8px;
    }
    .rmp-acc-body { display:none;background:#faf7f0;padding:10px 12px;border:1px solid #c8860a40;border-top:none;border-radius:0 0 4px 4px; }
    .rmp-back-btn { background:none;border:none;color:#c8860a;font-size:1.1rem;cursor:pointer;padding:0 6px 0 0; }
    .rmp-field { width:100%;padding:8px 10px;border:1.5px solid #c8b89a;border-radius:6px;font-family:'Lora',serif;font-size:0.85rem;background:#fff8ee;box-sizing:border-box;color:#2c1810; }
    .rmp-field:focus { outline:none;border-color:#c8860a; }
    .rmp-label { font-size:0.72rem;color:#1a3a5c;font-weight:700;display:block;margin:8px 0 3px; }
    .rmp-save-btn { width:100%;background:#1a3a5c;color:#c8860a;border:none;border-radius:8px;padding:12px;cursor:pointer;font-family:'Playfair Display',serif;font-size:0.95rem;font-weight:700;margin-top:12px; }
    .rmp-save-btn:hover { background:#0f2238; }
    .rmp-admin-btn { background:#c8860a;color:#1a3a5c;border:none;padding:6px 14px;border-radius:20px;cursor:pointer;font-family:'Lora',serif;font-size:12px;margin-top:6px; }
    .rmp-req-btn { background:#faf7f0;color:#1a3a5c;border:1.5px solid #c8b89a;padding:6px 14px;border-radius:20px;cursor:pointer;font-family:'Lora',serif;font-size:12px;margin-top:6px; }
    .rmp-banner { background:rgba(200,134,10,0.12);color:#1a3a5c;border:1px solid #c8860a40;border-radius:6px;padding:8px 12px;font-size:0.8rem;font-style:italic;margin:8px 0; }
    .rmp-np-media-btn { background:#faf7f0;border:1.5px solid #c8b89a;border-radius:20px;padding:5px 12px;cursor:pointer;font-family:'Lora',serif;font-size:0.8rem;color:#1a3a5c; }
    .rmp-lk-btn { background:transparent;border:none;font-size:18px;cursor:pointer;padding:2px 6px;border-radius:50%; }
    .rmp-meteo-opt { background:#fff;border:1.5px solid #c8b89a;border-radius:20px;padding:4px 10px;cursor:pointer;font-size:14px; }
    .rmp-meteo-opt.sel { background:#f5ead5;border-color:#c8860a; }
    .rmp-stella { font-size:1.2rem;cursor:pointer;color:#ccc; }
    .rmp-stella.sel { color:#c8860a; }
    .rmp-cal-cell { aspect-ratio:1;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:13px;font-family:'Lora',serif; }
    .rmp-cal-cell.compilato { background:#c8860a;color:#fff;cursor:pointer;font-weight:500; }
    .rmp-cal-cell.compilato:hover { background:#a06808; }
    .rmp-cal-cell.oggi-owner { background:#3a8a4a;color:#fff;cursor:pointer;font-weight:600; }
    .rmp-cal-cell.oggi-owner:hover { background:#2a6a3a; }
    .rmp-cal-cell.oggi { outline:2px solid #1a3a5c; }
    .rmp-cambia-foto-admin {
      position:absolute; bottom:0; right:0;
      background:#c8860a; color:#fff; border-radius:50%;
      width:24px; height:24px;
      display:flex; align-items:center; justify-content:center;
      font-size:12px; cursor:pointer; line-height:1;
      border:2px solid #1a3a5c;
    }
    .rmp-toast {
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      background:#1a3a5c; color:#c8860a; padding:10px 20px; border-radius:20px;
      font-family:'Lora',serif; font-size:0.85rem; z-index:9999;
      animation: rmpFadeOut 2.5s forwards;
    }
    @keyframes rmpFadeOut { 0%{opacity:1} 70%{opacity:1} 100%{opacity:0} }
  `;
  document.head.appendChild(style);

  const m = document.createElement('div');
  m.id = 'rmp-modal';
  m.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.72);z-index:1000;overflow-y:auto;padding:20px 12px;';
  m.innerHTML = `<div id="rmp-box" style="background:#f5f0e8;background-image:radial-gradient(circle,#c8b89a22 1px,transparent 1px);background-size:20px 20px;max-width:480px;margin:0 auto;border-radius:12px;position:relative;overflow:hidden;">
    <button id="rmp-close" style="position:absolute;top:10px;right:12px;background:none;border:none;font-size:1.4rem;cursor:pointer;color:#1a3a5c;z-index:10;">✕</button>
    <div id="rmp-content"></div>
  </div>`;
  document.body.appendChild(m);
  _modal = m;
  _content = document.getElementById('rmp-content');

  document.getElementById('rmp-close').addEventListener('click', _chiudi);
  m.addEventListener('click', e => { if(e.target===m) _chiudi(); });
  window.addEventListener('popstate', () => { if(_modal.style.display!=='none') _chiudi(); });

  document.addEventListener('click', e => {
    const t = e.target.closest('.rmp-acc-toggle');
    if (!t) return;
    const b = t.nextElementSibling;
    if (b?.classList.contains('rmp-acc-body')) {
      b.style.display = b.style.display==='block' ? 'none' : 'block';
      const a = t.querySelector('.rmp-arr');
      if (a) a.textContent = b.style.display==='block' ? '▲' : '▼';
    }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────
function _header(foto, nome, ruoloLabel, back=false, uid='', ruolo='') {
  const fotoImg = foto
    ? `<img class="modal-avatar" src="${esc(foto)}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:2px solid #c8860a;flex-shrink:0;">`
    : '<div class="modal-avatar" style="width:56px;height:56px;border-radius:50%;background:#c8b89a;display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0;">⚓</div>';
  const adminBtn = (ruolo === 'admin' && uid)
    ? `<label class="rmp-cambia-foto-admin" title="Cambia foto Robinson">📷<input type="file" accept="image/*" style="display:none" onchange="window._rmpCambiaFoto(this,'${esc(uid)}')"></label>`
    : '';
  const fotoHtml = `<div style="position:relative;flex-shrink:0;">${fotoImg}${adminBtn}</div>`;
  return `<div style="background:#1a3a5c;padding:16px;display:flex;align-items:center;gap:10px;border-radius:12px 12px 0 0;">
    ${back?'<button class="rmp-back-btn" onclick="window._rmpBack()">←</button>':''}
    ${fotoHtml}
    <div style="min-width:0;">
      <div style="font-family:'Playfair Display',serif;font-size:1.05rem;font-weight:700;color:#f5f0e8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(nome)}</div>
      ${ruoloLabel?`<div style="font-size:0.72rem;color:#c8b89a;margin-top:2px;">${esc(ruoloLabel)}</div>`:''}
    </div>
  </div>`;
}

function _mostraToast(msg) {
  const t = document.createElement('div'); t.className='rmp-toast'; t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(),2600);
}

window._rmpCambiaFoto = async function(input, uid) {
  if (!input.files[0]) return;
  _mostraToast('⏳ Caricamento foto...');
  try {
    const fd = new FormData();
    fd.append('file', input.files[0]);
    fd.append('upload_preset', CLOUD_PRESET);
    fd.append('folder', 'robinson/profili');
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method:'POST', body:fd });
    const data = await res.json();
    if (!data.secure_url) throw new Error(data.error?.message || 'Upload fallito');
    const fotoUrl = data.secure_url;
    await setDoc(doc(db, 'robinson_naufraghi', uid), { fotoRobinson: fotoUrl }, { merge: true });
    const av = document.querySelector('.modal-avatar');
    if (av?.tagName === 'IMG') av.src = fotoUrl;
    _mostraToast('✅ Foto Robinson aggiornata!');
  } catch(e) { _mostraToast('❌ Errore: ' + e.message); }
};

function _acc(titolo, contenuto, aperto=false) {
  if (!contenuto?.trim()) return '';
  return `<div class="rmp-acc-toggle">${titolo} <span class="rmp-arr">▼</span></div>
    <div class="rmp-acc-body"${aperto?' style="display:block;"':''}>${contenuto}</div>`;
}

function _riga(label, val) {
  return val ? `<div style="margin-bottom:6px;"><span style="font-size:0.72rem;color:#1a3a5c;font-weight:600;">${label}:</span> <span style="font-size:0.86rem;">${esc(val)}</span></div>` : '';
}

function _fmtGiorno(key) {
  const [y,m,d] = key.split('-').map(Number);
  const dt = new Date(y,m-1,d);
  const gg=['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  const mm=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  return `${gg[dt.getDay()]} ${d} ${mm[m-1]} ${y}`;
}

function _nomeMese(y,m) {
  const mm=['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  return `${mm[m]} ${y}`;
}

function _todayKey() {
  const n=new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

// ── SCELTA ────────────────────────────────────────────────────────────────
async function _scelta({ uid, nome, foto, ruolo, ruoloLabel }) {
  let btns = '';
  if (_isOwner(ruolo)) {
    btns = `
      <button class="rmp-scelta-btn" id="sb-ci">🪪 La mia Carta d'Identità<span class="rmp-scelta-sub">Compila o modifica il tuo profilo</span></button>
      <button class="rmp-scelta-btn" id="sb-d">📖 Il mio Diario<span class="rmp-scelta-sub">Scrivi la tua giornata sull'isola</span></button>
      <button class="rmp-scelta-btn muted" id="sb-preview">👁️ Come mi vedono gli altri<span class="rmp-scelta-sub">Anteprima del tuo profilo pubblico</span></button>`;
  } else {
    btns = `
      <button class="rmp-scelta-btn" id="sb-ci">🪪 La Carta d'Identità<span class="rmp-scelta-sub">Chi è, cosa porta sull'isola</span></button>
      <button class="rmp-scelta-btn" id="sb-d">📖 Il Diario<span class="rmp-scelta-sub">I giorni sull'isola</span></button>`;
  }

  _content.innerHTML = `${_header(foto, nome, ruoloLabel, false, uid, ruolo)}<div style="padding:20px;">${btns}</div>`;

  document.getElementById('sb-ci').onclick = () => _push('carta', { uid, nome, foto, ruolo, ruoloLabel });
  document.getElementById('sb-d').onclick  = () => _push('diario', { uid, nome, foto, ruolo, ruoloLabel });
  const prev = document.getElementById('sb-preview');
  if (prev) prev.onclick = () => _push('carta', { uid, nome, foto, ruolo:'visitatore', ruoloLabel });
}

// ── CARTA D'IDENTITÀ ─────────────────────────────────────────────────────
async function _carta({ uid, nome, foto, ruolo, ruoloLabel }) {
  _cartaParams = { uid, nome, foto, ruolo, ruoloLabel };

  _content.innerHTML = `${_header(foto, nome, ruoloLabel, true, uid, ruolo)}<div id="rmp-ci-body" style="padding:16px;"><div style="text-align:center;">⏳</div></div>`;
  const ciBody = document.getElementById('rmp-ci-body');

  try {
    const snapCI = await getDoc(doc(db, 'robinson_naufraghi', uid, 'carta_identita', 'dati'));
    const ci = snapCI.exists() ? snapCI.data() : null;
    const compilata = ci?.salvato === true;

    if (_isOwner(ruolo) && !compilata) {
      _cartaForm(uid, nome, ci, ciBody);
    } else {
      _cartaReadonly(uid, nome, ci, ruolo, ciBody);
    }

    await _nottePartenza(uid, ruolo, ciBody);  // usa insertBefore → va in cima

    await _diconoDiMe(uid, ciBody);
  } catch(e) {
    ciBody.innerHTML = `<div style="color:red;padding:16px;">${esc(e.message)}</div>`;
  }
}

// ── CARTA: FORM EDITABILE ─────────────────────────────────────────────────
function _cartaForm(uid, nome, ci, container) {
  const v = f => ci?.[f] || '';
  const va = f => (ci?.[f] || []).map(x=>x||'');
  const vid = f => ci?.isolaDeserta?.[f] || '';
  const id = ci?.isolaDeserta || {};

  container.innerHTML = `
    <div class="rmp-banner">✏️ Stai compilando la tua Carta d'Identità Robinson</div>

    <div class="rmp-acc-toggle">🖼️ Ritratto di Me <span class="rmp-arr">▼</span></div>
    <div class="rmp-acc-body" style="display:block;">
      <label class="rmp-label">Nome Robinson</label>
      <input id="ci-nome" class="rmp-field" value="${esc(v('nome'))}">
      <label class="rmp-label">Codice RR</label>
      <input id="ci-codice" class="rmp-field" value="${esc(v('codiceRR'))}">
      <label class="rmp-label">Tre parole che mi descrivono</label>
      <div style="display:flex;gap:6px;">
        <input id="ci-p1" class="rmp-field" placeholder="Prima" value="${esc(va('treParole')[0]||'')}">
        <input id="ci-p2" class="rmp-field" placeholder="Seconda" value="${esc(va('treParole')[1]||'')}">
        <input id="ci-p3" class="rmp-field" placeholder="Terza" value="${esc(va('treParole')[2]||'')}">
      </div>
      <label class="rmp-label">La mia difficoltà</label>
      <input id="ci-diff" class="rmp-field" value="${esc(v('difficolta'))}">
      <label class="rmp-label">Il mio pregio</label>
      <input id="ci-pregio" class="rmp-field" value="${esc(v('pregio'))}">
      <label class="rmp-label">Vorrei imparare</label>
      <input id="ci-impara" class="rmp-field" value="${esc(v('vorreiImparare'))}">
      <label class="rmp-label">So fare bene</label>
      <input id="ci-sofare" class="rmp-field" value="${esc(v('soFareBene'))}">
    </div>

    <div class="rmp-acc-toggle">🧭 La Mia Bussola <span class="rmp-arr">▼</span></div>
    <div class="rmp-acc-body">
      <label class="rmp-label">Cosa mi rende felice</label>
      <textarea id="ci-felice" class="rmp-field" rows="2">${esc(v('rendeFelice'))}</textarea>
      <label class="rmp-label">Cosa mi fa arrabbiare</label>
      <textarea id="ci-arrabbia" class="rmp-field" rows="2">${esc(v('faArrabbiare'))}</textarea>
      <label class="rmp-label">Quando sono triste</label>
      <textarea id="ci-triste" class="rmp-field" rows="2">${esc(v('quandoTriste'))}</textarea>
    </div>

    <div class="rmp-acc-toggle">🤝 Le Mie Risorse <span class="rmp-arr">▼</span></div>
    <div class="rmp-acc-body">
      <label class="rmp-label">Persone su cui conto (una per riga)</label>
      <textarea id="ci-persone" class="rmp-field" rows="3">${esc((va('persone').filter(Boolean)).join('\n'))}</textarea>
      <label class="rmp-label">Le mie qualità (una per riga)</label>
      <textarea id="ci-qualita" class="rmp-field" rows="3">${esc((va('qualita').filter(Boolean)).join('\n'))}</textarea>
    </div>

    <div class="rmp-acc-toggle">⚔️ La Mia Sfida <span class="rmp-arr">▼</span></div>
    <div class="rmp-acc-body">
      <textarea id="ci-sfida" class="rmp-field" rows="2">${esc(v('sfida'))}</textarea>
    </div>

    <div class="rmp-acc-toggle">💬 Il Mio Motto <span class="rmp-arr">▼</span></div>
    <div class="rmp-acc-body">
      <input id="ci-motto" class="rmp-field" placeholder="Il tuo motto..." value="${esc(v('motto'))}">
    </div>

    <div class="rmp-acc-toggle">🏝️ Cosa mi porto sull'isola <span class="rmp-arr">▼</span></div>
    <div class="rmp-acc-body">
      ${ID_KEYS.slice(0,15).map(k=>`<label class="rmp-label">${ID_LABELS[k]}</label><input id="ci-id-${k}" class="rmp-field" value="${esc(id[k]||'')}">`).join('')}
      <label class="rmp-label">✏️ Altro</label>
      <input id="ci-id-altro" class="rmp-field" value="${esc(id.altro||'')}">
    </div>

    <div class="rmp-acc-toggle">✍️ Firma <span class="rmp-arr">▼</span></div>
    <div class="rmp-acc-body">
      <input id="ci-firma" class="rmp-field" placeholder="La tua firma..." value="${esc(v('firma'))}">
    </div>

    <button class="rmp-save-btn" id="ci-salva-btn">💾 Salva la Carta d'Identità</button>
    <div id="ci-msg" style="margin-top:6px;font-size:0.8rem;text-align:center;"></div>`;

  document.getElementById('ci-salva-btn').addEventListener('click', async () => {
    const g = id => document.getElementById(id)?.value.trim() || '';
    const isolaDeserta = {};
    ID_KEYS.slice(0,15).forEach(k => { const v=g(`ci-id-${k}`); if(v) isolaDeserta[k]=v; });
    const altro = g('ci-id-altro'); if(altro) isolaDeserta.altro = altro;

    const dati = {
      nome: g('ci-nome'),
      codiceRR: g('ci-codice'),
      treParole: [g('ci-p1'),g('ci-p2'),g('ci-p3')].filter(Boolean),
      difficolta: g('ci-diff'), pregio: g('ci-pregio'),
      vorreiImparare: g('ci-impara'), soFareBene: g('ci-sofare'),
      rendeFelice: g('ci-felice'), faArrabbiare: g('ci-arrabbia'), quandoTriste: g('ci-triste'),
      persone: (g('ci-persone')||'').split('\n').map(s=>s.trim()).filter(Boolean),
      qualita: (g('ci-qualita')||'').split('\n').map(s=>s.trim()).filter(Boolean),
      sfida: g('ci-sfida'), motto: g('ci-motto'),
      isolaDeserta, firma: g('ci-firma'),
      salvato: true, salvatoAt: serverTimestamp()
    };
    const msg = document.getElementById('ci-msg');
    try {
      await setDoc(doc(db, 'robinson_naufraghi', uid, 'carta_identita', 'dati'), dati, { merge: true });
      msg.style.color='#c8860a'; msg.textContent='✅ Carta salvata!';
      setTimeout(() => { if(_cartaParams) _render('carta', _cartaParams); }, 1200);
    } catch(e) { msg.textContent='Errore: '+e.message; }
  });
}

// ── CARTA: SOLA LETTURA ───────────────────────────────────────────────────
function _cartaReadonly(uid, nome, ci, ruolo, container) {
  if (!ci) {
    container.innerHTML = '<div style="text-align:center;color:#1a3a5c;font-style:italic;padding:12px;">Carta d\'Identità non ancora compilata.</div>';
    return;
  }

  const treParole = (ci.treParole||[]).filter(Boolean).join(' · ');
  let ritratto = treParole ? `<div style="margin-bottom:8px;font-size:0.9rem;font-style:italic;color:#1a3a5c;">"${esc(treParole)}"</div>` : '';
  ritratto += _riga('Difficoltà',ci.difficolta) + _riga('Pregio',ci.pregio) + _riga('Vorrei imparare',ci.vorreiImparare) + _riga('So fare bene',ci.soFareBene);

  let bussola = _riga('Cosa mi rende felice',ci.rendeFelice) + _riga('Cosa mi fa arrabbiare',ci.faArrabbiare) + _riga('Quando sono triste',ci.quandoTriste);

  const persone = (ci.persone||[]).filter(Boolean).join(', ');
  const qualita = (ci.qualita||[]).join(', ');

  const id = ci.isolaDeserta || {};
  let isolaHtml = '';
  if (ID_KEYS.some(k=>id[k])||id.altro) {
    isolaHtml = ID_KEYS.filter(k=>id[k]).map(k=>_riga(ID_LABELS[k],id[k])).join('');
    if (id.altro) isolaHtml += _riga('✏️ Altro',id.altro);
  }

  let html = '';
  if (ritratto.trim()) html += _acc('🖼️ Ritratto di Me', ritratto);
  if (bussola.trim()) html += _acc('🧭 La Mia Bussola', bussola);
  const risorse = _riga('Persone su cui conto',persone) + _riga('Le mie qualità',qualita);
  if (risorse.trim()) html += _acc('🤝 Le Mie Risorse', risorse);
  if (ci.sfida) html += _acc('⚔️ La Mia Sfida', _riga('',ci.sfida));
  if (ci.motto) html += _acc('💬 Il Mio Motto', `<div style="font-style:italic;font-size:0.9rem;">"${esc(ci.motto)}"</div>`);
  if (isolaHtml) html += _acc("🏝️ Cosa mi porto sull'isola", isolaHtml);
  if (ci.firma) html += `<div style="text-align:center;margin:16px 0 8px;font-family:'Dancing Script',cursive;font-size:1.4rem;color:#1a3a5c;">${esc(ci.firma)}</div>`;
  html += `<div style="width:80px;height:80px;border:3px solid #c8860a;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;margin:16px auto 8px;opacity:0.4;transform:rotate(-15deg);"><div style="font-size:0.42rem;font-weight:700;color:#1a3a5c;letter-spacing:0.12em;text-align:center;line-height:1.4;">🌴<br>ROBINSON<br>REPUBLIC</div></div>`;

  // Banner + bottoni in base al ruolo
  if (_isOwner(ruolo)) {
    html += `<div class="rmp-banner">✅ Carta compilata — per modificarla contatta l'admin</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <button class="rmp-req-btn" id="rmp-richiesta-btn">✉️ Richiedi modifica all'admin</button>
      </div>
      <div id="rmp-richiesta-msg" style="font-size:0.78rem;margin-top:4px;"></div>`;
  }
  if (_isAdmin(ruolo)) {
    html += `<div style="margin:8px 0;"><button class="rmp-admin-btn" id="rmp-sblocca-btn">🔓 Sblocca per modifica</button></div>`;
  }

  container.innerHTML = html;

  if (_isOwner(ruolo)) {
    document.getElementById('rmp-richiesta-btn')?.addEventListener('click', async () => {
      const msg = document.getElementById('rmp-richiesta-msg');
      try {
        await setDoc(doc(db, 'robinson_richieste', uid), {
          tipo: 'modifica_carta', uid, nome,
          richiestoAt: serverTimestamp(), stato: 'pending'
        }, { merge:true });
        msg.style.color='#c8860a'; msg.textContent='✅ Richiesta inviata all\'admin';
      } catch(e) { msg.textContent='Errore: '+e.message; }
    });
  }

  if (_isAdmin(ruolo)) {
    document.getElementById('rmp-sblocca-btn')?.addEventListener('click', async () => {
      await updateDoc(doc(db,'robinson_naufraghi',uid,'carta_identita','dati'), { salvato:false });
      if (_cartaParams) await _render('carta', { ..._cartaParams, ruolo:'proprietario' });
    });
  }
}

// ── NOTTE PRIMA DI PARTIRE ────────────────────────────────────────────────
let _notteDb = null;

const NOTTE_DOMANDE = [
  { icon:'🌊', titolo:'Con quale stato d\'animo sto per approdare sull\'isola?',   sub:'Quali emozioni sento più forti questa sera?', color:'#FF6B00' },
  { icon:'🎒', titolo:'Cosa porto con me?',                                         sub:'Non nello zaino, ma dentro di me. Quali sono le qualità che mi accompagneranno durante questa avventura?', color:'#FF2D9B' },
  { icon:'🌱', titolo:'Cosa spero di trovare sull\'isola?',                         sub:'Che cosa mi piacerebbe vivere?', color:'#FF6B00' },
  { icon:'🧭', titolo:'Quale parte di me vorrei conoscere meglio?',                 sub:'C\'è qualcosa che vorrei capire di me stesso?', color:'#FF2D9B' },
  { icon:'⛰️', titolo:'Quali sono gli scogli che temo di incontrare?',              sub:'Quali difficoltà penso di dover affrontare?', color:'#FF6B00' },
  { icon:'🌊', titolo:'Quali onde fanno ancora paura?',                             sub:'Quali sono le paure che vorrei imparare ad affrontare?', color:'#FF2D9B' },
  { icon:'🔥', titolo:'Quale fuoco posso accendere per gli altri?',                 sub:'Quali qualità, capacità o gesti posso mettere a disposizione della mia ciurma?', color:'#FF6B00' },
  { icon:'🤝', titolo:'Che tipo di compagno di viaggio voglio essere?',             sub:'Come vorrei che gli altri mi ricordassero al termine dell\'avventura?', color:'#FF2D9B' },
  { icon:'⭐', titolo:'Se questa isola potesse regalarmi una sola cosa...',         sub:'Che cosa vorrei portare con me quando tornerò a casa?', color:'#FF6B00' },
];

async function _nottePartenza(uid, ruolo, container) {
  const notteInizio  = new Date('2026-07-01T22:00:00+02:00').getTime();
  const notteFine    = new Date('2026-07-02T02:00:00+02:00').getTime();
  const adesso       = Date.now();
  const inFinestra   = adesso >= notteInizio && adesso < notteFine;
  const dopoFinestra = adesso >= notteFine;
  const isAdm        = _cu?.uid === ADMIN_UID;
  const canWrite     = isAdm || inFinestra;

  // Carica dati salvati
  let saved = {};
  try {
    const snap = await getDoc(doc(db, 'notte_sbarco', uid));
    if (snap.exists()) saved = snap.data();
  } catch(_) {}

  // Stato messaggio
  let statoMsg = '';
  if (!canWrite) {
    statoMsg = dopoFinestra
      ? 'Questa pagina è ora in sola lettura. Il tuo viaggio è iniziato.'
      : 'La scrittura sarà disponibile la sera del 1 luglio dalle 22:00.';
  }

  // Griglia 9 domande
  const cardsHtml = NOTTE_DOMANDE.map((d, i) => `
    <div style="background:linear-gradient(135deg,#0d1b2a 0%,#11214a 100%);border:2px solid ${d.color};border-radius:14px;padding:14px;">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
        <span style="font-size:1.4rem;flex-shrink:0;">${d.icon}</span>
        <div>
          <div style="color:#fff;font-weight:600;font-size:0.88rem;line-height:1.3;">${d.titolo}</div>
          <div style="color:#7ECFFF;font-size:0.76rem;margin-top:3px;line-height:1.4;">${d.sub}</div>
        </div>
      </div>
      <textarea id="np-r${i+1}" rows="3" ${canWrite ? '' : 'disabled'}
        style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.07);color:#fff;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px;font-size:0.85rem;line-height:1.5;resize:vertical;font-family:inherit;${canWrite ? '' : 'opacity:0.65;cursor:not-allowed;'}"
        placeholder="Scrivi qui…">${esc(saved['risposta'+(i+1)] || '')}</textarea>
    </div>`).join('');

  const bodyHtml = `
    <div style="background:linear-gradient(160deg,#0d1b2a 0%,#1a1a4e 100%);border-radius:12px;padding:16px 14px;margin-bottom:14px;position:relative;overflow:hidden;">
      <div style="position:absolute;inset:0;pointer-events:none;background-image:
        radial-gradient(1px 1px at 10% 15%,#fff 0%,transparent 100%),
        radial-gradient(1.5px 1.5px at 40% 10%,#fff 0%,transparent 100%),
        radial-gradient(1px 1px at 70% 8%,#fff 0%,transparent 100%),
        radial-gradient(1px 1px at 88% 80%,#fff 0%,transparent 100%),
        radial-gradient(1.5px 1.5px at 47% 88%,#fff 0%,transparent 100%);"></div>
      <p style="position:relative;color:#c8e6ff;font-size:0.84rem;line-height:1.6;margin:0;">Il mare è ancora davanti a te. Domani, dopo un lungo viaggio, approderai sulla Robinson Republic insieme ad altri naufraghi. Nessuno sa cosa troverà sull'isola. Ognuno porta con sé qualcosa: sogni, paure, speranze, ricordi, talenti e ferite. Prima dello sbarco fermati qualche minuto. Questa pagina serve a te. Alla fine del campo la rileggerai e forse scoprirai che qualcosa dentro di te è cambiato.</p>
      <div id="np-saved-msg" style="display:none;margin-top:8px;text-align:center;background:#00FFD133;color:#00FFD1;border:1px solid #00FFD1;border-radius:20px;padding:2px 14px;font-size:0.78rem;transition:opacity 0.4s;">Salvato ✓</div>
    </div>
    ${statoMsg ? `<div style="margin-bottom:14px;padding:10px 14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:10px;color:#FFD700;font-size:0.85rem;text-align:center;">${statoMsg}</div>` : ''}
    <div style="display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:16px;">
      ${cardsHtml}
    </div>
    <div style="background:linear-gradient(135deg,#0a1e1c 0%,#0d2b2b 100%);border:2px solid #00FFD1;border-radius:14px;padding:16px;">
      <div style="color:#00FFD1;font-size:1rem;font-weight:700;margin-bottom:6px;">🍾 Una bottiglia affidata al mare</div>
      <p style="color:#a0f0e0;font-size:0.83rem;margin:0 0 2px;">Scrivi un messaggio al te stesso che lascerà l'isola.</p>
      <p style="color:#7ECFFF;font-size:0.8rem;font-style:italic;margin:0 0 10px;">Se un giorno leggerai queste righe…</p>
      <textarea id="np-bottiglia" rows="6" ${canWrite ? '' : 'disabled'}
        style="width:100%;box-sizing:border-box;background:rgba(255,255,255,0.07);color:#fff;border:1px solid rgba(0,255,209,0.3);border-radius:8px;padding:10px;font-size:0.85rem;line-height:1.5;resize:vertical;font-family:inherit;${canWrite ? '' : 'opacity:0.65;cursor:not-allowed;'}"
        placeholder="Caro me futuro…">${esc(saved.bottiglia || '')}</textarea>
    </div>`;

  const outer = document.createElement('div');
  outer.style.marginBottom = '6px';
  outer.innerHTML = `
    <div class="rmp-acc-toggle" style="background:linear-gradient(90deg,#0d1b2a,#1a1a4e);color:#FFD700;border-color:#FFD70044;">🌙 Notte prima di partire <span class="rmp-arr">▼</span></div>
    <div class="rmp-acc-body" style="display:block;background:transparent;border:none;padding:10px 0 0;">
      ${bodyHtml}
    </div>`;
  container.insertBefore(outer, container.firstChild);

  if (canWrite) {
    const save = async () => {
      try {
        const dati = { ultimoSalvataggio: serverTimestamp() };
        for (let i = 1; i <= 9; i++) dati['risposta'+i] = document.getElementById('np-r'+i)?.value || '';
        dati.bottiglia = document.getElementById('np-bottiglia')?.value || '';
        await setDoc(doc(db, 'notte_sbarco', uid), dati, { merge: true });
        const m = document.getElementById('np-saved-msg');
        if (m) { m.style.display='block'; m.style.opacity='1'; clearTimeout(m._t); m._t=setTimeout(()=>{ m.style.opacity='0'; setTimeout(()=>m.style.display='none',400); },2500); }
      } catch(e) { console.warn('saveNotte:', e); }
    };
    const inputs = [...Array(9).keys()].map(i => document.getElementById('np-r'+(i+1)));
    inputs.push(document.getElementById('np-bottiglia'));
    inputs.forEach(el => { if(el) el.addEventListener('input', () => { clearTimeout(_notteDb); _notteDb = setTimeout(save, 2000); }); });
  }
}

// ── DICONO DI ME ─────────────────────────────────────────────────────────
async function _diconoDiMe(uid, container) {
  const wrap=document.createElement('div'); wrap.style.paddingBottom='16px';
  const box=document.createElement('div');
  box.style.cssText='border:2px dashed #c8860a;border-radius:8px;margin:12px 0;overflow:hidden;';
  box.innerHTML=`<div style="background:#1a3a5c;color:#c8860a;font-family:'Playfair Display',serif;padding:8px 12px;font-size:0.82rem;font-weight:700;">💬 Dicono di me</div>`;
  const body=document.createElement('div'); body.style.cssText='background:#faf7f0;padding:10px 12px;';

  if (_cu && _cu.uid !== uid) {
    const fd=document.createElement('div'); fd.style.marginBottom='12px';
    fd.innerHTML=`
      <textarea id="rdm-t-${uid}" rows="2" placeholder="Scrivi qualcosa..." class="rmp-field"></textarea>
      <button id="rdm-pub-${uid}" style="margin-top:7px;width:100%;background:#1a3a5c;color:#c8860a;border:none;border-radius:6px;padding:7px;cursor:pointer;font-family:'Lora',serif;font-size:0.82rem;">📨 Pubblica</button>
      <div id="rdm-msg-${uid}" style="margin-top:4px;font-size:0.75rem;"></div>`;
    body.appendChild(fd);
    const feedDiv=document.createElement('div'); body.appendChild(feedDiv);
    box.appendChild(body); wrap.appendChild(box); container.appendChild(wrap);
    fd.querySelector(`#rdm-pub-${uid}`).addEventListener('click', async () => {
      const testo=fd.querySelector(`#rdm-t-${uid}`).value.trim(); if(!testo) return;
      let nA=_cu.displayName||''; let fA='';
      try { const su=await getDoc(doc(db,'utenti',_cu.uid)); if(su.exists()){nA=su.data().nome||nA;fA=su.data().fotoProfilo||'';} } catch(_){}
      await addDoc(collection(db,'robinson_dicono',uid,'posts'),{testo,mediaUrl:'',mediaType:'',autorId:_cu.uid,autoreNome:nA,autoreFoto:fA,timestamp:serverTimestamp()});
      fd.querySelector(`#rdm-t-${uid}`).value='';
      const msg=fd.querySelector(`#rdm-msg-${uid}`);
      msg.style.color='#c8860a'; msg.textContent='✅ Pubblicato!'; setTimeout(()=>msg.textContent='',2000);
      await _diconoFeed(uid,feedDiv);
    });
    await _diconoFeed(uid,feedDiv);
  } else {
    const feedDiv=document.createElement('div'); body.appendChild(feedDiv);
    box.appendChild(body); wrap.appendChild(box); container.appendChild(wrap);
    await _diconoFeed(uid,feedDiv);
  }
}

async function _diconoFeed(uid, container) {
  container.innerHTML='<div style="text-align:center;font-size:0.8rem;color:#999;">⏳</div>';
  try {
    const snap=await getDocs(query(collection(db,'robinson_dicono',uid,'posts'),orderBy('timestamp','desc')));
    if(snap.empty){container.innerHTML='<div style="text-align:center;color:#999;font-style:italic;font-size:0.8rem;padding:8px;">Ancora nessun messaggio.</div>';return;}
    container.innerHTML='';
    for(const d of snap.docs){
      const pid=d.id; const data=d.data();
      const nA=data.autoreNome||'?'; const fA=data.autoreFoto||'';
      const ds=data.timestamp?.toDate?data.timestamp.toDate().toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'numeric'}):'';
      const el=document.createElement('div');
      el.style.cssText='background:#fff8ee;border:1px solid #e0d0b0;border-radius:8px;padding:8px 10px;margin-bottom:8px;';
      el.innerHTML=`
        <div style="display:flex;align-items:center;gap:7px;margin-bottom:5px;">
          ${fA?`<img src="${esc(fA)}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;border:1px solid #c8860a;">`:'<span style="font-size:0.9rem;">⚓</span>'}
          <span style="font-weight:600;font-size:0.8rem;color:#1a3a5c;">${esc(nA)}</span>
          <span style="font-size:0.68rem;color:#999;margin-left:auto;">${esc(ds)}</span>
        </div>
        ${data.testo?`<p style="font-size:0.85rem;color:#2c1810;margin:0 0 5px;white-space:pre-wrap;">${esc(data.testo)}</p>`:''}
        <div class="rdm-react-${uid}-${pid}" style="display:flex;gap:3px;flex-wrap:wrap;margin-top:4px;"></div>`;
      container.appendChild(el);
      await _loadReact(uid,pid,el.querySelector(`.rdm-react-${uid}-${pid}`));
    }
  } catch(e){container.innerHTML=`<div style="color:red;font-size:0.78rem;">${esc(e.message)}</div>`;}
}

async function _loadReact(uid, pid, container) {
  if(!container) return;
  try {
    const snap=await getDocs(collection(db,'robinson_dicono',uid,'posts',pid,'reactions'));
    const counts={}; const myR=new Set();
    snap.forEach(d=>{const e=d.data().emoji;counts[e]=(counts[e]||0)+1;if(_cu&&d.data().uid===_cu.uid)myR.add(e);});
    container.innerHTML=EMOJIS.map(e=>{
      const c=counts[e]||0; const active=myR.has(e);
      return `<button class="rdm-rb" data-e="${e}" style="background:${active?'#c8860a22':'#f5f0e8'};border:1.5px solid ${active?'#c8860a':'#c8b89a'};border-radius:20px;padding:2px 7px;cursor:pointer;font-size:0.78rem;display:flex;align-items:center;gap:2px;">${e}${c>0?`<span style="font-size:0.68rem;color:#1a3a5c;">${c}</span>`:''}</button>`;
    }).join('');
    container.querySelectorAll('.rdm-rb').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        if(!_cu) return;
        const e=btn.dataset.e; const rId=_cu.uid+'_'+e;
        const rRef=doc(db,'robinson_dicono',uid,'posts',pid,'reactions',rId);
        const rSnap=await getDoc(rRef);
        if(rSnap.exists()) await deleteDoc(rRef); else await setDoc(rRef,{uid:_cu.uid,emoji:e,timestamp:serverTimestamp()});
        await _loadReact(uid,pid,container);
      });
    });
  } catch(_){}
}

// ── DIARIO / CALENDARIO ───────────────────────────────────────────────────
async function _diario({ uid, nome, foto, ruolo, ruoloLabel }) {
  const now = new Date();
  let year=now.getFullYear(); let month=now.getMonth();
  const todayStr = _todayKey();

  let savedDates = new Set();
  try {
    const snap=await getDocs(collection(db,'robinson_diari',uid,'posts'));
    snap.forEach(d=>{ if(d.data().salvato===true) savedDates.add(d.id); });
  } catch(_){}

  const isOwnerRole = _isOwner(ruolo);
  const todayNotCompiled = !savedDates.has(todayStr);

  _content.innerHTML = `
    ${_header(foto, nome, ruoloLabel, true, uid, ruolo)}
    <div style="padding:16px;">
      <div style="font-family:'Playfair Display',serif;font-size:1rem;font-weight:700;color:#1a3a5c;margin-bottom:14px;text-align:center;">📖 Il diario di ${esc(nome)}</div>
      ${isOwnerRole && todayNotCompiled ? '<div style="background:#e8f5e9;border:1px solid #3a8a4a;border-radius:6px;padding:8px 12px;font-size:0.82rem;color:#2a5a3a;margin-bottom:10px;">📝 Hai ancora tempo per scrivere il diario di oggi! Tocca il giorno verde per iniziare.</div>' : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <button id="rmp-cal-prev" style="background:#1a3a5c;color:#c8860a;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1.1rem;line-height:1;">‹</button>
        <div id="rmp-cal-label" style="font-family:'Playfair Display',serif;font-weight:700;color:#1a3a5c;font-size:0.95rem;"></div>
        <button id="rmp-cal-next" style="background:#1a3a5c;color:#c8860a;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:1.1rem;line-height:1;">›</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:6px;">
        ${['L','M','M','G','V','S','D'].map(g=>`<div style="text-align:center;font-size:0.65rem;color:#8a9ab0;font-weight:700;padding:4px 0;">${g}</div>`).join('')}
      </div>
      <div id="rmp-cal-grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;"></div>
      <div style="margin-top:12px;display:flex;gap:12px;flex-wrap:wrap;font-size:0.72rem;color:#5a6a7a;">
        <span>🟡 Giorno compilato</span>
        ${isOwnerRole?'<span>🟢 Oggi (da scrivere)</span>':''}
      </div>
    </div>`;

  const renderCal = () => {
    const label=document.getElementById('rmp-cal-label');
    const grid=document.getElementById('rmp-cal-grid');
    if(!label||!grid) return;
    label.textContent=_nomeMese(year,month);

    const first=new Date(year,month,1);
    const last=new Date(year,month+1,0);
    let startCol=first.getDay()-1; if(startCol<0) startCol=6;

    let html='<div></div>'.repeat(startCol);
    for(let d=1;d<=last.getDate();d++){
      const key=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const comp=savedDates.has(key);
      const isToday=key===todayStr;
      const isTodayOwner=isToday && isOwnerRole && !comp;
      let cls='rmp-cal-cell';
      let style='';
      if(comp) cls+=' compilato';
      else if(isTodayOwner) cls+=' oggi-owner';
      else { style='color:#aaa;cursor:default;'; }
      if(isToday && !isTodayOwner) cls+=' oggi';
      html+=`<div class="${cls}" style="${style}" data-key="${key}">${d}</div>`;
    }
    grid.innerHTML=html;

    grid.querySelectorAll('.rmp-cal-cell').forEach(cell=>{
      const key=cell.dataset.key;
      const comp=savedDates.has(key);
      const isToday=key===todayStr;
      const isTodayOwner=isToday&&isOwnerRole&&!comp;
      if(comp){
        cell.addEventListener('click',()=>_push('giorno',{uid,nome,foto,ruolo,ruoloLabel,dataKey:key}));
      } else if(isTodayOwner){
        cell.addEventListener('click',()=>{ window.location.href=`naufrago.html?uid=${encodeURIComponent(uid)}`; });
      }
    });
  };

  document.getElementById('rmp-cal-prev').onclick=()=>{month--;if(month<0){month=11;year--;}renderCal();};
  document.getElementById('rmp-cal-next').onclick=()=>{month++;if(month>11){month=0;year++;}renderCal();};
  renderCal();
}

// ── GIORNO ────────────────────────────────────────────────────────────────
async function _giorno({ uid, nome, foto, ruolo, ruoloLabel, dataKey }) {
  const isAdmRole = _isAdmin(ruolo);

  _content.innerHTML=`
    <div style="background:#1a3a5c;padding:14px 16px;display:flex;align-items:center;gap:10px;border-radius:12px 12px 0 0;">
      <button class="rmp-back-btn" onclick="window._rmpBack()">←</button>
      <div>
        <div style="font-family:'Playfair Display',serif;font-size:0.98rem;font-weight:700;color:#f5f0e8;">📅 ${esc(_fmtGiorno(dataKey))}</div>
        <div style="font-size:0.72rem;color:#a0b4c8;margin-top:2px;">${esc(nome)}</div>
      </div>
    </div>
    <div id="rmp-g-body" style="padding:16px;"><div style="text-align:center;">⏳</div></div>`;

  try {
    const [snapP,snapI]=await Promise.all([
      getDoc(doc(db,'robinson_diari',uid,'posts',dataKey)),
      getDoc(doc(db,'robinson_isola',uid,'notti',dataKey))
    ]);
    const p=snapP.exists()?snapP.data():{};
    const r=p.riflessioni||{};
    const body=document.getElementById('rmp-g-body');

    let html='';
    if(p.titolo) html+=`<div style="font-style:italic;font-family:'Lora',serif;font-size:1rem;color:#1a3a5c;text-align:center;margin-bottom:12px;">"${esc(p.titolo)}"</div>`;

    // A) La Giornata
    let gH='';
    if(p.approdo) gH+=`<div style="font-size:0.88rem;font-style:italic;line-height:1.6;white-space:pre-wrap;">${esc(p.approdo)}</div>`;
    html+=_acc('📅 La Giornata',gH);

    // B) Meteo
    const mE=p.meteoUmore||p.meteo||'';
    let mH='';
    if(mE) mH+=`<div style="font-size:1.4rem;margin-bottom:8px;">${esc(mE)}<span style="font-size:0.85rem;font-style:italic;color:#5a6a7a;margin-left:8px;">${esc(METEO_INTERP[mE]||'')}</span></div>`;
    if(p.sensazione) mH+=`<div style="font-size:0.88rem;font-style:italic;line-height:1.6;">${esc(p.sensazione)}</div>`;
    html+=_acc("☀️ Meteo dell'umore",mH);

    // C) Emozioni
    const em=p.emozioni||{};
    let eH='';
    const EN={gioia:'Gioia',paura:'Paura',tristezza:'Tristezza',rabbia:'Rabbia',sorpresa:'Sorpresa',disgusto:'Disgusto',ansia:'Ansia',speranza:'Speranza'};
    Object.entries(EN).forEach(([k,l])=>{if(em[k]>0) eH+=`<div style="margin-bottom:6px;font-size:0.88rem;"><span style="color:#1a3a5c;font-weight:600;">${l}:</span> <span style="color:#c8860a;">${'★'.repeat(em[k])}${'☆'.repeat(5-em[k])}</span></div>`;});
    if(p.seMare) eH+=`<div style="margin-bottom:6px;font-size:0.88rem;"><span style="color:#1a3a5c;font-weight:600;">Se fossi il mare:</span> ${esc(p.seMare)}</div>`;
    if(p.bussola) eH+=`<div style="margin-bottom:6px;font-size:0.88rem;"><span style="color:#1a3a5c;font-weight:600;">La bussola puntava verso:</span> ${esc(p.bussola)}</div>`;
    if(p.bussolaAltro) eH+=`<div style="font-size:0.88rem;font-style:italic;margin-bottom:4px;">${esc(p.bussolaAltro)}</div>`;
    html+=_acc('🧭 Emozioni',eH);

    // D) Riflessioni
    const RIF=[{k:'scoperto',kn:'scoperta',l:'🌴 Ho scoperto che...'},{k:'bello',kn:'momentoBello',l:'⭐ Il momento più bello'},{k:'scoglio',kn:'scoglio',l:'🦈 Lo scoglio incontrato'},{k:'tesoro',kn:'tesoro',l:'🐚 Il tesoro che mi porto'}];
    let rfH='';
    RIF.forEach(({k,kn,l})=>{
      const val=r[kn]||r[k]; if(!val) return;
      const priv=typeof val==='object'?val.privato:false;
      const testo=typeof val==='object'?val.testo:val;
      if(priv&&!isAdmRole) rfH+=`<div style="margin-bottom:8px;"><span style="font-size:0.78rem;color:#8a6a3a;font-weight:600;">${l}</span><div style="font-size:11px;color:#8a6a3a;font-style:italic;margin-top:2px;">🔒 Contenuto privato</div></div>`;
      else if(testo) rfH+=`<div style="margin-bottom:8px;"><span style="font-size:0.78rem;color:#1a3a5c;font-weight:600;">${l}</span><div style="font-size:0.88rem;font-style:italic;line-height:1.5;margin-top:2px;">${esc(testo)}</div></div>`;
    });
    if(r.falo){
      const priv=r.falo.privato;
      if(priv&&!isAdmRole) rfH+=`<div style="margin-bottom:8px;"><span style="font-size:0.78rem;color:#8a6a3a;font-weight:600;">🔥 Falò della sera</span><div style="font-size:11px;color:#8a6a3a;font-style:italic;margin-top:2px;">🔒 Contenuto privato</div></div>`;
      else{const voci=Array.isArray(r.falo)?r.falo:(r.falo.voci||[]);const elenco=[...voci,...(r.falo.altro?[r.falo.altro]:[])].join(', ');if(elenco) rfH+=`<div style="margin-bottom:8px;"><span style="font-size:0.78rem;color:#1a3a5c;font-weight:600;">🔥 Falò della sera</span><div style="font-size:0.88rem;font-style:italic;line-height:1.5;margin-top:2px;">${esc(elenco)}</div></div>`;}
    }
    html+=_acc('🌴 Riflessioni',rfH);

    // E) Tesori
    const media=p.media||[]; let tH='';
    media.forEach(m=>{const type=m.type||m.mediaType||'';if(type==='image') tH+=`<img src="${esc(m.url)}" style="max-width:100%;border-radius:6px;margin-bottom:8px;display:block;">`;else if(type==='video') tH+=`<video src="${esc(m.url)}" controls style="max-width:100%;border-radius:6px;margin-bottom:8px;display:block;"></video>`;else if(type==='audio') tH+=`<audio src="${esc(m.url)}" controls style="width:100%;margin-bottom:8px;display:block;"></audio>`;});
    html+=_acc('📸 Tesori',tH);

    // F) Isola
    let iH='';
    if(snapI.exists()){const id=snapI.data();iH=`<div style="font-size:0.9rem;margin-bottom:6px;">${esc(id.luogoEmoji||'🗺️')} <strong>${esc(id.luogoNome||id.luogoId||'')}</strong></div>`;if(id.meteo)iH+=`<div style="font-size:0.82rem;color:#5a6a7a;">Meteo isola: ${esc(id.meteo)}</div>`;if(id.pensiero)iH+=`<div style="font-size:0.88rem;font-style:italic;margin-top:6px;">"${esc(id.pensiero)}"</div>`;}
    else iH='<div style="color:#999;font-style:italic;font-size:0.85rem;">Nessuna notte registrata sull\'isola.</div>';
    html+=_acc("🗺️ Isola",iH);

    body.innerHTML=html;
  } catch(e){
    document.getElementById('rmp-g-body').innerHTML=`<div style="color:red;padding:16px;">${esc(e.message)}</div>`;
  }
}
