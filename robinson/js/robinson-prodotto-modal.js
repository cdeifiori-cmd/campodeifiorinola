// ── Scheda prodotto (modal condiviso) ───────────────────────────────────────
// Stesso modale usato da magazzino.html (creazione/modifica prodotto) e da
// lista-spesa-dettaglio.html (apertura in sola modifica di un prodotto già
// collegato a una voce). Un'unica implementazione così contenuti, layout e
// comportamento restano identici nelle due viste.
import { db } from './robinson-firebase.js';
import { esc } from './robinson-utils.js';
import { prossimoOrdine } from './robinson-magazzino.js';
import {
  doc, setDoc, updateDoc, deleteDoc, collection, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const MODAL_HTML = `
<div class="modal-overlay" id="modal-prodotto">
  <div class="modal-box wide">
    <div class="modal-title" id="pm-title">➕ Nuovo prodotto</div>
    <div class="form-group">
      <label>Nome</label>
      <input type="text" id="pm-nome" placeholder="Es. Pasta corta">
    </div>
    <div class="form-group">
      <label>Categoria</label>
      <select id="pm-categoria"></select>
    </div>
    <div style="display:flex;gap:10px;">
      <div class="form-group" style="flex:1;">
        <label>Unità</label>
        <input type="text" id="pm-unita" placeholder="pz, kg, l...">
      </div>
      <div class="form-group" style="flex:1;">
        <label>Quantità attuale</label>
        <input type="number" id="pm-quantita" step="any" value="0">
      </div>
    </div>
    <div class="form-group">
      <label>Modalità di riordino</label>
      <select id="pm-modalita">
        <option value="soglia">Soglia — si riordina sotto un minimo (stabili)</option>
        <option value="ricorrente">Ricorrente — sempre in lista (freschi/giornalieri)</option>
        <option value="manuale">Manuale — solo su richiesta</option>
      </select>
    </div>
    <div style="display:flex;gap:10px;">
      <div class="form-group" style="flex:1;" id="pm-soglia-wrap">
        <label>Soglia minima</label>
        <input type="number" id="pm-soglia" step="any" value="0">
      </div>
      <div class="form-group" style="flex:1;" id="pm-ricorrente-wrap">
        <label>Quantità ricorrente</label>
        <input type="number" id="pm-quantita-ricorrente" step="any" placeholder="–">
      </div>
      <div class="form-group" style="flex:1;" id="pm-scorta-wrap">
        <label>Scorta obiettivo (opz.)</label>
        <input type="number" id="pm-scorta-obiettivo" step="any" placeholder="–">
      </div>
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="pm-serve"> Serve — inseriscilo nella prossima lista spesa</label>
    </div>
    <div class="form-group">
      <label>Prezzo di riferimento (opz.)</label>
      <input type="number" id="pm-prezzo" step="0.01" placeholder="€">
    </div>
    <div class="msg-esito" id="pm-error" style="color:var(--rosso);font-size:0.8rem;min-height:18px;"></div>
    <div style="display:flex;gap:10px;margin-top:8px;">
      <button class="btn btn-primary" id="pm-salva" style="flex:1;">💾 Salva</button>
      <button class="btn" id="pm-elimina" style="display:none;background:none;border:1.5px solid var(--rosso);color:var(--rosso);">🗑️ Elimina</button>
      <button class="btn" id="pm-annulla" style="background:none;border:1.5px solid var(--navy);color:var(--navy);">Annulla</button>
    </div>
  </div>
</div>`;

// getCategorie(), getProdotti(): getter sugli array già caricati dalla pagina
// (servono per popolare la select categoria e calcolare il prossimo `ordine`).
// getCurrentUser(): getter sull'utente autenticato (serve solo in creazione).
// onChange(): callback async invocata dopo salvataggio/eliminazione, per far
// ricaricare e ri-renderizzare i dati alla pagina chiamante.
export function initModalProdotto({ getCategorie, getProdotti, getCurrentUser, onChange }) {
  if (!document.getElementById('modal-prodotto')) {
    document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
  }

  let editUid = null;

  function popolaSelectCategorie() {
    const sel = document.getElementById('pm-categoria');
    sel.innerHTML = getCategorie().map(c => `<option value="${esc(c.id)}">${esc(c.nome)}</option>`).join('');
  }

  function aggiornaVisibilitaCampiModalita() {
    const m = document.getElementById('pm-modalita').value;
    document.getElementById('pm-soglia-wrap').style.display = m === 'soglia' ? '' : 'none';
    document.getElementById('pm-ricorrente-wrap').style.display = m === 'ricorrente' ? '' : 'none';
    document.getElementById('pm-scorta-wrap').style.display = m === 'soglia' ? '' : 'none';
  }
  document.getElementById('pm-modalita').addEventListener('change', aggiornaVisibilitaCampiModalita);

  function apri(p, categoriaDefault) {
    popolaSelectCategorie();
    const categorie = getCategorie();
    editUid = p?.id || null;
    document.getElementById('pm-title').textContent = p ? '✏️ Modifica prodotto' : '➕ Nuovo prodotto';
    document.getElementById('pm-nome').value = p?.nome || '';
    document.getElementById('pm-categoria').value = p?.categoria || categoriaDefault || (categorie[0]?.id || '');
    document.getElementById('pm-unita').value = p?.unita || '';
    document.getElementById('pm-quantita').value = p?.quantita_attuale ?? 0;
    document.getElementById('pm-modalita').value = p?.modalita_riordino || 'soglia';
    document.getElementById('pm-soglia').value = p?.soglia_minima ?? 0;
    document.getElementById('pm-quantita-ricorrente').value = p?.quantita_ricorrente ?? '';
    document.getElementById('pm-scorta-obiettivo').value = p?.scorta_obiettivo ?? '';
    document.getElementById('pm-serve').checked = !!p?.serve;
    document.getElementById('pm-prezzo').value = p?.prezzo_riferimento ?? '';
    document.getElementById('pm-error').textContent = '';
    document.getElementById('pm-elimina').style.display = p ? 'block' : 'none';
    aggiornaVisibilitaCampiModalita();
    document.getElementById('modal-prodotto').classList.add('open');
  }

  document.getElementById('pm-annulla').addEventListener('click', () => document.getElementById('modal-prodotto').classList.remove('open'));

  document.getElementById('pm-salva').addEventListener('click', async () => {
    const nome = document.getElementById('pm-nome').value.trim();
    const errEl = document.getElementById('pm-error');
    if (!nome) { errEl.textContent = 'Inserisci il nome del prodotto.'; return; }
    const categoria = document.getElementById('pm-categoria').value;
    const unita = document.getElementById('pm-unita').value.trim();
    const quantita_attuale = parseFloat(document.getElementById('pm-quantita').value) || 0;
    const modalita_riordino = document.getElementById('pm-modalita').value;
    const soglia_minima = parseFloat(document.getElementById('pm-soglia').value) || 0;
    const ricorrenteRaw = document.getElementById('pm-quantita-ricorrente').value;
    const quantita_ricorrente = ricorrenteRaw === '' ? null : parseFloat(ricorrenteRaw);
    const scorteRaw = document.getElementById('pm-scorta-obiettivo').value;
    const scorta_obiettivo = scorteRaw === '' ? null : parseFloat(scorteRaw);
    const serve = document.getElementById('pm-serve').checked;
    const prezzoRaw = document.getElementById('pm-prezzo').value;
    const prezzo_riferimento = prezzoRaw === '' ? null : parseFloat(prezzoRaw);

    const dati = { nome, categoria, unita, quantita_attuale, modalita_riordino, soglia_minima, quantita_ricorrente, scorta_obiettivo, serve, prezzo_riferimento, attivo: true, aggiornato_il: serverTimestamp() };

    // Nuovo prodotto o cambio di categoria: append in coda alla categoria di
    // destinazione. Altrimenti l'`ordine` esistente resta invariato.
    const prodotti = getProdotti();
    const originale = editUid ? prodotti.find(p => p.id === editUid) : null;
    if (!originale || originale.categoria !== categoria) {
      dati.ordine = prossimoOrdine(prodotti.filter(p => p.categoria === categoria && p.id !== editUid));
    }

    try {
      if (editUid) {
        await updateDoc(doc(db, 'magazzino_prodotti', editUid), dati);
      } else {
        await setDoc(doc(collection(db, 'magazzino_prodotti')), { ...dati, creato_da: getCurrentUser().uid, creato_il: serverTimestamp() });
      }
      document.getElementById('modal-prodotto').classList.remove('open');
      await onChange();
    } catch (e) {
      errEl.textContent = 'Errore: ' + e.message;
    }
  });

  document.getElementById('pm-elimina').addEventListener('click', async () => {
    if (!editUid) return;
    if (!confirm('Eliminare questo prodotto dal magazzino?')) return;
    await deleteDoc(doc(db, 'magazzino_prodotti', editUid));
    document.getElementById('modal-prodotto').classList.remove('open');
    await onChange();
  });

  return { apri };
}
