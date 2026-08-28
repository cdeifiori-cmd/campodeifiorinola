// js/console/console-ragazzi.js
// Sezioni "Ragazzi" (comunità ordinarie) e "After Us" — SOLO lettura.
// Nessuna azione: niente crea/cambia PIN, archivia, trasferisci, cambia foto.

import {
  fetchUtenti, fetchComunita, fetchPinStatus, COMUNITA_AFTER_US,
} from './console-data.js';
import {
  esc, el, SPINNER, emptyMsg, errorMsg, badge, avatar, fmtDateTime, missing,
  toolbar, setCount, sectionHead, byNome,
} from './console-ui.js';

// mode: 'ordinarie' | 'afterus'
export async function renderRagazzi(container, mode = 'ordinarie') {
  const isAfterUs = mode === 'afterus';
  container.innerHTML = sectionHead(
    isAfterUs ? '🌟 After Us' : '👦 Ragazzi',
    isAfterUs
      ? 'Persone attualmente in After Us (utenti.comunitaId === "after-us"). Sola lettura.'
      : 'Utenti assegnati alle comunità ordinarie. Sola lettura.'
  ) + SPINNER;

  let utenti, comunita, pin;
  try {
    [utenti, comunita, pin] = await Promise.all([
      fetchUtenti(), fetchComunita(), fetchPinStatus(),
    ]);
  } catch (e) {
    container.querySelector('.spinner')?.remove();
    container.insertAdjacentHTML('beforeend', errorMsg('Errore di caricamento: ' + e.message));
    return;
  }

  const comNome = new Map(comunita.map((c) => [c.id, c.nomeComunita || c.id]));
  const ordinarieIds = new Set(comunita.map((c) => c.id).filter((id) => id !== COMUNITA_AFTER_US));

  // Selezione righe
  let righe = utenti.filter((u) => {
    const cid = typeof u.comunitaId === 'string' ? u.comunitaId : null;
    if (isAfterUs) return cid === COMUNITA_AFTER_US;
    // ordinarie: comunitaId presente e riconosciuto come comunità non-After-Us
    return cid && ordinarieIds.has(cid);
  }).map((u) => ({ ...u }));

  righe.sort(byNome);

  // Stati distinti presenti (per il filtro)
  const statiPresenti = Array.from(
    new Set(righe.map((r) => (typeof r.stato === 'string' && r.stato.trim() ? r.stato.trim() : '(non impostato)')))
  ).sort();

  // Stato filtri
  let fSearch = '';
  let fComunita = '';
  let fStato = '';

  const selects = [];
  if (!isAfterUs) {
    const comOpts = [{ value: '', label: 'Tutte le comunità' }].concat(
      comunita.filter((c) => c.id !== COMUNITA_AFTER_US)
        .map((c) => ({ value: c.id, label: c.nomeComunita || c.id }))
    );
    selects.push({
      label: 'Comunità', options: comOpts, value: fComunita,
      onChange: (v) => { fComunita = v; paint(); },
    });
  }
  if (statiPresenti.length > 1) {
    selects.push({
      label: 'Stato',
      options: [{ value: '', label: 'Tutti gli stati' }].concat(
        statiPresenti.map((s) => ({ value: s, label: s }))
      ),
      value: fStato,
      onChange: (v) => { fStato = v; paint(); },
    });
  }

  const bar = toolbar({
    onSearch: (v) => { fSearch = v; paint(); },
    searchPlaceholder: 'Cerca ragazzo per nome…',
    selects,
  });

  const list = el('div', 'cadmin-list');

  container.innerHTML = sectionHead(
    isAfterUs ? '🌟 After Us' : '👦 Ragazzi',
    isAfterUs
      ? 'Persone attualmente in After Us (utenti.comunitaId === "after-us"). Sola lettura.'
      : 'Utenti assegnati alle comunità ordinarie. Sola lettura.'
  );
  container.appendChild(bar);
  container.appendChild(list);

  function paint() {
    const filtrate = righe.filter((r) => {
      if (fSearch && !String(r.nome || '').toLowerCase().includes(fSearch)) return false;
      if (fComunita && r.comunitaId !== fComunita) return false;
      if (fStato) {
        const s = (typeof r.stato === 'string' && r.stato.trim()) ? r.stato.trim() : '(non impostato)';
        if (s !== fStato) return false;
      }
      return true;
    });
    setCount(`${filtrate.length} / ${righe.length}`);

    if (!filtrate.length) {
      list.innerHTML = emptyMsg(righe.length ? 'Nessun risultato con questi filtri.' : 'Nessun ragazzo trovato.');
      return;
    }
    list.innerHTML = '';
    for (const r of filtrate) list.appendChild(riga(r, comNome, pin));
  }

  paint();
}

function riga(r, comNome, pin) {
  const row = el('div', 'cadmin-row');

  const nome = (typeof r.nome === 'string' && r.nome.trim()) ? r.nome.trim() : null;
  const comId = typeof r.comunitaId === 'string' ? r.comunitaId : null;
  const comLabel = comId ? (comNome.get(comId) || `${comId} (comunità non trovata)`) : null;
  const stato = (typeof r.stato === 'string' && r.stato.trim()) ? r.stato.trim() : null;

  const statoBadge = stato
    ? badge(stato, stato === 'archiviato' ? 'grey' : stato === 'attivo' ? 'green' : 'amber')
    : badge('stato non impostato', 'amber');

  const p = pin[r.id];
  let pinBadge;
  if (!p) pinBadge = badge('PIN: n/d', 'grey');
  else if (p.configurato) pinBadge = badge('PIN configurato', 'green');
  else pinBadge = badge('nessun PIN', 'grey');

  const ultimo = p && p.lastLogin ? fmtDateTime(p.lastLogin) : null;

  row.innerHTML =
    avatar(r.fotoProfilo, '🧒', nome || '') +
    `<div class="cadmin-info">
       <div class="cadmin-name">${nome ? esc(nome) : missing('senza nome')}</div>
       <div class="cadmin-meta">
         <b>Comunità:</b> ${comLabel ? esc(comLabel) : missing('nessuna comunità')} &nbsp;·&nbsp;
         ${statoBadge} &nbsp; ${pinBadge}<br>
         <b>Ultimo accesso PIN:</b> ${ultimo ? esc(ultimo) : '<span style="color:#999">mai / non disponibile</span>'}
         &nbsp;·&nbsp; <b>UID:</b> <span style="font-family:monospace">${esc(r.id)}</span>
       </div>
     </div>`;
  return row;
}
