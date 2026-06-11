// Tooltip condiviso per le reazioni — hover (PC) e long press 500ms (mobile)
// Supporta due strutture Firestore:
//   • piazzetta: user_reactions/{uid} → { emojis:[...], nomeAutore }
//   • profilo:   reazioni/{uid}       → { tipo:'cuore',  nomeAutore }
//
// Per le reazioni precedenti senza nomeAutore, arricchisce automaticamente
// il nome leggendo dalla collezione utenti o staff tramite il docId (= uid).

import { getDocs, getDoc, collection, doc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const TIPO_EMOJI = {
  cuore:'❤️', like:'👍', dislike:'👎', risata:'😂',
  sorpresa:'😮', fuoco:'🔥', abbraccio:'🫂', commozione:'😢'
};

const MAX_SHOWN = 5; // nomi da mostrare prima di "e altri N"

// Unico elemento tooltip nel DOM, creato al primo uso
let _tip    = null;
let _anchor = null;
let _timer  = null;

// Cache: colPath → Promise<docs[]> oppure docs[] (dopo risoluzione)
const _cache = new Map();
// Cache nomi utenti/staff: uid → nome
const _nomiCache = new Map();

// ── DOM ──────────────────────────────────────────────────────────────────────
function getTip() {
  if (_tip) return _tip;
  _tip = document.createElement('div');
  _tip.id = 'rtt';
  Object.assign(_tip.style, {
    position: 'fixed', zIndex: '9999',
    background: 'rgba(22,22,22,0.93)', color: '#fff',
    fontSize: '0.8rem', fontWeight: '700',
    fontFamily: "'Nunito', sans-serif",
    padding: '6px 13px', borderRadius: '10px',
    pointerEvents: 'none', maxWidth: '300px',
    whiteSpace: 'normal', textAlign: 'center', lineHeight: '1.45',
    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
    opacity: '0', transition: 'opacity 0.13s',
    left: '-999px', top: '-999px',
  });
  document.body.appendChild(_tip);
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

export function invalidate(colPath) {
  _cache.delete(colPath);
}

// ── Posizionamento ────────────────────────────────────────────────────────────
function place(anchor, text) {
  const t = getTip();
  t.textContent = text;
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

// ── Recupera nome per un uid (con cache) ─────────────────────────────────────
async function getNome(db, uid) {
  if (_nomiCache.has(uid)) return _nomiCache.get(uid);
  try {
    let snap = await getDoc(doc(db, 'utenti', uid));
    if (!snap.exists()) snap = await getDoc(doc(db, 'staff', uid));
    const nome = snap.exists() ? (snap.data().nome || null) : null;
    _nomiCache.set(uid, nome);
    return nome;
  } catch(_) {
    _nomiCache.set(uid, null);
    return null;
  }
}

// ── Caricamento con cache e deduplicazione ────────────────────────────────────
// Restituisce tutti i doc della sotto-collezione, arricchiti di nomeAutore.
async function loadDocs(db, colPath) {
  const cached = _cache.get(colPath);
  if (cached instanceof Promise) return cached;
  if (Array.isArray(cached))     return cached;

  const promise = (async () => {
    try {
      const snap = await getDocs(collection(db, colPath));
      const raw  = [];
      snap.forEach(d => raw.push({ id: d.id, ...d.data() }));

      // Per i doc senza nomeAutore recupera il nome da utenti/staff
      const enriched = await Promise.all(raw.map(async d => {
        if (d.nomeAutore) return d;
        const nome = await getNome(db, d.id);
        return nome ? { ...d, nomeAutore: nome } : d;
      }));

      _cache.set(colPath, enriched);
      return enriched;
    } catch (e) {
      _cache.delete(colPath);
      console.warn('[Tooltip] getDocs fallito su', colPath, '—', e.message);
      return [];
    }
  })();

  _cache.set(colPath, promise);
  return promise;
}

// ── Formatta la lista dei nomi con troncamento ────────────────────────────────
function formatNames(label, names) {
  if (!names.length) return null;
  const shown = names.slice(0, MAX_SHOWN);
  const rest  = names.length - MAX_SHOWN;
  return label + ' ' + shown.join(', ') + (rest > 0 ? ` e altri ${rest}` : '');
}

// ── Logica principale ─────────────────────────────────────────────────────────
async function showFor(anchor, label, db, colPath, matchFn) {
  _anchor = anchor;
  const docs  = await loadDocs(db, colPath);
  if (_anchor !== anchor) return; // mouse andato via durante il fetch
  const names = docs.filter(matchFn).map(d => d.nomeAutore).filter(Boolean);
  const text  = formatNames(label, names);
  if (!text) return;
  place(anchor, text);
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
 * Piazzetta: user_reactions/{uid} → { emojis:[...], nomeAutore }
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
 * Profilo (diario / messaggiBottiglia): reazioni/{uid} → { tipo, nomeAutore }
 */
export function attachProfilo(container, db, collName, docId) {
  const colPath = `${collName}/${docId}/reazioni`;
  container.querySelectorAll('.btn-reazione').forEach(btn => {
    const tipo  = btn.dataset.tipo;
    const label = TIPO_EMOJI[tipo] || tipo;
    addListeners(btn, db, colPath, label, d => d.tipo === tipo);
  });
}
