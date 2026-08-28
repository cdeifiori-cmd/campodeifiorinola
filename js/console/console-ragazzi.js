// js/console/console-ragazzi.js
// Sezioni "Ragazzi" (comunità ordinarie) e "After Us".
// Milestone D: aggiunta l'azione TRASFERISCI (comunità→comunità,
// comunità→After Us, After Us→comunità: stessa operazione, transazione atomica
// in console-transfer.js). Nessun'altra azione (niente PIN/foto/archivia/crea).

import {
  fetchUtenti, fetchComunita, fetchPinStatus, COMUNITA_AFTER_US,
} from './console-data.js';
import { transferUtente, CAUSALE_MAX, AFTER_US_ID } from './console-transfer.js';
import {
  esc, el, SPINNER, emptyMsg, errorMsg, badge, avatar, fmtDateTime, missing,
  toolbar, setCount, sectionHead, byNome, confirmModal,
} from './console-ui.js';

// mode: 'ordinarie' | 'afterus'
export async function renderRagazzi(container, mode = 'ordinarie') {
  const isAfterUs = mode === 'afterus';
  const title = isAfterUs ? '🌟 After Us' : '👦 Ragazzi';
  const sub = isAfterUs
    ? 'Persone attualmente in After Us (utenti.comunitaId === "after-us"). Azione: Trasferisci verso una comunità ordinaria.'
    : 'Utenti assegnati alle comunità ordinarie. Azione: Trasferisci (anche verso After Us).';
  container.innerHTML = sectionHead(title, sub) + SPINNER;

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
  const afterUsExists = comunita.some((c) => c.id === COMUNITA_AFTER_US);
  const ordinarieIds = new Set(comunita.map((c) => c.id).filter((id) => id !== COMUNITA_AFTER_US));

  let righe = utenti.filter((u) => {
    const cid = typeof u.comunitaId === 'string' ? u.comunitaId : null;
    if (isAfterUs) return cid === COMUNITA_AFTER_US;
    return cid && ordinarieIds.has(cid);
  }).map((u) => ({ ...u }));
  righe.sort(byNome);

  const statiPresenti = Array.from(
    new Set(righe.map((r) => (typeof r.stato === 'string' && r.stato.trim() ? r.stato.trim() : '(non impostato)')))
  ).sort();

  let fSearch = '', fComunita = '', fStato = '';
  const selects = [];
  if (!isAfterUs) {
    selects.push({
      label: 'Comunità',
      options: [{ value: '', label: 'Tutte le comunità' }].concat(
        comunita.filter((c) => c.id !== COMUNITA_AFTER_US)
          .map((c) => ({ value: c.id, label: c.nomeComunita || c.id }))
      ),
      value: fComunita,
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

  container.innerHTML = sectionHead(title, sub);
  if (!isAfterUs && !afterUsExists) {
    container.insertAdjacentHTML('beforeend',
      `<div class="cadmin-note">⚠️ Il documento canonico <code>comunita/after-us</code> non esiste: il trasferimento verso After Us è disabilitato finché non viene creato.</div>`);
  }
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
    for (const r of filtrate) {
      list.appendChild(riga(r, { comNome, comunita, pin, container, isAfterUs, afterUsExists }));
    }
  }
  paint();
}

function riga(r, ctx) {
  const { comNome, comunita, pin, container, afterUsExists } = ctx;
  const row = el('div', 'cadmin-row');

  const nome = (typeof r.nome === 'string' && r.nome.trim()) ? r.nome.trim() : null;
  const comId = typeof r.comunitaId === 'string' ? r.comunitaId : null;
  const comLabel = comId ? (comNome.get(comId) || `${comId} (comunità non trovata)`) : null;
  const stato = (typeof r.stato === 'string' && r.stato.trim()) ? r.stato.trim() : null;
  const statoBadge = stato
    ? badge(stato, stato === 'archiviato' ? 'grey' : stato === 'attivo' ? 'green' : 'amber')
    : badge('stato non impostato', 'amber');

  const p = pin[r.id];
  const pinBadge = !p ? badge('PIN: n/d', 'grey')
    : p.configurato ? badge('PIN configurato', 'green') : badge('nessun PIN', 'grey');
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
       <div class="cperm-actions"></div>
     </div>`;

  const actions = row.querySelector('.cperm-actions');
  const btn = el('button', 'cperm-btn');
  btn.textContent = '↔ Trasferisci';
  btn.addEventListener('click', () => apriModaleTrasferimento(r, { comNome, comunita, container, afterUsExists }));
  actions.appendChild(btn);
  return row;
}

async function apriModaleTrasferimento(r, { comNome, comunita, container, afterUsExists }) {
  const nome = r.nome || r.id;
  const curId = typeof r.comunitaId === 'string' ? r.comunitaId : null;
  const curLabel = curId ? (comNome.get(curId) || curId) : '(nessuna)';

  // Destinazioni: tutte le comunità della collezione, esclusa quella corrente.
  const dest = comunita
    .filter((c) => c.id !== curId)
    .map((c) => ({ id: c.id, label: c.nomeComunita || c.id, isAfterUs: c.id === AFTER_US_ID }))
    .sort((a, b) => (a.isAfterUs === b.isAfterUs ? a.label.localeCompare(b.label, 'it') : (a.isAfterUs ? 1 : -1)));

  let selDest, txtCausale, riepilogo;

  const ok = await confirmModal({
    title: `↔ Trasferisci ${nome}`,
    confirmLabel: 'Trasferisci',
    build(bodyEl) {
      bodyEl.innerHTML = `
        <p class="cmodal-row"><b>Ragazzo:</b> ${esc(nome)}</p>
        <p class="cmodal-row"><b>Comunità attuale:</b> ${esc(curLabel)}</p>
        <label class="cmodal-label">Destinazione
          <select class="cmodal-input" id="cm-dest"></select>
        </label>
        <label class="cmodal-label">Causale (amministrativa, obbligatoria — no dati sensibili)
          <textarea class="cmodal-input" id="cm-causale" rows="3" maxlength="${CAUSALE_MAX}"
            placeholder="es. trasferimento struttura, passaggio maggiore età, riorganizzazione accoglienza"></textarea>
        </label>
        <div class="cmodal-summary" id="cm-summary"></div>`;
      selDest = bodyEl.querySelector('#cm-dest');
      txtCausale = bodyEl.querySelector('#cm-causale');
      riepilogo = bodyEl.querySelector('#cm-summary');
      selDest.innerHTML = '<option value="">— scegli —</option>' + dest.map((d) => {
        const disabled = d.isAfterUs && !afterUsExists;
        return `<option value="${esc(d.id)}"${disabled ? ' disabled' : ''}>${d.isAfterUs ? '🌟 ' : ''}${esc(d.label)}${disabled ? ' (documento mancante)' : ''}</option>`;
      }).join('');
      const upd = () => {
        const d = dest.find((x) => x.id === selDest.value);
        riepilogo.textContent = d
          ? `Stai trasferendo ${nome} da ${curLabel} a ${d.label}${d.isAfterUs ? ' (After Us)' : ''}.`
          : '';
      };
      selDest.addEventListener('change', upd);
      upd();
    },
    async onConfirm() {
      const destinazioneId = selDest.value;
      const causale = txtCausale.value.trim();
      if (!destinazioneId) throw new Error('Seleziona una comunità di destinazione.');
      if (!causale) throw new Error('La causale è obbligatoria.');
      await transferUtente(r.id, destinazioneId, causale);
    },
  });

  if (ok) {
    // Ricarica la sezione corrente (Ragazzi o After Us) per riflettere lo spostamento.
    const isAfterUsSection = curId === COMUNITA_AFTER_US;
    renderRagazzi(container, isAfterUsSection ? 'afterus' : 'ordinarie');
  }
}
