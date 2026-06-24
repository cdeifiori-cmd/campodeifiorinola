/**
 * Utilità condivise: upload, media rendering, preview, commenti, nomi.
 * Importato da spiaggia.html, naufrago.html, appunti.html
 */
import { db, CLOUD_NAME, CLOUD_PRESET } from './robinson-firebase.js';
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Escape HTML ────────────────────────────────────────────────────────────────
export function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Formattazione data ─────────────────────────────────────────────────────────
export function fmtDate(ts) {
  if (!ts?.toDate) return '';
  const d = ts.toDate();
  return d.toLocaleDateString('it-IT', { day:'numeric', month:'long' }) +
         ' · ' + d.toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
}

// ── Cache nomi (uid → nome) ────────────────────────────────────────────────────
const _nomiCache = {};

export async function risolviNome(uid) {
  if (_nomiCache[uid] !== undefined) return _nomiCache[uid];
  try {
    const [su, ss] = await Promise.all([
      getDoc(doc(db, 'utenti', uid)),
      getDoc(doc(db, 'staff', uid))
    ]);
    const du = su.exists() ? su.data() : null;
    const ds = ss.exists() ? ss.data() : null;
    const n = du?.nome || ds?.nome || ds?.nomeCompleto || du?.nomeCompleto || du?.displayName || ds?.displayName || '';
    _nomiCache[uid] = n;
    return n;
  } catch(_) {}
  _nomiCache[uid] = '';
  return '';
}

// ── Upload Cloudinary ──────────────────────────────────────────────────────────
export async function uploadOne(file, type) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUD_PRESET);
  const resType = type === 'image' ? 'image' : 'video';
  const res  = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resType}/upload`, { method:'POST', body:fd });
  const data = await res.json();
  if (!data.secure_url) throw new Error('Upload fallito: ' + (data.error?.message || file.name));
  return data.secure_url;
}

export async function uploadAll(items, barEl, progEl) {
  if (progEl) progEl.style.display = 'block';
  let done = 0;
  const results = await Promise.all(
    items.map(item => uploadOne(item.file, item.type).then(url => {
      done++;
      if (barEl) barEl.style.width = Math.round(done / items.length * 100) + '%';
      return { url, type: item.type, name: item.name };
    }))
  );
  setTimeout(() => { if (progEl) progEl.style.display = 'none'; if (barEl) barEl.style.width = '0%'; }, 500);
  return results;
}

// ── Normalizza media (retrocompat vecchi post) ─────────────────────────────────
export function normalizeMedia(data) {
  if (Array.isArray(data.media) && data.media.length > 0) return data.media;
  if (data.mediaUrl) return [{ url: data.mediaUrl, type: data.mediaType || 'image', name: '' }];
  return [];
}

// ── Render griglia media (post) ────────────────────────────────────────────────
export function renderMediaGrid(mediaList) {
  if (!mediaList.length) return '';
  const imgs   = mediaList.filter(m => m.type === 'image');
  const vids   = mediaList.filter(m => m.type === 'video');
  const audios = mediaList.filter(m => m.type === 'audio');
  const visual = [...imgs, ...vids];
  let html = '';

  if (visual.length) {
    const n = visual.length;
    const cls = n === 1 ? 'c1' : n === 2 ? 'c2' : n === 3 ? 'c3' : 'cmany';
    html += `<div class="media-grid ${cls}">`;
    visual.forEach(m => {
      html += `<div class="mgitem">`;
      if (m.type === 'image') html += `<img src="${esc(m.url)}" loading="lazy" alt="foto">`;
      else                    html += `<video src="${esc(m.url)}" controls playsinline></video>`;
      html += `</div>`;
    });
    html += `</div>`;
  }
  if (audios.length) {
    html += `<div class="audio-list">`;
    audios.forEach(m => {
      html += `<div class="audio-row"><span class="aico">🎵</span><audio src="${esc(m.url)}" controls></audio></div>`;
    });
    html += `</div>`;
  }
  return html;
}

// ── Render media commento ──────────────────────────────────────────────────────
export function renderCommentMedia(data) {
  const list = normalizeMedia(data);
  if (!list.length) return '';
  const imgs   = list.filter(m => m.type === 'image');
  const vids   = list.filter(m => m.type === 'video');
  const audios = list.filter(m => m.type === 'audio');
  const visual = [...imgs, ...vids];
  let html = '';
  if (visual.length) {
    html += `<div class="cmedia-grid${visual.length === 1 ? ' single' : ''}">`;
    visual.forEach(m => {
      if (m.type === 'image') html += `<img src="${esc(m.url)}" loading="lazy">`;
      else html += `<video src="${esc(m.url)}" controls playsinline></video>`;
    });
    html += `</div>`;
  }
  if (audios.length) {
    html += `<div class="caudio-list">`;
    audios.forEach(m => {
      html += `<div class="caudio-row"><span>🎵</span><audio src="${esc(m.url)}" controls></audio></div>`;
    });
    html += `</div>`;
  }
  return html;
}

// ── Preview allegati ───────────────────────────────────────────────────────────
export function renderPreview(items, containerId, onRemove) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  if (!items.length) { wrap.innerHTML = ''; return; }

  let html = `<div class="preview-wrap">
    <div class="preview-count">${items.length} allegat${items.length === 1 ? 'o' : 'i'}</div>
    <div class="preview-grid">`;

  items.forEach((item, idx) => {
    if (item.type === 'image') {
      html += `<div class="prev-item"><img src="${esc(item.previewUrl)}" alt=""><button class="prev-remove" data-idx="${idx}">✕</button></div>`;
    } else if (item.type === 'video') {
      html += `<div class="prev-item"><video src="${esc(item.previewUrl)}" muted playsinline></video><button class="prev-remove" data-idx="${idx}">✕</button></div>`;
    } else {
      html += `<div class="prev-item audio"><span class="aico">🎵</span><audio src="${esc(item.previewUrl)}" controls></audio><span class="aname">${esc(item.name)}</span><button class="prev-remove" data-idx="${idx}">✕</button></div>`;
    }
  });

  html += `</div></div>`;
  wrap.innerHTML = html;
  wrap.querySelectorAll('.prev-remove').forEach(btn => {
    btn.addEventListener('click', () => onRemove(parseInt(btn.dataset.idx)));
  });
}
