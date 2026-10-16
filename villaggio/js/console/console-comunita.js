// js/console/console-comunita.js
// Sezione "Comunità" — SOLO lettura.
// Fonte canonica: collezione `comunita` (nessun hardcoding delle 5 comunità).
// Conteggi da `utenti` e `staff`. Nessuna normalizzazione/riscrittura dei dati.

import {
  fetchComunita, fetchUtenti, fetchStaff, normalizeComunitaIds,
} from './console-data.js';
import {
  esc, el, SPINNER, emptyMsg, errorMsg, badge, sectionHead,
} from './console-ui.js';

export async function renderComunita(container) {
  container.innerHTML = sectionHead(
    '🏘️ Comunità',
    'Lette dalla collezione "comunita". Conteggi ragazzi/operatori attuali. Sola lettura.'
  ) + SPINNER;

  let comunita, utenti, staff;
  try {
    [comunita, utenti, staff] = await Promise.all([
      fetchComunita(), fetchUtenti(), fetchStaff(),
    ]);
  } catch (e) {
    container.querySelector('.spinner')?.remove();
    container.insertAdjacentHTML('beforeend', errorMsg('Errore di caricamento: ' + e.message));
    return;
  }

  const comIds = new Set(comunita.map((c) => c.id));

  // ── Conteggi ragazzi per comunitaId (stringa singola su utenti) ──────────
  const ragazziPerCom = new Map();      // comunitaId -> { totale, archiviati }
  const ragazziOrfani = new Map();      // comunitaId sconosciuto -> conteggio
  let ragazziSenzaComunita = 0;
  for (const u of utenti) {
    const cid = typeof u.comunitaId === 'string' && u.comunitaId.trim() ? u.comunitaId.trim() : null;
    if (!cid) { ragazziSenzaComunita++; continue; }
    if (!comIds.has(cid)) {
      ragazziOrfani.set(cid, (ragazziOrfani.get(cid) || 0) + 1);
      continue;
    }
    const agg = ragazziPerCom.get(cid) || { totale: 0, archiviati: 0 };
    agg.totale++;
    if (u.stato === 'archiviato') agg.archiviati++;
    ragazziPerCom.set(cid, agg);
  }

  // ── Conteggi operatori per comunità (staff.comunitaId string|array|assente) ──
  const staffPerCom = new Map();
  const staffOrfani = new Map();
  let staffSenzaComunita = 0;
  for (const s of staff) {
    const ids = normalizeComunitaIds(s.comunitaId);
    if (!ids.length) { staffSenzaComunita++; continue; }
    for (const cid of ids) {
      if (comIds.has(cid)) staffPerCom.set(cid, (staffPerCom.get(cid) || 0) + 1);
      else staffOrfani.set(cid, (staffOrfani.get(cid) || 0) + 1);
    }
  }

  container.innerHTML = sectionHead(
    '🏘️ Comunità',
    'Lette dalla collezione "comunita". Conteggi ragazzi/operatori attuali. Sola lettura.'
  );

  if (!comunita.length) {
    container.insertAdjacentHTML('beforeend', emptyMsg('Nessun documento nella collezione "comunita".'));
    return;
  }

  const grid = el('div', 'cadmin-grid');
  for (const c of comunita) {
    const nome = c.nomeComunita || `${c.id}`;
    const rag = ragazziPerCom.get(c.id) || { totale: 0, archiviati: 0 };
    const ops = staffPerCom.get(c.id) || 0;
    const img = (typeof c.immagineUrl === 'string' && /^https?:\/\//.test(c.immagineUrl))
      ? `<img src="${esc(c.immagineUrl)}" alt="${esc(nome)}" loading="lazy">`
      : '🏡';
    const card = el('div', 'ccom-card');
    card.innerHTML = `
      <div class="ccom-thumb">${img}</div>
      <div class="ccom-body">
        <h3>${esc(nome)}</h3>
        <div class="ccom-id">${esc(c.id)}</div>
        <div class="ccom-nums">
          👦 <b>${rag.totale}</b> ragazzi${rag.archiviati ? ` <span style="color:#999">(${rag.archiviati} archiviati)</span>` : ''}<br>
          🧑‍🏫 <b>${ops}</b> operatori assegnati
        </div>
      </div>`;
    grid.appendChild(card);
  }
  container.appendChild(grid);

  // ── Pannello dati legacy / non riconosciuti ─────────────────────────────
  const orfaniRag = Array.from(ragazziOrfani.entries());
  const orfaniStaff = Array.from(staffOrfani.entries());
  if (orfaniRag.length || orfaniStaff.length || ragazziSenzaComunita || staffSenzaComunita) {
    const box = el('div', 'cadmin-note');
    let html = '<b>Dati non riconosciuti (solo informativo — nessuna correzione applicata):</b><br>';
    if (ragazziSenzaComunita) html += `• ${ragazziSenzaComunita} utenti senza <code>comunitaId</code> (probabili staff/naufraghi)<br>`;
    if (staffSenzaComunita) html += `• ${staffSenzaComunita} operatori senza <code>comunitaId</code><br>`;
    for (const [cid, n] of orfaniRag) html += `• ${n} ragazzi con comunitaId «${esc(cid)}» non presente in "comunita"<br>`;
    for (const [cid, n] of orfaniStaff) html += `• ${n} operatori con comunitaId «${esc(cid)}» non presente in "comunita"<br>`;
    box.innerHTML = html;
    container.appendChild(box);
  }
}
