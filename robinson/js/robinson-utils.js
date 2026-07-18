import { db, CLOUD_NAME, CLOUD_PRESET } from './robinson-firebase.js';
import { getDoc, doc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Escape HTML ────────────────────────────────────────────────────────────────
export function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Formattazione date ─────────────────────────────────────────────────────────
const MESI = ['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];

export function fmtDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const gg = String(d.getDate()).padStart(2,'0');
  const mm = MESI[d.getMonth()];
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2,'0');
  const min = String(d.getMinutes()).padStart(2,'0');
  return `${gg} ${mm} ${yyyy} ${hh}:${min}`;
}

export function fmtDateShort(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

// ── Foto Robinson (separata da campodeifiori.org) ─────────────────────────────
export async function getFotoRobinson(uid) {
  try {
    const docR = await getDoc(doc(db, 'robinson_naufraghi', uid));
    if (docR.exists() && docR.data().fotoRobinson) return docR.data().fotoRobinson;
    const docU = await getDoc(doc(db, 'utenti', uid));
    if (docU.exists() && docU.data().fotoProfilo) return docU.data().fotoProfilo;
  } catch(_) {}
  return null;
}

// ── Canonicalizzazione uid naufraghi ────────────────────────────────────────────
// admin-pin.html, quando crea un PIN, genera un NUOVO account Firebase Auth (uid
// diverso dal docId originale in robinson_naufraghi) e ne copia il profilo sul nuovo
// uid. Il documento vecchio spesso resta, creando un doppione della stessa persona
// sotto due docId diversi. robinson_pin/{authUid} conserva sempre originalUid, quindi
// è la fonte di verità per ricondurre un vecchio docId al vero authUid con cui la
// persona accede oggi (già usato con questa stessa logica in notte-admin.html).
export async function caricaMappaUidCanonico() {
  const mappa = {};
  const snap = await getDocs(collection(db, 'robinson_pin'));
  snap.forEach(d => {
    const pd = d.data();
    const authUid = pd.uid || d.id;
    if (pd.originalUid && pd.originalUid !== authUid) mappa[pd.originalUid] = authUid;
  });
  return mappa;
}

export function uidCanonico(mappaUidCanonico, uid) {
  return mappaUidCanonico[uid] || uid;
}

// ── Config profilo per ruolo (naufrago/ciurma) ──────────────────────────────
// Unica fonte di verità per "in quale collezione/campo vive la foto profilo"
// di un ruolo. Nato dal bug Allocca/La Manna: robinson-modal-profilo.js scriveva
// SEMPRE la foto in robinson_naufraghi anche per membri della ciurma, creando
// doc-fantasma senza nome che comparivano nella lista Naufraghi. Ogni punto che
// legge/scrive la foto profilo di un uid deve passare da qui, mai hardcodare
// 'robinson_naufraghi'.
export const CONFIG_PROFILO_RUOLO = {
  naufrago: { collection: 'robinson_naufraghi', fotoField: 'fotoRobinson' },
  ciurma:   { collection: 'robinson_ciurma',    fotoField: 'fotoProfilo' },
};
export function configProfilo(ruolo) {
  return CONFIG_PROFILO_RUOLO[ruolo] || CONFIG_PROFILO_RUOLO.naufrago;
}

// ── Cache nomi ─────────────────────────────────────────────────────────────────
const _nomiCache = {};

export async function risolviNome(uid) {
  if (!uid) return 'Anonimo';
  if (_nomiCache[uid] !== undefined) return _nomiCache[uid] || 'Anonimo';
  try {
    const [su, ss] = await Promise.all([
      getDoc(doc(db, 'utenti', uid)),
      getDoc(doc(db, 'staff', uid))
    ]);
    const du = su.exists() ? su.data() : null;
    const ds = ss.exists() ? ss.data() : null;
    const n = du?.nome || ds?.nome || ds?.nomeCompleto || du?.nomeCompleto || du?.displayName || ds?.displayName || '';
    _nomiCache[uid] = n;
    return n || 'Anonimo';
  } catch(_) {}
  _nomiCache[uid] = '';
  return 'Anonimo';
}

// ── Upload Cloudinary ──────────────────────────────────────────────────────────
export async function uploadOne(file, tipo) {
  if (file.size > 15 * 1024 * 1024) {
    alert('Il file è troppo grande (max 15MB).\nPuoi comprimerlo con app come HandBrake (PC) o Compress Video (smartphone) prima di caricarlo.');
    return null;
  }
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUD_PRESET);
  // audio usa resource_type=video su Cloudinary
  const resType = tipo === 'image' ? 'image' : 'video';
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resType}/upload`, { method:'POST', body:fd });
  const data = await res.json();
  if (!data.secure_url) throw new Error('Upload fallito: ' + (data.error?.message || file.name));
  return { url: data.secure_url, type: tipo, mime: file.type, name: file.name };
}

export async function uploadAll(files) {
  return Promise.all(files.map(f => uploadOne(f.file, f.type)));
}

// ── Cloudinary: compatibilità video su tutti i browser ──────────────────────────
// Alcuni video (HEVC/H.265, container .mov, audio non standard) vengono riprodotti
// su mobile ma falliscono su desktop con "file danneggiato". f_auto+vc_auto lascia
// scegliere a Cloudinary il codec migliore supportato dal browser (tipicamente
// H.264/MP4), q_auto ottimizza la qualità. Applicata solo in fase di rendering:
// non tocca gli URL salvati in Firestore, quindi è reversibile.
export function cloudinaryVideoUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const marker = '/video/upload/';
  const idx = url.indexOf(marker);
  if (idx === -1) return url; // non è una URL Cloudinary video/upload: lascia invariata

  const transform = 'f_auto,vc_auto,q_auto';
  const afterUpload = url.slice(idx + marker.length);
  let out = afterUpload.startsWith(transform)
    ? url // già presente: idempotente, non duplicare
    : url.slice(0, idx + marker.length) + transform + '/' + afterUpload;

  // Delivery sempre in .mp4, anche se il file sorgente è .mov o altro container
  out = out.replace(/\.(mov|avi|mkv|webm)(\?|$)/i, '.mp4$2');

  return out;
}

// ── Normalizza media ───────────────────────────────────────────────────────────
export function normalizeMedia(item) {
  if (Array.isArray(item.media) && item.media.length > 0) return item.media;
  if (item.mediaUrl) return [{ url: item.mediaUrl, type: item.mediaType || 'image', mime:'', name:'' }];
  return [];
}

// ── Render griglia media ───────────────────────────────────────────────────────
export function renderMediaGrid(mediaList) {
  if (!mediaList || !mediaList.length) return '';
  const imgs   = mediaList.filter(m => m.type === 'image');
  const vids   = mediaList.filter(m => m.type === 'video');
  const audios = mediaList.filter(m => m.type === 'audio');
  const visual = [...imgs, ...vids];
  const n = visual.length;
  const cls = n === 1 ? 'c1' : n === 2 ? 'c2' : 'c3';
  let html = '';
  if (visual.length) {
    html += `<div class="media-grid ${cls}">`;
    visual.forEach(m => {
      html += `<div class="media-item">`;
      if (m.type === 'image') html += `<img src="${esc(m.url)}" loading="lazy" alt="foto">`;
      else html += `<video controls playsinline preload="metadata"><source src="${esc(cloudinaryVideoUrl(m.url))}" type="video/mp4"></video>`;
      html += `</div>`;
    });
    html += `</div>`;
  }
  if (audios.length) {
    audios.forEach(m => {
      html += `<div class="media-item"><audio src="${esc(m.url)}" controls></audio></div>`;
    });
  }
  return html;
}

// ── Preview allegati ───────────────────────────────────────────────────────────
export function renderPreview(files, container) {
  if (!container) return;
  if (!files || !files.length) { container.innerHTML = ''; return; }
  let html = '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">';
  files.forEach((f, i) => {
    const url = f.previewUrl || URL.createObjectURL(f.file);
    if (f.type === 'image') {
      html += `<div style="position:relative;width:70px;height:70px;"><img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;"><span data-idx="${i}" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);color:#fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px;cursor:pointer;" class="prev-rm">✕</span></div>`;
    } else if (f.type === 'video') {
      html += `<div style="position:relative;width:70px;height:70px;"><video src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;" muted></video><span data-idx="${i}" class="prev-rm" style="position:absolute;top:2px;right:2px;background:rgba(0,0,0,0.6);color:#fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:10px;cursor:pointer;">✕</span></div>`;
    } else {
      html += `<div style="display:flex;align-items:center;gap:4px;background:var(--carta-scura);border-radius:6px;padding:4px 8px;font-size:0.75rem;">🎵 ${esc(f.file?.name || 'audio')}<span data-idx="${i}" class="prev-rm" style="cursor:pointer;margin-left:4px;color:var(--rosso);">✕</span></div>`;
    }
  });
  html += '</div>';
  container.innerHTML = html;
}

// ── Costanti settimana/mese correnti ──────────────────────────────────────────
function getISOWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

const _now = new Date();
const _anno = _now.getFullYear();
const _w = String(getISOWeek(_now)).padStart(2, '0');
export const SETTIMANA_KEY = `${_anno}-W${_w}`;
export const MESE_KEY = `${_anno}-${String(_now.getMonth()+1).padStart(2,'0')}`;

// ── Tooltip "chi ha reagito" sui bottoni .reaction-btn ──────────────────────────
// Desktop: hover mostra i nomi. Mobile: long-press mostra i nomi senza attivare il
// toggle della reazione (un tap rapido continua a funzionare come prima). Il
// tooltip si chiude toccando/cliccando fuori. Posizionato con position:fixed per
// non essere tagliato da contenitori con overflow.
let _reactionTooltipEl = null;
function _getReactionTooltipEl() {
  if (_reactionTooltipEl && document.body.contains(_reactionTooltipEl)) return _reactionTooltipEl;
  const el = document.createElement('div');
  el.className = 'reaction-tooltip';
  el.style.cssText = 'position:fixed;z-index:1000;background:#1a3a5c;color:#fff;'
    + 'font-family:Lora,serif;font-size:0.78rem;line-height:1.4;padding:6px 10px;'
    + 'border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.3);pointer-events:none;'
    + 'max-width:220px;white-space:normal;display:none;transform:translate(-50%,-100%);';
  document.body.appendChild(el);
  _reactionTooltipEl = el;
  return el;
}
function _mostraReactionTooltip(target, testo) {
  const el = _getReactionTooltipEl();
  el.textContent = testo;
  const r = target.getBoundingClientRect();
  el.style.left = Math.round(r.left + r.width / 2) + 'px';
  el.style.top = Math.round(r.top - 8) + 'px';
  el.style.display = 'block';
}
function _nascondiReactionTooltip() {
  if (_reactionTooltipEl) _reactionTooltipEl.style.display = 'none';
}
document.addEventListener('click', e => {
  if (!e.target.closest?.('.reaction-btn')) _nascondiReactionTooltip();
});

/**
 * Collega hover (desktop) e long-press (mobile) a tutti i .reaction-btn dentro
 * `container`, mostrando chi ha messo ciascuna reazione.
 * `fetchAutori(emoji)` deve restituire una Promise<string[]> di nomi (già filtrata
 * per emoji); i risultati per emoji vengono messi in cache per la durata di vita
 * del bottone.
 */
export function attachReactionTooltip(container, fetchAutori) {
  const cache = new Map(); // emoji -> Promise<string[]>
  function autoriDi(emoji) {
    if (!cache.has(emoji)) cache.set(emoji, fetchAutori(emoji).catch(() => []));
    return cache.get(emoji);
  }
  async function mostra(btn) {
    const nomi = await autoriDi(btn.dataset.emoji);
    if (!nomi || !nomi.length) return;
    _mostraReactionTooltip(btn, nomi.join(', '));
  }

  container.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('mouseenter', () => mostra(btn));
    btn.addEventListener('mouseleave', _nascondiReactionTooltip);

    let timer = null, longPressed = false;
    btn.addEventListener('touchstart', () => {
      longPressed = false;
      timer = setTimeout(() => { longPressed = true; mostra(btn); }, 480);
    }, { passive: true });
    btn.addEventListener('touchend', e => {
      clearTimeout(timer);
      if (longPressed) e.preventDefault(); // evita che il long-press attivi anche il toggle
    });
    btn.addEventListener('touchmove', () => clearTimeout(timer));
  });
}
