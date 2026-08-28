// js/console/console-operatori.js
// Sezione "Operatori" (sola lettura) e sezione "Permessi" (lettura + azione
// SUL SOLO permesso Documenti, Milestone C — vedi console-permessi.js).

import {
  fetchStaff, fetchComunita, normalizeComunitaIds, classifyDocumenti,
} from './console-data.js';
import { LEGACY_ADMIN_UID } from './console-auth.js';
import { setAccessoDocumenti } from './console-permessi.js';
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

// ── Permessi (Documenti) — lettura + azione tri-state (Milestone C) ──────

const STATE_META = {
  ADMIN:            { label: 'ADMIN',                   kind: 'blue',  order: 0 },
  ESPLICITO:        { label: 'CONCESSO (esplicito)',    kind: 'green', order: 1 },
  LEGACY_RUOLO:     { label: 'LEGACY (accesso da ruolo)', kind: 'amber', order: 2 },
  NEGATO_ESPLICITO: { label: 'NEGATO (esplicito, prevale sul ruolo)', kind: 'red', order: 3 },
  NESSUNO:          { label: 'NESSUN ACCESSO',          kind: 'grey',  order: 4 },
};

const PERM_SUBTITLE =
  'Semantica tri-state: accessoDocumenti true/false PREVALE sul ruolo; ' +
  'campo assente = comportamento legacy da ruolo. L\'admin può concedere, negare o ripristinare il legacy.';

export async function renderPermessi(container) {
  container.innerHTML = sectionHead('🔐 Permessi — Accesso Documenti', PERM_SUBTITLE) + SPINNER;

  let staff;
  try {
    staff = await fetchStaff();
  } catch (e) {
    container.querySelector('.spinner')?.remove();
    container.insertAdjacentHTML('beforeend', errorMsg('Errore di caricamento: ' + e.message));
    return;
  }
  staff = staff.slice().sort(byNome);

  container.innerHTML = sectionHead('🔐 Permessi — Accesso Documenti', PERM_SUBTITLE);

  const legend = el('div', 'cperm-legend');
  legend.innerHTML = `
    <b>Stati</b><br>
    ${badge('ADMIN', 'blue')} accesso totale (admin === true o UID legacy) — non modificabile qui.<br>
    ${badge('CONCESSO (esplicito)', 'green')} <code>accessoDocumenti === true</code>: accesso alla propria/e comunità, a prescindere dal ruolo.<br>
    ${badge('LEGACY (accesso da ruolo)', 'amber')} campo <code>accessoDocumenti</code> assente + ruolo «coordinat»/«responsabil»: accesso.<br>
    ${badge('NEGATO (esplicito, prevale sul ruolo)', 'red')} <code>accessoDocumenti === false</code>: nessun accesso, <b>anche se coordinatore/responsabile</b>.<br>
    ${badge('NESSUN ACCESSO', 'grey')} campo assente e ruolo non abilitante, oppure <code>false</code> senza ruolo.<br>
    <span style="color:#999">«Effettivo» = esito delle Security Rules (Firestore PPU + Storage Documenti) dopo la Milestone C. Ogni modifica scrive <b>solo</b> <code>staff.accessoDocumenti</code> e crea in modo atomico una voce <code>admin_audit</code>. «Ripristina legacy» rimuove <b>solo il campo</b> (deleteField), non il documento operatore.</span>`;
  container.appendChild(legend);

  if (!staff.length) {
    container.insertAdjacentHTML('beforeend', emptyMsg('Nessun operatore in "staff".'));
    return;
  }

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
    for (const { s, cls } of items) list.appendChild(permRow(container, s, cls, meta));
    container.appendChild(list);
  }
}

function permRow(container, s, cls, meta) {
  const rawTxt = cls.accessoDocumentiRaw === undefined ? 'assente' : String(cls.accessoDocumentiRaw);
  const isAdminRow = cls.state === 'ADMIN';

  const row = el('div', 'cadmin-row');
  row.innerHTML =
    avatar(s.fotoProfilo, '🧑‍🏫', s.nome || '') +
    `<div class="cadmin-info">
       <div class="cadmin-name">${s.nome ? esc(s.nome) : missing('senza nome')} &nbsp; ${badge(meta.label, meta.kind)}</div>
       <div class="cadmin-meta">
         <b>accessoDocumenti:</b> ${esc(rawTxt)} &nbsp;·&nbsp;
         <b>ruolo:</b> ${s.ruolo ? esc(s.ruolo) : missing('nessun ruolo')}
         ${cls.ruoloLegacy ? badge('ruolo→accesso legacy', 'amber') : ''}<br>
         <b>Effettivo:</b> ${cls.effettivo ? badge('SÌ', 'green') : badge('NO', 'grey')}
         &nbsp;·&nbsp; <b>UID:</b> <span style="font-family:monospace">${esc(s.id)}</span>
       </div>
       <div class="cperm-actions"></div>
     </div>`;

  const actions = row.querySelector('.cperm-actions');
  if (isAdminRow) {
    actions.innerHTML = `<span style="font-size:0.72rem;color:#999">Stato admin: gestione non prevista in questa milestone.</span>`;
    return row;
  }

  const nome = s.nome || s.id;
  const mkBtn = (label, cls2, current, handler) => {
    const b = el('button', 'cperm-btn ' + cls2);
    b.textContent = label;
    if (current) { b.classList.add('current'); b.disabled = true; }
    else b.addEventListener('click', () => handler());
    return b;
  };

  const raw = cls.accessoDocumentiRaw; // true | false | undefined
  const doAction = async (value) => {
    let msg;
    if (value === true) {
      msg = `Concedere l'accesso a Documenti per ${nome}?\n\naccessoDocumenti verrà impostato a true (prevale sul ruolo).`;
    } else if (value === false) {
      msg = `Negare l'accesso a Documenti per ${nome}?` +
        (cls.ruoloLegacy
          ? `\n\nIl suo ruolo di coordinatore/responsabile NON gli consentirà più l'accesso.`
          : `\n\naccessoDocumenti verrà impostato a false.`);
    } else {
      msg = `Ripristinare il comportamento legacy per ${nome}?\n\n` +
        `Verrà rimosso SOLO il campo accessoDocumenti (il documento operatore resta intatto). ` +
        `L'accesso tornerà a dipendere dal ruolo (attualmente: ${cls.ruoloLegacy ? 'accesso' : 'nessun accesso'}).`;
    }
    if (!window.confirm(msg)) return;

    actions.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const res = await setAccessoDocumenti(s.id, value);
      // ricarica la sezione per riflettere il nuovo stato e i raggruppamenti
      renderPermessi(container);
      if (!res.changed) {
        // stato già coincidente: nessuna scrittura effettuata
        // (la ri-render mostra comunque lo stato corrente)
      }
    } catch (e) {
      actions.querySelectorAll('button').forEach((b) => (b.disabled = false));
      window.alert('Operazione non riuscita: ' + e.message);
    }
  };

  actions.append(
    mkBtn('✅ Concedi', 'grant', raw === true, () => doAction(true)),
    mkBtn('⛔ Nega', 'deny', raw === false, () => doAction(false)),
    mkBtn('↩︎ Legacy', 'legacy', raw === undefined, () => doAction('legacy')),
  );
  return row;
}
