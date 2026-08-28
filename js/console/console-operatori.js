// js/console/console-operatori.js
// Sezioni "Operatori" e "Permessi" — SOLO lettura. Nessuna modifica agli staff.

import {
  fetchStaff, fetchComunita, normalizeComunitaIds, classifyDocumenti,
} from './console-data.js';
import { LEGACY_ADMIN_UID } from './console-auth.js';
import {
  esc, el, SPINNER, emptyMsg, errorMsg, badge, avatar, missing,
  toolbar, setCount, sectionHead, byNome,
} from './console-ui.js';

// ── Operatori ────────────────────────────────────────────────────────────

export async function renderOperatori(container) {
  container.innerHTML = sectionHead(
    '🧑‍🏫 Operatori',
    'Collezione "staff". Nome, email, ruolo, comunità, accesso Documenti, admin. Sola lettura.'
  ) + SPINNER;

  let staff, comunita;
  try {
    [staff, comunita] = await Promise.all([fetchStaff(), fetchComunita()]);
  } catch (e) {
    container.querySelector('.spinner')?.remove();
    container.insertAdjacentHTML('beforeend', errorMsg('Errore di caricamento: ' + e.message));
    return;
  }
  const comNome = new Map(comunita.map((c) => [c.id, c.nomeComunita || c.id]));
  staff = staff.slice().sort(byNome);

  let fSearch = '';
  const bar = toolbar({
    onSearch: (v) => { fSearch = v; paint(); },
    searchPlaceholder: 'Cerca operatore per nome…',
  });
  const list = el('div', 'cadmin-list');

  container.innerHTML = sectionHead(
    '🧑‍🏫 Operatori',
    'Collezione "staff". Nome, email, ruolo, comunità, accesso Documenti, admin. Sola lettura.'
  );
  container.appendChild(bar);
  container.appendChild(list);

  function comLabels(s) {
    const ids = normalizeComunitaIds(s.comunitaId);
    if (!ids.length) return missing('nessuna comunità');
    return ids.map((id) => esc(comNome.get(id) || `${id} (?)`)).join(', ');
  }

  function paint() {
    const rows = staff.filter((s) => !fSearch || String(s.nome || '').toLowerCase().includes(fSearch));
    setCount(`${rows.length} / ${staff.length}`);
    if (!rows.length) {
      list.innerHTML = emptyMsg(staff.length ? 'Nessun risultato.' : 'Nessun operatore in "staff".');
      return;
    }
    list.innerHTML = '';
    for (const s of rows) {
      const isLegacyAdmin = s.id === LEGACY_ADMIN_UID;
      const adminBadge = s.admin === true
        ? badge('admin (staff.admin)', 'blue')
        : isLegacyAdmin ? badge('admin (UID legacy)', 'blue') : badge('non admin', 'grey');
      const adRaw = Object.prototype.hasOwnProperty.call(s, 'accessoDocumenti')
        ? (s.accessoDocumenti === true ? badge('accessoDocumenti: true', 'green')
          : s.accessoDocumenti === false ? badge('accessoDocumenti: false', 'red')
          : badge('accessoDocumenti: ' + esc(String(s.accessoDocumenti)), 'amber'))
        : badge('accessoDocumenti: assente', 'grey');

      const row = el('div', 'cadmin-row');
      row.innerHTML =
        avatar(s.fotoProfilo, '🧑‍🏫', s.nome || '') +
        `<div class="cadmin-info">
           <div class="cadmin-name">${s.nome ? esc(s.nome) : missing('senza nome')}</div>
           <div class="cadmin-meta">
             <b>Email:</b> ${s.email ? esc(s.email) : missing('nessuna email')} &nbsp;·&nbsp;
             <b>Ruolo:</b> ${s.ruolo ? esc(s.ruolo) : missing('nessun ruolo')}<br>
             <b>Comunità:</b> ${comLabels(s)}<br>
             ${adRaw} &nbsp; ${adminBadge}
             &nbsp;·&nbsp; <b>UID:</b> <span style="font-family:monospace">${esc(s.id)}</span>
           </div>
         </div>`;
      list.appendChild(row);
    }
  }
  paint();
}

// ── Permessi (Documenti) ─────────────────────────────────────────────────

const STATE_META = {
  ADMIN:            { label: 'ADMIN',                 kind: 'blue',   order: 0 },
  ESPLICITO:        { label: 'ACCESSO ESPLICITO',     kind: 'green',  order: 1 },
  LEGACY_RUOLO:     { label: 'ACCESSO LEGACY DA RUOLO', kind: 'amber', order: 2 },
  NEGATO_ESPLICITO: { label: 'NEGATO ESPLICITO (oggi ancora legacy)', kind: 'red', order: 3 },
  NESSUNO:          { label: 'NESSUN ACCESSO',        kind: 'grey',   order: 4 },
};

export async function renderPermessi(container) {
  container.innerHTML = sectionHead(
    '🔐 Permessi — Accesso Documenti',
    'Chi può accedere oggi all\'Area Documenti, distinguendo valore esplicito e derivazione legacy. Sola lettura.'
  ) + SPINNER;

  let staff;
  try {
    staff = await fetchStaff();
  } catch (e) {
    container.querySelector('.spinner')?.remove();
    container.insertAdjacentHTML('beforeend', errorMsg('Errore di caricamento: ' + e.message));
    return;
  }
  staff = staff.slice().sort(byNome);

  container.innerHTML = sectionHead(
    '🔐 Permessi — Accesso Documenti',
    'Chi può accedere oggi all\'Area Documenti, distinguendo valore esplicito e derivazione legacy. Sola lettura.'
  );

  const legend = el('div', 'cperm-legend');
  legend.innerHTML = `
    <b>Come leggere gli stati</b><br>
    ${badge('ADMIN', 'blue')} accesso totale (admin === true o UID legacy).<br>
    ${badge('ACCESSO ESPLICITO', 'green')} <code>staff.accessoDocumenti === true</code>.<br>
    ${badge('ACCESSO LEGACY DA RUOLO', 'amber')} campo <code>accessoDocumenti</code> assente, ma il ruolo contiene «coordinat»/«responsabil»: le regole attuali concedono l'accesso.<br>
    ${badge('NEGATO ESPLICITO (oggi ancora legacy)', 'red')} <code>accessoDocumenti === false</code> ma il ruolo darebbe accesso: <b>oggi le regole in produzione ignorano il <code>false</code> e concedono comunque via ruolo</b>. Dalla Milestone C il <code>false</code> negherà esplicitamente.<br>
    ${badge('NESSUN ACCESSO', 'grey')} nessuna condizione soddisfatta.<br>
    <span style="color:#999">"Effettivo oggi" = esito delle Security Rules attualmente in produzione (admin ∨ accessoDocumenti===true ∨ ruolo legacy). La semantica tri-state è la destinazione della Milestone C: in questa milestone la Console mostra soltanto lo stato attuale.</span>`;
  container.appendChild(legend);

  if (!staff.length) {
    container.insertAdjacentHTML('beforeend', emptyMsg('Nessun operatore in "staff".'));
    return;
  }

  // Raggruppa per stato
  const groups = new Map();
  for (const s of staff) {
    const cls = classifyDocumenti(s);
    if (!groups.has(cls.state)) groups.set(cls.state, []);
    groups.get(cls.state).push({ s, cls });
  }
  const orderedStates = Array.from(groups.keys()).sort(
    (a, b) => (STATE_META[a]?.order ?? 99) - (STATE_META[b]?.order ?? 99)
  );

  for (const state of orderedStates) {
    const meta = STATE_META[state] || { label: state, kind: 'grey' };
    const items = groups.get(state).sort((x, y) => byNome(x.s, y.s));
    container.insertAdjacentHTML('beforeend',
      `<div class="cperm-group-title">${esc(meta.label)} — ${items.length}</div>`);
    const list = el('div', 'cadmin-list');
    for (const { s, cls } of items) {
      const rawTxt = cls.accessoDocumentiRaw === undefined
        ? 'assente'
        : String(cls.accessoDocumentiRaw);
      const row = el('div', 'cadmin-row');
      row.innerHTML =
        avatar(s.fotoProfilo, '🧑‍🏫', s.nome || '') +
        `<div class="cadmin-info">
           <div class="cadmin-name">${s.nome ? esc(s.nome) : missing('senza nome')} &nbsp; ${badge(meta.label, meta.kind)}</div>
           <div class="cadmin-meta">
             <b>accessoDocumenti:</b> ${esc(rawTxt)} &nbsp;·&nbsp;
             <b>ruolo:</b> ${s.ruolo ? esc(s.ruolo) : missing('nessun ruolo')}
             ${cls.ruoloLegacy ? badge('ruolo→accesso legacy', 'amber') : ''}<br>
             <b>Effettivo oggi:</b> ${cls.effettivoOggi ? badge('SÌ', 'green') : badge('NO', 'grey')}
             &nbsp;·&nbsp; <b>UID:</b> <span style="font-family:monospace">${esc(s.id)}</span>
           </div>
         </div>`;
      list.appendChild(row);
    }
    container.appendChild(list);
  }
}
