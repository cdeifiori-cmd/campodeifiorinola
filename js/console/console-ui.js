// js/console/console-ui.js
// Helper di rendering condivisi. Nessuna logica di scrittura.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

export const SPINNER = '<div class="spinner"></div>';

export function emptyMsg(text) {
  return `<p class="empty-msg">${esc(text)}</p>`;
}

export function errorMsg(text) {
  return `<p class="empty-msg" style="color:#b03a2e">${esc(text)}</p>`;
}

/** Badge pill. kind ∈ grey|green|orange|red|blue|amber */
export function badge(text, kind = 'grey') {
  return `<span class="cbadge ${kind}">${esc(text)}</span>`;
}

/** Avatar: usa l'URL se presente (già URL Cloudinary), altrimenti emoji fallback. */
export function avatar(url, fallbackEmoji, name) {
  if (url && typeof url === 'string' && /^https?:\/\//.test(url)) {
    return `<div class="cadmin-avatar"><img src="${esc(url)}" alt="${esc(name || '')}" loading="lazy"></div>`;
  }
  return `<div class="cadmin-avatar">${esc(fallbackEmoji || '👤')}</div>`;
}

/** Formatta un Firestore Timestamp / Date / stringa ISO in data+ora leggibile. */
export function fmtDateTime(ts) {
  if (!ts) return null;
  let d = null;
  if (typeof ts.toDate === 'function') d = ts.toDate();
  else if (ts instanceof Date) d = ts;
  else if (typeof ts === 'number') d = new Date(ts);
  else if (typeof ts === 'string') { const t = new Date(ts); if (!isNaN(t)) d = t; }
  if (!d || isNaN(d)) return null;
  return d.toLocaleString('it-IT', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Testo "mancante" uniforme per i campi legacy assenti. */
export function missing(label) {
  return `<span style="color:#b0581e">— ${esc(label)}</span>`;
}

/**
 * Barra strumenti: ricerca testo + select opzionali.
 * opts = { onSearch, searchPlaceholder, selects: [{ label, options:[{value,label}], value, onChange }], count }
 * Ritorna un elemento <div class="cadmin-toolbar">.
 */
export function toolbar(opts = {}) {
  const bar = el('div', 'cadmin-toolbar');

  if (opts.onSearch) {
    const input = el('input');
    input.type = 'search';
    input.placeholder = opts.searchPlaceholder || 'Cerca per nome…';
    input.autocomplete = 'off';
    input.addEventListener('input', () => opts.onSearch(input.value.trim().toLowerCase()));
    bar.appendChild(input);
  }

  for (const sel of opts.selects || []) {
    const s = el('select');
    s.setAttribute('aria-label', sel.label || 'filtro');
    s.innerHTML = (sel.options || [])
      .map((o) => `<option value="${esc(o.value)}"${o.value === sel.value ? ' selected' : ''}>${esc(o.label)}</option>`)
      .join('');
    s.addEventListener('change', () => sel.onChange(s.value));
    bar.appendChild(s);
  }

  const count = el('span', 'cadmin-count');
  count.id = 'cadmin-live-count';
  if (opts.count != null) count.textContent = opts.count;
  bar.appendChild(count);

  return bar;
}

export function setCount(text) {
  const c = document.getElementById('cadmin-live-count');
  if (c) c.textContent = text;
}

export function sectionHead(title, subtitle) {
  return `<div class="cadmin-section-head">
    <h2>${esc(title)}</h2>
    ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
  </div>`;
}

/** Ordinamento alfabetico italiano per nome, con fallback su id. */
export function byNome(a, b) {
  return String(a.nome || a.id || '').localeCompare(String(b.nome || b.id || ''), 'it');
}
