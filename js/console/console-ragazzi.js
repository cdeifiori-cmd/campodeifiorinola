// js/console/console-ragazzi.js
// Sezioni "Ragazzi" (comunità ordinarie) e "After Us".
// Milestone D: aggiunta l'azione TRASFERISCI (comunità→comunità,
// comunità→After Us, After Us→comunità: stessa operazione, transazione atomica
// in console-transfer.js). Nessun'altra azione (niente PIN/foto/archivia/crea).

import {
  fetchUtenti, fetchComunita, fetchPinStatus, COMUNITA_AFTER_US,
} from './console-data.js';
import { transferUtente, CAUSALE_MAX, AFTER_US_ID } from './console-transfer.js';
import { creaRagazzo, generaPinCandidato, validaPin } from './console-crea-ragazzo.js';
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

  const nuovoBtn = el('button', 'cperm-btn', '➕ Nuovo ragazzo');
  nuovoBtn.style.margin = '0 0 10px';
  nuovoBtn.addEventListener('click', () =>
    apriModaleNuovoRagazzo({ comunita, container, isAfterUs, afterUsExists }));
  container.appendChild(nuovoBtn);

  if (!isAfterUs && !afterUsExists) {
    container.insertAdjacentHTML('beforeend',
      `<div class="cadmin-note">⚠️ Il documento canonico <code>comunita/after-us</code> non esiste: trasferimento e inserimento diretto in After Us disabilitati finché non viene creato.</div>`);
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

// ── + NUOVO RAGAZZO (Milestone E — creazione server-side) ─────────────────
async function apriModaleNuovoRagazzo({ comunita, container, isAfterUs, afterUsExists }) {
  const opts = comunita
    .map((c) => ({ id: c.id, label: c.nomeComunita || c.id, isAfterUs: c.id === AFTER_US_ID }))
    .sort((a, b) => (a.isAfterUs === b.isAfterUs ? a.label.localeCompare(b.label, 'it') : (a.isAfterUs ? 1 : -1)));

  let inNome, selCom, inPin, inPin2, btnGen, chkShow, inFoto, fotoPrev, inCausale;

  const ok = await confirmModal({
    title: '➕ Nuovo ragazzo',
    confirmLabel: 'Crea',
    build(b) {
      b.innerHTML = `
        <label class="cmodal-label">Nome
          <input class="cmodal-input" id="nr-nome" type="text" maxlength="200" autocomplete="off">
        </label>
        <label class="cmodal-label">Comunità
          <select class="cmodal-input" id="nr-com"></select>
        </label>
        <label class="cmodal-label">PIN (4–6 cifre)
          <span style="display:flex;gap:6px;align-items:center">
            <input class="cmodal-input" id="nr-pin" type="text" inputmode="numeric" maxlength="6" style="flex:1" autocomplete="off">
            <button type="button" class="cperm-btn" id="nr-gen">🎲 Genera</button>
          </span>
        </label>
        <label class="cmodal-label">Conferma PIN
          <input class="cmodal-input" id="nr-pin2" type="password" inputmode="numeric" maxlength="6" autocomplete="off">
        </label>
        <label style="font-size:0.78rem;color:#666;display:flex;gap:6px;align-items:center;margin-top:6px">
          <input type="checkbox" id="nr-show"> mostra PIN
        </label>
        <label class="cmodal-label">Foto (opzionale, immagine ≤ 5 MB)
          <input class="cmodal-input" id="nr-foto" type="file" accept="image/*">
        </label>
        <div id="nr-foto-prev" style="margin-top:6px"></div>
        <label class="cmodal-label">Causale (amministrativa, obbligatoria — no dati sensibili)
          <textarea class="cmodal-input" id="nr-causale" rows="2" maxlength="500"
            placeholder="es. Prima assegnazione">Prima assegnazione</textarea>
        </label>`;
      inNome = b.querySelector('#nr-nome');
      selCom = b.querySelector('#nr-com');
      inPin = b.querySelector('#nr-pin');
      inPin2 = b.querySelector('#nr-pin2');
      btnGen = b.querySelector('#nr-gen');
      chkShow = b.querySelector('#nr-show');
      inFoto = b.querySelector('#nr-foto');
      fotoPrev = b.querySelector('#nr-foto-prev');
      inCausale = b.querySelector('#nr-causale');

      selCom.innerHTML = '<option value="">— scegli —</option>' + opts.map((o) => {
        const disabled = o.isAfterUs && !afterUsExists;
        return `<option value="${esc(o.id)}"${disabled ? ' disabled' : ''}>${o.isAfterUs ? '🌟 ' : ''}${esc(o.label)}${disabled ? ' (documento mancante)' : ''}</option>`;
      }).join('');
      if (isAfterUs && afterUsExists) selCom.value = AFTER_US_ID;

      btnGen.addEventListener('click', () => {
        const p = generaPinCandidato();
        inPin.value = p; inPin2.value = p;
      });
      chkShow.addEventListener('change', () => {
        inPin.type = inPin2.type = chkShow.checked ? 'text' : 'password';
      });
      inPin.type = 'password';
      inFoto.addEventListener('change', () => {
        fotoPrev.innerHTML = '';
        const f = inFoto.files[0];
        if (!f) return;
        if (!/^image\//.test(f.type)) { fotoPrev.innerHTML = '<span style="color:#b03a2e;font-size:0.78rem">Non è un\'immagine</span>'; return; }
        if (f.size > 5 * 1024 * 1024) { fotoPrev.innerHTML = '<span style="color:#b03a2e;font-size:0.78rem">Troppo grande (max 5 MB)</span>'; return; }
        const img = new Image();
        img.style.cssText = 'max-width:80px;max-height:80px;border-radius:8px;object-fit:cover';
        img.src = URL.createObjectURL(f);
        fotoPrev.appendChild(img);
      });
    },
    async onConfirm() {
      const nome = inNome.value.trim();
      const comunitaId = selCom.value;
      const pin = inPin.value.trim();
      const pin2 = inPin2.value.trim();
      const causale = inCausale.value.trim();
      const fotoFile = inFoto.files[0] || null;

      if (!nome) throw new Error('Il nome è obbligatorio.');
      if (!comunitaId) throw new Error('Seleziona una comunità.');
      if (!validaPin(pin)) throw new Error('Il PIN deve essere di 4–6 cifre.');
      if (pin !== pin2) throw new Error('I due PIN non coincidono.');
      if (!causale) throw new Error('La causale è obbligatoria.');

      const res = await creaRagazzo({ nome, comunitaId, pin, causale, fotoFile });
      if (res.fotoErrore) {
        // creazione riuscita, foto no: si informa senza bloccare
        window.alert(`Ragazzo creato correttamente (PIN: ${pin}). Foto non caricata: ${res.fotoErrore}`);
      } else {
        window.alert(`Ragazzo creato correttamente. PIN: ${pin}${res.fotoCaricata ? ' · foto caricata' : ''}`);
      }
    },
  });

  if (ok) renderRagazzi(container, isAfterUs ? 'afterus' : 'ordinarie');
}
