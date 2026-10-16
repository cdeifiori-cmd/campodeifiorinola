// js/ppu-scheda-c.js — "Le persone intorno a me" (Scheda C PPU): strumento
// sociometrico visuale da usare CON il ragazzo (13/14-17 anni) durante il
// colloquio educativo. Non è un test, non produce punteggi, non attribuisce
// etichette: conserva e rappresenta solo dati descrittivi della rete
// relazionale in quel momento.
//
// Complementare alle Schede A e B (js/ppu-scheda-a.js, js/ppu-scheda-b.js):
//   Scheda A → «Come mi vedo?»                    (immagine di sé)
//   Scheda B → «Come penso che mi vedano gli altri?» (immagine riflessa)
//   Scheda C → «Le persone intorno a me»          (rete relazionale)
//
// A differenza di A e B, la Scheda C non ha scala 0-3 né stepper per aree:
// ha DUE sociogrammi interattivi indipendenti (C1 "vicinanza", C2 "fatica").
// Il nucleo dati puro sta in js/ppu-scheda-c-model.js (testabile senza
// Firebase); qui si aggiungono la persistenza Firestore e l'interfaccia.
//
// Architettura di persistenza modellata 1:1 su Scheda A / B: collezione
// dedicata (ppu_schede_c), una scheda = una fotografia storicizzata (mai
// sovrascritta), stati bozza/completata con riapertura, autosalvataggio
// con debounce, selettori "momento PPU" e "colloquio condotto da",
// autorizzazioni Firestore identiche (canAccessPPU).
//
// Riceve `db` per dependency injection (nessuna init Firebase propria):
// il chiamante (documenti.html) passa la stessa istanza già inizializzata.

import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  CENTER_ID, CENTER_LABEL, SOCIOGRAMMI, DIREZIONI, DIREZIONE_DEFAULT,
  QUALITA_RELAZIONE, QUALITA_DEFAULT, MOMENTI_PPU, INSTRUMENT, INSTRUMENT_VERSION,
  coloreQualita, labelQualita, labelDirezione, simboloDirezione, labelMomento,
  clamp01, distanzaDalCentro, sociogrammaVuoto, normalizzaSociogramma,
  GEOMETRIA, geometriaArco, disegnaSociogrammaSVG, dimensioniNodo,
  aggiungiNodo, rinominaNodo, spostaNodo, impostaNotaNodo, eliminaNodo,
  arcoTraCoppia, creaArco, impostaDirezioneArco, impostaQualitaArco, eliminaArco,
  contaPersone, nomeNodo, descriviArco, validaCompletamento,
} from './ppu-scheda-c-model.js';

export {
  SOCIOGRAMMI, DIREZIONI, QUALITA_RELAZIONE, MOMENTI_PPU,
  labelMomento, labelQualita, labelDirezione, validaCompletamento,
} from './ppu-scheda-c-model.js';

const COLLECTION = 'ppu_schede_c';
const AUTOSAVE_DEBOUNCE_MS = 1000;

// ── Firestore: CRUD (stessi pattern di Scheda A / B) ────────────────────

export async function elencaSchede(db, { minorId, comunitaId }) {
  const snap = await getDocs(query(
    collection(db, COLLECTION),
    where('minorId', '==', minorId),
    where('comunitaId', '==', comunitaId),
    orderBy('createdAt', 'desc')
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function creaSchedaBozza(db, { minorId, comunitaId, createdBy }) {
  const ref = await addDoc(collection(db, COLLECTION), {
    minorId, comunitaId,
    assessmentDate: serverTimestamp(),
    ppuMoment: null,
    ppuMomentNote: '',
    status: 'bozza',
    createdBy,
    conductedBy: createdBy, // precompilato con chi crea la scheda, modificabile
    tabCorrente: 'vicinanza',
    sociogrammi: {
      vicinanza: sociogrammaVuoto(),
      fatica: sociogrammaVuoto(),
    },
    note: '',
    instrument: INSTRUMENT,
    instrumentVersion: INSTRUMENT_VERSION,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
    completedBy: null,
    reopenedAt: null,
    reopenedBy: null,
  });
  return ref.id;
}

export async function caricaScheda(db, schedaId) {
  const snap = await getDoc(doc(db, COLLECTION, schedaId));
  if (!snap.exists()) throw new Error('Scheda non trovata.');
  const data = { id: snap.id, ...snap.data() };
  // Normalizza i due sociogrammi così l'interfaccia lavora sempre su una
  // struttura completa e coerente, anche per schede vecchie o parziali.
  data.sociogrammi = data.sociogrammi || {};
  data.sociogrammi.vicinanza = normalizzaSociogramma(data.sociogrammi.vicinanza);
  data.sociogrammi.fatica    = normalizzaSociogramma(data.sociogrammi.fatica);
  return data;
}

export async function salvaPatch(db, schedaId, patch) {
  await updateDoc(doc(db, COLLECTION, schedaId), { ...patch, updatedAt: serverTimestamp() });
}

export async function completaScheda(db, schedaId, completedBy) {
  await updateDoc(doc(db, COLLECTION, schedaId), {
    status: 'completata', completedAt: serverTimestamp(), completedBy, updatedAt: serverTimestamp()
  });
}

export async function riapriScheda(db, schedaId, reopenedBy) {
  await updateDoc(doc(db, COLLECTION, schedaId), {
    status: 'bozza', reopenedAt: serverTimestamp(), reopenedBy, updatedAt: serverTimestamp()
  });
}

// Operatori della comunità per il selettore "colloquio condotto da"
// (stessa collezione/pattern di Scheda A / B e del gate di documenti.html).
export async function elencaOperatoriComunita(db, comunitaId) {
  const snap = await getDocs(collection(db, 'staff'));
  const list = [];
  snap.forEach(d => {
    const data = d.data();
    const c = data.comunitaId;
    const match = Array.isArray(c) ? c.includes(comunitaId) : c === comunitaId;
    if (match) list.push({ uid: d.id, nome: data.nome || d.id });
  });
  list.sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  return list;
}

// ── UI: helper generici ────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}

function fmtData(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('it-IT', { day:'numeric', month:'short', year:'numeric' });
}

async function getNomePersona(db, uid) {
  if (!uid) return '—';
  for (const coll of ['staff', 'utenti', 'amici']) {
    try {
      const snap = await getDoc(doc(db, coll, uid));
      if (snap.exists()) return snap.data().nome || uid;
    } catch (_) {}
  }
  return uid;
}

function tronca(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ── UI: elenco delle Schede C di un ragazzo ────────────────────────────
// ctx = { db, ragazzo, community, canWrite, currentUid, go }
export async function montaElenco(main, ctx) {
  const { db, ragazzo, community, canWrite, currentUid, go } = ctx;
  main.innerHTML = '<div class="spinner"></div>';

  let schede;
  try {
    schede = await elencaSchede(db, { minorId: ragazzo.id, comunitaId: community.id });
  } catch (e) {
    main.innerHTML = `<p class="empty-msg">Errore: ${esc(e.message)}</p>`;
    return;
  }

  main.innerHTML = `
    <div class="folder-header">
      <div>
        <div class="folder-title">LE PERSONE INTORNO A ME</div>
        <div style="font-size:0.72rem;color:#999;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-top:1px;">Scheda C — PPU</div>
      </div>
      ${canWrite ? '<div class="folder-actions"><button class="btn-act" id="ppuc-nuova">➕ Nuova scheda</button></div>' : ''}
    </div>
    <p style="padding:0 14px 10px;font-size:0.78rem;color:#888;">
      Mappa delle relazioni di ${esc(ragazzo.nome||'il ragazzo/a')}, disegnata insieme durante il colloquio.
      Ogni scheda è una fotografia di quel momento e non sostituisce le precedenti.
    </p>
    <div class="item-list" id="ppuc-lista"></div>`;

  const nomiCache = {};
  async function nome(uid) {
    if (!uid) return '—';
    if (!nomiCache[uid]) nomiCache[uid] = await getNomePersona(db, uid);
    return nomiCache[uid];
  }

  const lista = document.getElementById('ppuc-lista');
  if (!schede.length) {
    lista.innerHTML = '<p class="empty-msg">📭 Nessuna scheda compilata finora.</p>';
  } else {
    for (const s of schede) {
      const badge = s.status === 'completata'
        ? '<span style="background:#e8f5e9;color:#2d7a3a;border-radius:20px;padding:2px 10px;font-size:0.68rem;font-weight:700;">✅ Completata</span>'
        : '<span style="background:#fff3cd;color:#8a6a1a;border-radius:20px;padding:2px 10px;font-size:0.68rem;font-weight:700;">✏️ Bozza</span>';
      const momento = labelMomento(s.ppuMoment) || 'Momento non indicato';
      const conduttore = await nome(s.conductedBy);
      const nV = Array.isArray(s?.sociogrammi?.vicinanza?.nodes) ? Math.max(0, s.sociogrammi.vicinanza.nodes.length - 1) : 0;
      const nF = Array.isArray(s?.sociogrammi?.fatica?.nodes) ? Math.max(0, s.sociogrammi.fatica.nodes.length - 1) : 0;
      const row = document.createElement('div');
      row.className = 'item-row folder-row';
      row.innerHTML = `
        <span class="item-icon">🕸️</span>
        <div class="item-info">
          <div class="item-name">${fmtData(s.assessmentDate || s.createdAt)} · ${esc(momento)} ${badge}</div>
          <div class="item-meta">Condotto da: ${esc(conduttore)} · Vicinanza ${nV} · Fatica ${nF}</div>
        </div>
        <span class="item-chevron">›</span>`;
      row.addEventListener('click', () => {
        go(momento, () => montaEditor(main, { ...ctx, schedaId: s.id }));
      });
      lista.appendChild(row);
    }
  }

  const btnNuova = document.getElementById('ppuc-nuova');
  if (btnNuova) {
    btnNuova.addEventListener('click', async () => {
      btnNuova.disabled = true;
      try {
        const schedaId = await creaSchedaBozza(db, {
          minorId: ragazzo.id, comunitaId: community.id, createdBy: currentUid
        });
        go('Nuova scheda', () => montaEditor(main, { ...ctx, schedaId }));
      } catch (e) {
        alert('Errore: ' + e.message);
        btnNuova.disabled = false;
      }
    });
  }
}

// ── UI: editor / vista della Scheda C ──────────────────────────────────
// ctx = { db, ragazzo, community, canWrite, currentUid, schedaId }
export async function montaEditor(main, ctx) {
  const { db, ragazzo, community, canWrite, currentUid, schedaId } = ctx;
  main.innerHTML = '<div class="spinner"></div>';

  let scheda, operatori;
  try {
    [scheda, operatori] = await Promise.all([
      caricaScheda(db, schedaId),
      elencaOperatoriComunita(db, community.id),
    ]);
  } catch (e) {
    main.innerHTML = `<p class="empty-msg">Errore: ${esc(e.message)}</p>`;
    return;
  }
  if (!operatori.some(o => o.uid === currentUid)) {
    operatori = [{ uid: currentUid, nome: await getNomePersona(db, currentUid) }, ...operatori];
  }

  let modalitaLettura = scheda.status === 'completata';

  // Stato UI locale
  let tabKey = SOCIOGRAMMI.some(s => s.key === scheda.tabCorrente) ? scheda.tabCorrente : 'vicinanza';
  let interazione = 'sposta';      // 'sposta' | 'collega'
  let linkFrom = null;             // id del primo nodo scelto in modalità "collega"

  // ── Autosalvataggio (debounce, come Scheda A / B) ────────────────────
  let pendingPatch = {};
  let saveTimer = null;

  function setSaveStatus(text, isError = false) {
    const el = document.getElementById('ppuc-save-status');
    if (el) { el.textContent = text; el.style.color = isError ? '#c0392b' : '#999'; }
  }
  function scheduleAutosave() {
    clearTimeout(saveTimer);
    setSaveStatus('');
    saveTimer = setTimeout(flush, AUTOSAVE_DEBOUNCE_MS);
  }
  async function flush() {
    clearTimeout(saveTimer);
    if (!Object.keys(pendingPatch).length) return;
    const patch = pendingPatch;
    pendingPatch = {};
    setSaveStatus('Salvataggio…');
    try {
      await salvaPatch(db, schedaId, patch);
      setSaveStatus('Salvato');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (e) {
      pendingPatch = { ...patch, ...pendingPatch };
      setSaveStatus('Errore di salvataggio', true);
    }
  }
  function segna(path, value) {
    pendingPatch[path] = value;
    scheduleAutosave();
  }
  // Persiste il sociogramma attivo per intero (nodi + archi): un solo campo,
  // ricostruibile su qualunque schermo perché le coordinate sono normalizzate.
  function salvaSociogramma() {
    segna(`sociogrammi.${tabKey}`, scheda.sociogrammi[tabKey]);
  }

  function socioAttivo() { return scheda.sociogrammi[tabKey]; }
  function setSocio(nuovo) { scheda.sociogrammi[tabKey] = nuovo; }

  // Rendering e geometria del sociogramma: funzioni pure importate dal model
  // (js/ppu-scheda-c-model.js). Qui restano solo i Pointer Events. Dichiarate
  // come `function` per essere disponibili sia a renderEditor sia a
  // renderLettura, indipendentemente dall'ordine di chiamata.
  function disegnaSVG(socio, opts) { return disegnaSociogrammaSVG(socio, opts); }
  function geomArco(socio, edge) { return geometriaArco(socio, edge, GEOMETRIA); }

  if (modalitaLettura) { await renderLettura(); return; }
  renderEditor();

  // ══════════════════════════════════════════════════════════════════════
  //  VISTA SOLA LETTURA (scheda completata)
  // ══════════════════════════════════════════════════════════════════════
  async function renderLettura() {
    const conduttore = await getNomePersona(db, scheda.conductedBy);

    const blocchi = SOCIOGRAMMI.map(cfg => {
      const socio = scheda.sociogrammi[cfg.key];
      const persone = socio.nodes.filter(n => n.id !== CENTER_ID);
      const svg = disegnaSVG(socio, { interattivo: false, accento: cfg.accento });
      const elencoPersone = persone.length
        ? persone.map(n => `<li>${esc(n.name || '—')}${n.note ? ` — <span style="color:#777;font-style:italic;">${esc(n.note)}</span>` : ''}</li>`).join('')
        : '<li style="color:#bbb;">nessuna persona inserita</li>';
      const elencoArchi = socio.edges.length
        ? socio.edges.map(e => `<li>${esc(descriviArco(socio, e))} <span style="color:${coloreQualita(e.quality)};font-weight:700;">● ${esc(labelQualita(e.quality))}</span></li>`).join('')
        : '<li style="color:#bbb;">nessun collegamento</li>';
      return `
        <div style="margin-bottom:20px;">
          <div style="background:${cfg.accento}18;border-left:4px solid ${cfg.accento};border-radius:0 10px 10px 0;padding:8px 12px;margin-bottom:8px;">
            <div style="font-weight:800;color:${cfg.accento};font-size:0.92rem;">${cfg.key === 'vicinanza' ? 'C1' : 'C2'} · ${esc(cfg.titolo)}</div>
            <div style="font-size:0.74rem;color:#777;margin-top:2px;">${esc(cfg.legendaDistanza)}</div>
          </div>
          <div style="display:flex;justify-content:center;">${svg}</div>
          <div style="font-size:0.8rem;color:#444;margin-top:8px;">
            <div style="font-weight:700;color:#333;margin-bottom:2px;">Persone</div>
            <ul style="margin:0 0 8px 18px;padding:0;">${elencoPersone}</ul>
            <div style="font-weight:700;color:#333;margin-bottom:2px;">Collegamenti</div>
            <ul style="margin:0 0 0 18px;padding:0;">${elencoArchi}</ul>
          </div>
        </div>`;
    }).join('');

    main.innerHTML = `
      <div style="padding:14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;flex-wrap:wrap;">
          <div style="font-weight:800;font-size:1rem;color:#333;">LE PERSONE INTORNO A ME</div>
          <span style="background:#e8f5e9;color:#2d7a3a;border-radius:20px;padding:2px 10px;font-size:0.7rem;font-weight:700;">✅ Scheda completata</span>
        </div>
        <div style="font-size:0.78rem;color:#999;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:10px;">Scheda C — PPU</div>
        <div style="font-size:0.82rem;color:#666;line-height:1.7;margin-bottom:14px;">
          <strong style="color:#333;">${esc(ragazzo.nome||'')}</strong><br>
          Momento: ${esc(labelMomento(scheda.ppuMoment))}<br>
          Data: ${fmtData(scheda.assessmentDate || scheda.createdAt)}<br>
          Colloquio condotto da: ${esc(conduttore)}
        </div>
        ${blocchi}
        ${scheda.note ? `
        <div style="margin-top:6px;">
          <div class="section-title muted" style="padding-left:0;">NOTA DEL COLLOQUIO</div>
          <div style="font-size:0.82rem;color:#555;white-space:pre-wrap;">${esc(scheda.note)}</div>
        </div>` : ''}
        <div style="font-size:0.72rem;color:#aaa;margin-top:16px;line-height:1.6;">
          Strumento descrittivo: rappresenta come ${esc(ragazzo.nome||'il ragazzo/a')} ha collocato le persone in questo colloquio.
          Non è una diagnosi e non attribuisce etichette.
        </div>
      </div>
      <div style="height:80px;"></div>
      ${canWrite ? `
      <div style="position:fixed;bottom:62px;left:0;right:0;background:#fff;border-top:1px solid #e5e5e5;padding:10px 14px;z-index:90;">
        <button class="btn-orange" id="ppuc-riapri" style="width:100%;">🔓 Riapri per modifica</button>
      </div>` : ''}`;

    document.getElementById('ppuc-riapri')?.addEventListener('click', async () => {
      if (!confirm('Riaprire questa scheda per modificarla? Tornerà in stato "bozza".')) return;
      try {
        await riapriScheda(db, schedaId, currentUid);
        scheda.status = 'bozza';
        modalitaLettura = false;
        renderEditor();
      } catch (e) { alert('Errore: ' + e.message); }
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  VISTA EDITOR (bozza)
  // ══════════════════════════════════════════════════════════════════════
  function renderEditor() {
    const cfg = SOCIOGRAMMI.find(s => s.key === tabKey);

    const momentoOpts = MOMENTI_PPU.map(m =>
      `<option value="${m.value}" ${scheda.ppuMoment===m.value?'selected':''}>${esc(m.label)}</option>`).join('');
    const operatoriOpts = operatori.map(o =>
      `<option value="${esc(o.uid)}" ${scheda.conductedBy===o.uid?'selected':''}>${esc(o.nome)}</option>`).join('');

    const tabsHtml = SOCIOGRAMMI.map(s => {
      const attivo = s.key === tabKey;
      const label = s.key === 'vicinanza' ? 'C1 · Persone vicine' : 'C2 · Persone con cui fatico';
      return `<button type="button" class="ppuc-tab" data-tab="${s.key}"
        style="flex:1;min-height:44px;border:2px solid ${attivo ? s.accento : '#e0e0e0'};
               background:${attivo ? s.accento + '18' : '#fff'};color:${attivo ? s.accento : '#666'};
               font-weight:800;font-size:0.8rem;border-radius:10px;cursor:pointer;font-family:'Nunito',sans-serif;padding:6px 8px;">
        ${label}</button>`;
    }).join('');

    const collegaAttivo = interazione === 'collega';

    main.innerHTML = `
      <div style="padding:12px 14px 4px;">
        <div style="font-weight:800;font-size:1rem;color:#333;line-height:1;">LE PERSONE INTORNO A ME</div>
        <div style="font-size:0.7rem;color:#999;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin:2px 0 8px;">Scheda C — PPU · ${esc(ragazzo.nome||'')}</div>

        ${canWrite ? `
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
          <div style="flex:1;min-width:150px;">
            <label style="font-size:0.68rem;color:#888;font-weight:700;display:block;margin-bottom:2px;">MOMENTO DEL PERCORSO PPU</label>
            <select id="ppuc-momento" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:5px 8px;font-family:'Nunito',sans-serif;font-size:0.8rem;">
              <option value="">— seleziona —</option>${momentoOpts}
            </select>
          </div>
          ${scheda.ppuMoment === 'altro' ? `
          <div style="flex:1;min-width:150px;">
            <label style="font-size:0.68rem;color:#888;font-weight:700;display:block;margin-bottom:2px;">DESCRIZIONE (facoltativa)</label>
            <input type="text" id="ppuc-momento-nota" value="${esc(scheda.ppuMomentNote||'')}" placeholder="Es. Dopo rientro da esperienza esterna"
              style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:5px 8px;font-family:'Nunito',sans-serif;font-size:0.8rem;">
          </div>` : ''}
          <div style="flex:1;min-width:150px;">
            <label style="font-size:0.68rem;color:#888;font-weight:700;display:block;margin-bottom:2px;">COLLOQUIO CONDOTTO DA</label>
            <select id="ppuc-conduttore" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:5px 8px;font-family:'Nunito',sans-serif;font-size:0.8rem;">
              <option value="">— seleziona —</option>${operatoriOpts}
            </select>
          </div>
        </div>` : ''}

        <div style="display:flex;gap:8px;margin-bottom:8px;">${tabsHtml}</div>

        <div style="background:${cfg.accento}14;border-radius:10px;padding:9px 12px;margin-bottom:8px;">
          <div style="font-weight:800;color:${cfg.accento};font-size:0.85rem;margin-bottom:2px;">${tabKey === 'vicinanza' ? 'C1' : 'C2'} · ${esc(cfg.titolo)}</div>
          <div style="font-size:0.78rem;color:#555;line-height:1.45;">${esc(cfg.consegna)}</div>
          <div style="font-size:0.74rem;color:#777;margin-top:4px;font-weight:700;">${esc(cfg.legendaDistanza)}</div>
        </div>

        ${canWrite ? `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <button type="button" id="ppuc-add" style="min-height:44px;padding:8px 14px;border-radius:10px;border:2px solid ${cfg.accento};background:${cfg.accento};color:#fff;font-weight:800;font-size:0.82rem;cursor:pointer;font-family:'Nunito',sans-serif;">➕ Aggiungi persona</button>
          <button type="button" id="ppuc-link" style="min-height:44px;padding:8px 14px;border-radius:10px;border:2px solid ${collegaAttivo ? '#e07b39' : '#ccc'};background:${collegaAttivo ? '#fff4ec' : '#fff'};color:${collegaAttivo ? '#c96a28' : '#666'};font-weight:800;font-size:0.82rem;cursor:pointer;font-family:'Nunito',sans-serif;">🔗 ${collegaAttivo ? 'Collegamento: scegli le persone' : 'Crea collegamento'}</button>
          <button type="button" id="ppuc-legenda" style="min-height:44px;padding:8px 12px;border-radius:10px;border:2px solid #ccc;background:#fff;color:#666;font-weight:800;font-size:0.82rem;cursor:pointer;font-family:'Nunito',sans-serif;">ℹ️ Legenda</button>
          <span id="ppuc-save-status" style="font-size:0.68rem;color:#999;margin-left:auto;"></span>
        </div>
        <div id="ppuc-hint" style="font-size:0.74rem;color:#888;min-height:1.1em;margin-bottom:4px;"></div>
        ` : ''}
      </div>

      <!-- full-bleed: la mappa esce dal max-width della pagina per diventare
           l'elemento dominante su desktop (fino a 1150px, ~A4 landscape),
           restando width:100% su tablet/mobile senza scroll orizzontale -->
      <div id="ppuc-canvas-wrap" style="box-sizing:border-box;width:min(1150px,94vw);position:relative;left:50%;transform:translateX(-50%);padding:0 4px 90px;"></div>

      ${canWrite ? `
      <div style="position:fixed;bottom:62px;left:0;right:0;background:#fff;border-top:1px solid #e5e5e5;padding:10px 14px;display:flex;gap:8px;z-index:90;">
        <button class="btn-ghost" id="ppuc-salva-bozza">💾 Salva bozza</button>
        <div style="flex:1;"></div>
        <button class="btn-orange" id="ppuc-completa">✅ Completa scheda</button>
      </div>` : ''}`;

    disegnaCanvas();
    wireEditor(cfg);
  }

  function setHint(txt) {
    const el = document.getElementById('ppuc-hint');
    if (el) el.textContent = txt || '';
  }

  function wireEditor(cfg) {
    if (canWrite) {
      document.getElementById('ppuc-momento')?.addEventListener('change', e => {
        const val = e.target.value || null;
        scheda.ppuMoment = val;
        segna('ppuMoment', val);
        renderEditor();
      });
      document.getElementById('ppuc-momento-nota')?.addEventListener('input', e => {
        scheda.ppuMomentNote = e.target.value;
        segna('ppuMomentNote', e.target.value);
      });
      document.getElementById('ppuc-conduttore')?.addEventListener('change', e => {
        const val = e.target.value || null;
        scheda.conductedBy = val;
        segna('conductedBy', val);
      });
      document.getElementById('ppuc-add')?.addEventListener('click', () => apriSheetAggiungi(cfg));
      document.getElementById('ppuc-link')?.addEventListener('click', () => {
        interazione = interazione === 'collega' ? 'sposta' : 'collega';
        linkFrom = null;
        renderEditor();
        if (interazione === 'collega') setHint('Tocca la prima persona, poi la seconda.');
      });
      document.getElementById('ppuc-legenda')?.addEventListener('click', apriSheetLegenda);
      document.getElementById('ppuc-salva-bozza')?.addEventListener('click', async () => {
        await flush();
        document.getElementById('btn-back')?.click();
      });
      document.getElementById('ppuc-completa')?.addEventListener('click', async () => {
        await flush();
        const problemi = validaCompletamento(scheda);
        if (problemi.length) {
          alert(problemi.map(p => '• ' + p.msg).join('\n'));
          return;
        }
        try {
          await completaScheda(db, schedaId, currentUid);
          scheda.status = 'completata';
          modalitaLettura = true;
          await renderLettura();
        } catch (e) { alert('Errore: ' + e.message); }
      });
    }

    main.querySelectorAll('.ppuc-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const k = btn.dataset.tab;
        if (k === tabKey) return;
        tabKey = k;
        interazione = 'sposta';
        linkFrom = null;
        scheda.tabCorrente = k;
        segna('tabCorrente', k);
        renderEditor();
      });
    });
  }

  // ── Canvas SVG interattivo (rendering puro nel model; qui i Pointer Events) ──
  function disegnaCanvas() {
    const wrap = document.getElementById('ppuc-canvas-wrap');
    if (!wrap) return;
    const cfg = SOCIOGRAMMI.find(s => s.key === tabKey);
    wrap.innerHTML = disegnaSVG(socioAttivo(), {
      interattivo: canWrite && !modalitaLettura,
      accento: cfg.accento,
      linkFrom,
    });
    if (canWrite && !modalitaLettura) attaccaInterazioni(wrap.querySelector('svg'), cfg);
  }

  // ── Pointer Events: drag dei nodi + tap su nodi/archi ─────────────────
  function attaccaInterazioni(svg, cfg) {
    if (!svg) return;
    let drag = null; // { id, gEl, moved }

    function svgPoint(evt) {
      const rect = svg.getBoundingClientRect();
      const x = (evt.clientX - rect.left) / rect.width;
      const y = (evt.clientY - rect.top) / rect.height;
      return { x: clamp01(x), y: clamp01(y) };
    }

    function ridisegnaArchiDi(nodeId) {
      const socio = socioAttivo();
      svg.querySelectorAll('.ppuc-edge').forEach(gEl => {
        const edge = socio.edges.find(e => e.id === gEl.dataset.edge);
        if (!edge || (edge.source !== nodeId && edge.target !== nodeId)) return;
        const g = geomArco(socio, edge);
        if (!g) return;
        gEl.querySelectorAll('line').forEach(ln => {
          ln.setAttribute('x1', g.x1); ln.setAttribute('y1', g.y1);
          ln.setAttribute('x2', g.x2); ln.setAttribute('y2', g.y2);
        });
      });
    }

    svg.querySelectorAll('.ppuc-node').forEach(gEl => {
      const id = gEl.dataset.node;

      gEl.addEventListener('pointerdown', evt => {
        // In modalità "collega" non si trascina: la scelta della persona
        // avviene sul pointerup (vedi sotto).
        if (interazione === 'collega') { evt.preventDefault(); return; }
        if (id === CENTER_ID) return;
        evt.preventDefault();
        try { gEl.setPointerCapture(evt.pointerId); } catch (_) {}
        drag = { id, gEl, moved: false };
      });

      gEl.addEventListener('pointermove', evt => {
        if (!drag || drag.id !== id) return;
        evt.preventDefault();
        let { x, y } = svgPoint(evt);
        drag.moved = true;
        // Clamp per-nodo: la capsula (o il cerchio) resta interamente dentro
        // l'area utile, così un nodo non può sparire fuori dal bersaglio.
        const { hw, hh } = dimensioniNodo({ id, name: nomeNodo(socioAttivo(), id) }, GEOMETRIA);
        const mx = hw / GEOMETRIA.VIEW_W, my = hh / GEOMETRIA.VIEW_H;
        x = Math.min(1 - mx, Math.max(mx, x));
        y = Math.min(1 - my, Math.max(my, y));
        // Il nodo è un <g transform="translate(cx,cy)">: spostando quel
        // transform, capsula + nome + (via ridisegno) archi seguono insieme.
        gEl.setAttribute('transform', `translate(${(x * GEOMETRIA.VIEW_W).toFixed(1)},${(y * GEOMETRIA.VIEW_H).toFixed(1)})`);
        // aggiorna il modello in memoria (coordinate normalizzate) + archi
        setSocio(spostaNodo(socioAttivo(), id, x, y));
        ridisegnaArchiDi(id);
      });

      function finishDrag(evt) {
        // Modalità "collega": ogni tocco su un nodo è una selezione, non un drag.
        if (interazione === 'collega') { gestisciTapNodo(id, cfg); return; }
        if (!drag || drag.id !== id) return;
        try { gEl.releasePointerCapture(evt.pointerId); } catch (_) {}
        const wasMoved = drag.moved;
        drag = null;
        if (wasMoved) {
          salvaSociogramma();
        } else {
          // tap semplice → apri editor nodo
          gestisciTapNodo(id, cfg);
        }
      }
      gEl.addEventListener('pointerup', finishDrag);
      gEl.addEventListener('pointercancel', evt => {
        if (!drag || drag.id !== id) return;
        drag = null;
        salvaSociogramma();
      });
    });

    svg.querySelectorAll('.ppuc-edge').forEach(gEl => {
      gEl.addEventListener('click', () => {
        if (interazione === 'collega') return;
        const edge = socioAttivo().edges.find(e => e.id === gEl.dataset.edge);
        if (edge) apriSheetArco(edge, cfg);
      });
    });
  }

  function gestisciTapNodo(id, cfg) {
    if (interazione === 'collega') {
      if (id === linkFrom) { linkFrom = null; disegnaCanvas(); setHint('Selezione annullata. Tocca la prima persona.'); return; }
      if (!linkFrom) {
        linkFrom = id;
        disegnaCanvas();
        setHint(`Prima persona: ${esc(nomeNodo(socioAttivo(), id))}. Ora tocca la seconda.`);
        return;
      }
      const from = linkFrom, to = id;
      linkFrom = null;
      const esistente = arcoTraCoppia(socioAttivo(), from, to);
      setSocio(creaArco(socioAttivo(), from, to, esistente ? {} : { direction: DIREZIONE_DEFAULT, quality: QUALITA_DEFAULT }));
      salvaSociogramma();
      const nuovo = arcoTraCoppia(socioAttivo(), from, to);
      // Un collegamento alla volta: si esce dalla modalità "collega" e si
      // apre subito l'editor del collegamento (direzione + colore). Per
      // crearne un altro si ritocca "🔗 Crea collegamento".
      interazione = 'sposta';
      renderEditor();
      if (nuovo) apriSheetArco(nuovo, cfg, from, to);
      return;
    }
    if (id === CENTER_ID) {
      apriSheetInfo('«IO»', 'Sei tu, al centro della mappa. Questo punto non si può spostare, rinominare o eliminare.');
      return;
    }
    const nodo = socioAttivo().nodes.find(n => n.id === id);
    if (nodo) apriSheetNodo(nodo, cfg);
  }

  // ── Bottom sheet generico ────────────────────────────────────────────
  function apriSheet(innerHTML) {
    chiudiSheet();
    const back = document.createElement('div');
    back.id = 'ppuc-sheet-back';
    back.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:200;display:flex;align-items:flex-end;justify-content:center;';
    const sheet = document.createElement('div');
    sheet.style.cssText = "background:#fff;width:100%;max-width:480px;border-radius:16px 16px 0 0;padding:16px 16px 22px;font-family:'Nunito',sans-serif;max-height:85vh;overflow-y:auto;box-shadow:0 -4px 20px rgba(0,0,0,0.15);";
    sheet.innerHTML = innerHTML;
    back.appendChild(sheet);
    back.addEventListener('click', e => { if (e.target === back) chiudiSheet(); });
    document.body.appendChild(back);
    return sheet;
  }
  function chiudiSheet() {
    document.getElementById('ppuc-sheet-back')?.remove();
  }

  function apriSheetInfo(titolo, testo) {
    const s = apriSheet(`
      <div style="font-weight:800;font-size:1rem;color:#333;margin-bottom:6px;">${esc(titolo)}</div>
      <div style="font-size:0.85rem;color:#555;line-height:1.5;">${esc(testo)}</div>
      <button id="ppuc-sheet-ok" class="btn-orange" style="width:100%;margin-top:14px;">Ho capito</button>`);
    s.querySelector('#ppuc-sheet-ok').addEventListener('click', chiudiSheet);
  }

  function apriSheetLegenda() {
    const dirRows = DIREZIONI.map(d => `<li><strong>${esc(d.simbolo)}</strong> &nbsp;${esc(d.label)} — ${esc(d.descr)}</li>`).join('');
    const qualRows = QUALITA_RELAZIONE.map(q => `
      <li style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <span style="width:14px;height:14px;border-radius:50%;background:${q.colore};display:inline-block;flex:0 0 auto;"></span>
        <span><strong>${esc(q.label)}</strong> — ${esc(q.descr)}</span>
      </li>`).join('');
    const s = apriSheet(`
      <div style="font-weight:800;font-size:1rem;color:#333;margin-bottom:8px;">Legenda</div>
      <div style="font-size:0.8rem;font-weight:800;color:#555;margin-bottom:4px;">Direzione della relazione</div>
      <ul style="margin:0 0 12px 16px;padding:0;font-size:0.83rem;color:#555;line-height:1.6;">${dirRows}</ul>
      <div style="font-size:0.8rem;font-weight:800;color:#555;margin-bottom:4px;">Colore / qualità della relazione</div>
      <ul style="margin:0 0 0 2px;padding:0;font-size:0.83rem;color:#555;list-style:none;">${qualRows}</ul>
      <div style="font-size:0.74rem;color:#999;margin-top:10px;line-height:1.5;">Il colore è una qualità del rapporto e non sostituisce la direzione. La legenda è configurabile.</div>
      <button id="ppuc-sheet-ok" class="btn-orange" style="width:100%;margin-top:14px;">Chiudi</button>`);
    s.querySelector('#ppuc-sheet-ok').addEventListener('click', chiudiSheet);
  }

  function apriSheetAggiungi(cfg) {
    const s = apriSheet(`
      <div style="font-weight:800;font-size:1rem;color:#333;margin-bottom:4px;">Aggiungi una persona</div>
      <div style="font-size:0.8rem;color:#888;margin-bottom:10px;">${tabKey === 'vicinanza'
        ? 'Una persona che fa parte della vita di ' + esc(ragazzo.nome || 'il ragazzo/a') + '.'
        : 'Una persona con cui in questo periodo c’è più fatica.'}</div>
      <input type="text" id="ppuc-new-name" placeholder="Nome (es. Mamma, Marco, Prof. Rossi)" maxlength="40"
        style="width:100%;border:1.5px solid #ddd;border-radius:10px;padding:11px 12px;font-family:'Nunito',sans-serif;font-size:0.9rem;">
      <div id="ppuc-new-err" style="color:#c0392b;font-size:0.78rem;min-height:1em;margin-top:4px;"></div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button id="ppuc-new-cancel" class="btn-ghost" style="flex:1;">Annulla</button>
        <button id="ppuc-new-ok" class="btn-orange" style="flex:2;">Aggiungi alla mappa</button>
      </div>`);
    const input = s.querySelector('#ppuc-new-name');
    const err = s.querySelector('#ppuc-new-err');
    setTimeout(() => input.focus(), 50);
    const conferma = () => {
      try {
        setSocio(aggiungiNodo(socioAttivo(), { name: input.value }));
        salvaSociogramma();
        chiudiSheet();
        disegnaCanvas();
      } catch (e) { err.textContent = e.message; }
    };
    s.querySelector('#ppuc-new-ok').addEventListener('click', conferma);
    s.querySelector('#ppuc-new-cancel').addEventListener('click', chiudiSheet);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') conferma(); });
  }

  function apriSheetNodo(nodo, cfg) {
    const s = apriSheet(`
      <div style="font-weight:800;font-size:1rem;color:#333;margin-bottom:8px;">Persona</div>
      <label style="font-size:0.72rem;color:#888;font-weight:700;display:block;margin-bottom:3px;">NOME</label>
      <input type="text" id="ppuc-edit-name" value="${esc(nodo.name || '')}" maxlength="40"
        style="width:100%;border:1.5px solid #ddd;border-radius:10px;padding:10px 12px;font-family:'Nunito',sans-serif;font-size:0.9rem;">
      <label style="font-size:0.72rem;color:#888;font-weight:700;display:block;margin:10px 0 3px;">NOTA SULLA RELAZIONE <span style="font-weight:400;">(facoltativa)</span></label>
      <textarea id="ppuc-edit-note" rows="2" placeholder="Vuoi aggiungere qualcosa su questa relazione?"
        style="width:100%;border:1.5px solid #ddd;border-radius:10px;padding:10px 12px;font-family:'Nunito',sans-serif;font-size:0.86rem;resize:vertical;">${esc(nodo.note || '')}</textarea>
      <div id="ppuc-edit-err" style="color:#c0392b;font-size:0.78rem;min-height:1em;margin-top:4px;"></div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button id="ppuc-node-del" class="btn-ghost" style="flex:1;color:#c0392b;border-color:#e6b0aa;">🗑️ Elimina</button>
        <button id="ppuc-node-ok" class="btn-orange" style="flex:2;">Salva</button>
      </div>`);
    const nameEl = s.querySelector('#ppuc-edit-name');
    const noteEl = s.querySelector('#ppuc-edit-note');
    const err = s.querySelector('#ppuc-edit-err');
    s.querySelector('#ppuc-node-ok').addEventListener('click', () => {
      try {
        let socio = socioAttivo();
        socio = rinominaNodo(socio, nodo.id, nameEl.value);
        socio = impostaNotaNodo(socio, nodo.id, noteEl.value);
        setSocio(socio);
        salvaSociogramma();
        chiudiSheet();
        disegnaCanvas();
      } catch (e) { err.textContent = e.message; }
    });
    s.querySelector('#ppuc-node-del').addEventListener('click', () => {
      if (!confirm(`Eliminare "${nodo.name || 'questa persona'}" dalla mappa? Verranno rimossi anche i suoi collegamenti.`)) return;
      try {
        setSocio(eliminaNodo(socioAttivo(), nodo.id));
        salvaSociogramma();
        chiudiSheet();
        disegnaCanvas();
      } catch (e) { err.textContent = e.message; }
    });
  }

  function apriSheetArco(edge, cfg, fromId, toId) {
    const socio = socioAttivo();
    const nomeA = nomeNodo(socio, fromId || edge.source);
    const nomeB = nomeNodo(socio, toId || edge.target);
    const dirBtns = DIREZIONI.map(d => {
      const attivo = d.id === edge.direction;
      return `<button type="button" class="ppuc-dir" data-dir="${d.id}"
        style="flex:1;min-height:46px;border:2px solid ${attivo ? '#e07b39' : '#ddd'};background:${attivo ? '#fff4ec' : '#fff'};
               border-radius:10px;font-family:'Nunito',sans-serif;font-weight:800;font-size:0.82rem;color:#444;cursor:pointer;">
        ${esc(nomeA)} ${d.simbolo} ${esc(nomeB)}</button>`;
    }).join('');
    const qualBtns = QUALITA_RELAZIONE.map(q => {
      const attivo = q.id === edge.quality;
      return `<button type="button" class="ppuc-qual" data-qual="${q.id}"
        style="display:flex;align-items:center;gap:8px;min-height:44px;padding:8px 10px;border-radius:10px;cursor:pointer;
               border:2px solid ${attivo ? q.colore : '#e5e5e5'};background:${attivo ? q.colore + '22' : '#fff'};font-family:'Nunito',sans-serif;">
        <span style="width:14px;height:14px;border-radius:50%;background:${q.colore};display:inline-block;flex:0 0 auto;"></span>
        <span style="font-size:0.83rem;color:#333;font-weight:700;">${esc(q.label)}</span>
        <span style="font-size:0.74rem;color:#888;">${esc(q.descr)}</span>
      </button>`;
    }).join('');
    const s = apriSheet(`
      <div style="font-weight:800;font-size:1rem;color:#333;margin-bottom:8px;">Collegamento</div>
      <div style="font-size:0.75rem;color:#888;font-weight:700;margin-bottom:4px;">DIREZIONE</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;">${dirBtns}</div>
      <div style="font-size:0.75rem;color:#888;font-weight:700;margin-bottom:4px;">COLORE / QUALITÀ</div>
      <div style="display:flex;flex-direction:column;gap:6px;">${qualBtns}</div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button id="ppuc-edge-del" class="btn-ghost" style="flex:1;color:#c0392b;border-color:#e6b0aa;">🗑️ Elimina collegamento</button>
        <button id="ppuc-edge-ok" class="btn-orange" style="flex:1;">Fatto</button>
      </div>`);
    s.querySelectorAll('.ppuc-dir').forEach(b => b.addEventListener('click', () => {
      setSocio(impostaDirezioneArco(socioAttivo(), edge.id, b.dataset.dir));
      edge.direction = b.dataset.dir;
      salvaSociogramma();
      apriSheetArco(edge, cfg, fromId, toId); // ridisegna lo sheet con lo stato aggiornato
      disegnaCanvas();
    }));
    s.querySelectorAll('.ppuc-qual').forEach(b => b.addEventListener('click', () => {
      setSocio(impostaQualitaArco(socioAttivo(), edge.id, b.dataset.qual));
      edge.quality = b.dataset.qual;
      salvaSociogramma();
      apriSheetArco(edge, cfg, fromId, toId);
      disegnaCanvas();
    }));
    s.querySelector('#ppuc-edge-del').addEventListener('click', () => {
      setSocio(eliminaArco(socioAttivo(), edge.id));
      salvaSociogramma();
      chiudiSheet();
      disegnaCanvas();
    });
    s.querySelector('#ppuc-edge-ok').addEventListener('click', () => { chiudiSheet(); disegnaCanvas(); });
  }
}
