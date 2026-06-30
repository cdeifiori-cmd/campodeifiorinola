import { db, CLOUD_NAME, CLOUD_PRESET } from './robinson-firebase.js';
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

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
      else html += `<video src="${esc(m.url)}" controls playsinline></video>`;
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
