// Tooltip condiviso per le reazioni — hover (PC) e long press 500ms (mobile)
// Supporta due strutture Firestore:
//   • piazzetta: user_reactions/{uid} → { emojis:[...], nomeAutore }
//   • profilo:   reazioni/{uid}       → { tipo:'cuore',  nomeAutore }

import { getDocs, collection }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const TIPO_EMOJI = {
  cuore:'❤️', like:'👍', dislike:'👎', risata:'😂',
  sorpresa:'😮', fuoco:'🔥', abbraccio:'🫂', commozione:'😢'
};

// Unico elemento tooltip nel DOM, creato al primo uso
let _tip    = null;
let _anchor = null; // bottone correntemente "hovered" — se cambia, annulla il fetch
let _timer  = null; // timer long-press

// Cache: colPath (stringa) → Promise<Array<docData>> | Array<docData>
const _cache = new Map();

// ── DOM ──────────────────────────────────────────────────────────────────────
function getTip() {
  if (_tip) return _tip;
  _tip = document.createElement('div');
  _tip.id = 'rtt'; // reaction-tooltip shared
  Object.assign(_tip.style, {
    position: 'fixed', zIndex: '9999',
    background: 'rgba(22,22,22,0.93)', color: '#fff',
    fontSize: '0.8rem', fontWeight: '700',
    fontFamily: "'Nunito', sans-serif",
    padding: '6px 13px', borderRadius: '10px',
    pointerEvents: 'none', maxWidth: '280px',
    whiteSpace: 'normal', textAlign: 'center', lineHeight: '1.45',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    opacity: '0', transition: 'opacity 0.13s',
    left: '-999px', top: '-999px',
  });
  document.body.appendChild(_tip);
  // Tap fuori → nasconde
  document.addEventListener('touchstart', e => {
    if (!e.target.dataset.rtt) hide();
  }, { passive: true });
  return _tip;
}

// ── Pubblico ──────────────────────────────────────────────────────────────────
export function hide() {
  _anchor = null;
  clearTimeout(_timer);
  getTip().style.opacity = '0';
}

/** Invalida la cache per un percorso (chiamare dopo ogni toggleReazione). */
export function invalidate(colPath) {
  _cache.delete(colPath);
}

// ── Posizionamento ────────────────────────────────────────────────────────────
function place(anchor, text) {
  const t = getTip();
  t.textContent = text;
  // Primo frame: misura; secondo frame: posiziona
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (_anchor !== anchor) return;
      const r  = anchor.getBoundingClientRect();
      const tw = t.offsetWidth  || 120;
      const th = t.offsetHeight || 28;
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.max(6, Math.min(left, window.innerWidth - tw - 6));
      const topAbove = r.top - th - 8;
      t.style.left = left + 'px';
      t.style.top  = (topAbove >= 4 ? topAbove : r.bottom + 6) + 'px';
      t.style.opacity = '1';
    });
  });
}

// ── Caricamento con cache e deduplicazione ────────────────────────────────────
async function loadDocs(db, colPath) {
  const cached = _cache.get(colPath);
  if (cached instanceof Promise) return cached; // in volo: aspetta lo stesso
  if (Array.isArray(cached)) return cached;     // già caricato

  const promise = getDocs(collection(db, colPath))
    .then(snap => {
      const docs = [];
      snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
      _cache.set(colPath, docs); // sostituisce la Promise con l'array
      return docs;
    })
    .catch(e => {
      _cache.delete(colPath); // riprova la prossima volta
      console.warn('[Tooltip] getDocs fallito su', colPath, '—', e.message);
      return [];
    });

  _cache.set(colPath, promise);
  return promise;
}

// ── Logica principale ─────────────────────────────────────────────────────────
async function showFor(anchor, label, db, colPath, matchFn) {
  _anchor = anchor;
  const docs = await loadDocs(db, colPath);
  if (_anchor !== anchor) return; // mouse andato via durante il fetch
  const names = docs.filter(matchFn).map(d => d.nomeAutore).filter(Boolean);
  if (!names.length) return;
  place(anchor, label + ' ' + names.join(', '));
}

function addListeners(btn, db, colPath, label, matchFn) {
  btn.dataset.rtt = '1';
  btn.addEventListener('mouseenter', () => showFor(btn, label, db, colPath, matchFn));
  btn.addEventListener('mouseleave', hide);
  btn.addEventListener('touchstart', () => {
    _timer = setTimeout(() => showFor(btn, label, db, colPath, matchFn), 500);
  }, { passive: true });
  btn.addEventListener('touchend',  () => clearTimeout(_timer));
  btn.addEventListener('touchmove', () => clearTimeout(_timer));
}

// ── API pubblica ──────────────────────────────────────────────────────────────

/**
 * Piazzetta: ogni doc user_reactions/{uid} ha { emojis:[...], nomeAutore }
 * container = elemento card, db = Firestore, postId = ID del post
 */
export function attachPiazzetta(container, db, postId) {
  const colPath = `piazzetta_posts/${postId}/user_reactions`;
  container.querySelectorAll('.reaction-btn').forEach(btn => {
    const emoji = btn.dataset.emoji;
    addListeners(btn, db, colPath, emoji,
      d => Array.isArray(d.emojis) && d.emojis.includes(emoji));
  });
}

/**
 * Profilo (diario / messaggiBottiglia): ogni doc reazioni/{uid} ha { tipo, nomeAutore }
 * container = elemento card, db = Firestore
 * collName = 'diario' | 'messaggiBottiglia', docId = ID del documento
 */
export function attachProfilo(container, db, collName, docId) {
  const colPath = `${collName}/${docId}/reazioni`;
  container.querySelectorAll('.btn-reazione').forEach(btn => {
    const tipo  = btn.dataset.tipo;
    const label = TIPO_EMOJI[tipo] || tipo;
    addListeners(btn, db, colPath, label, d => d.tipo === tipo);
  });
}
