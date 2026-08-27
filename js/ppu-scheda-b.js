// js/ppu-scheda-b.js — "Come penso che mi vedano gli altri" (Scheda B PPU):
// misura l'immagine RIFLESSA, cioè come il ragazzo (13/14-17 anni) pensa
// che le persone che lo conoscono realmente lo descriverebbero. Compilata
// CON il ragazzo durante un colloquio educativo. Non è un test, non
// produce punteggi né classificazioni.
// Nome tecnico interno: PPUReflectedImage.
//
// Complementare alla Scheda A ("Come mi vedo", js/ppu-scheda-a.js):
//   Scheda A → «Come mi vedo?» (immagine di sé)
//   Scheda B → «Come penso che mi vedano gli altri?» (immagine riflessa)
// (La futura Scheda C — "Le persone intorno a me" — descriverà invece la
//  rete relazionale; NON è implementata qui.)
//
// REQUISITO: A e B devono essere confrontabili domanda per domanda. Ogni
// indicator_id di B corrisponde allo STESSO indicator_id di A
// (self_01 ↔ self_01, …, wellbeing_03 ↔ wellbeing_03): stesso costrutto
// osservato da due prospettive, NON stesso testo. In questa fase si
// garantisce solo la confrontabilità strutturale dei dati: nessun
// algoritmo, media, grafico o interpretazione del disallineamento A↔B.
// Non esistono indicatori "b_self_01": gli id restano quelli di A.
//
// Architettura, classi CSS, autosalvataggio, stepper, sola lettura e
// riapertura sono modellati 1:1 sulla Scheda A. Differenze volute:
//   - STESSA identica scala della Scheda A: N/O · 1 · 2 · 3, salvata in
//     `risposte` nello stesso formato (la stringa 'NO' oppure il numero
//     1/2/3; N/O NON diventa 0; nessuna normalizzazione, nessun campo
//     `risposteCode`), così che A e B siano confrontabili per
//     indicator_id senza funzioni di conversione;
//   - nessuna sezione "Per concludere" (la Scheda B non prevede domande
//     aperte di chiusura);
//   - le note per area sono esplicitamente "note dell'educatore".
//
// Riceve `db` per dependency injection (nessuna init Firebase propria):
// il chiamante (documenti.html) passa la stessa istanza già inizializzata.

import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const COLLECTION = 'ppu_schede_b';
const INSTRUMENT = 'PPU_B';
const INSTRUMENT_VERSION = 1;
const AUTOSAVE_DEBOUNCE_MS = 1000;

// ── Scala comune PPU — IDENTICA alla Scheda A ───────────────────────────
// N/O NON è 0: è l'assenza di una risposta numerica. Il valore è la
// stringa 'NO' quando scelto esplicitamente; la chiave dell'indicatore è
// del tutto assente dalla mappa "risposte" finché non si risponde.
// value/label/colore sono gli stessi della Scheda A (parità metrica); solo
// `desc` è riformulato dal punto di vista "come penso che mi vedano".
export const SCALA = [
  { value: 'NO', label: 'N/O', desc: 'Non saprei dire come mi vedrebbero su questo', colore: '#8a8a8a' },
  { value: 1,    label: '1',   desc: 'Penso che mi vedrebbero ancora in difficoltà', colore: '#c0392b' },
  { value: 2,    label: '2',   desc: 'Penso che mi vedrebbero a volte in difficoltà', colore: '#d9822b' },
  { value: 3,    label: '3',   desc: 'Penso che mi vedrebbero capace di cavarmela', colore: '#3a8a4a' },
];

// ── Testo introduttivo mostrato all'inizio della scheda ────────────────
export const TESTO_INTRO = {
  titolo: 'Come penso che mi vedano gli altri',
  paragrafi: [
    'Questa scheda serve a capire come pensi di essere visto dalle persone che ti conoscono realmente.',
    'Quando parliamo degli “altri” pensiamo alle persone che hanno avuto modo di conoscerti nella vita quotidiana: famiglia, amici, compagni, insegnanti, persone con cui hai lavorato, educatori o altri adulti importanti per te.',
    'Non devi indovinare quello che pensano davvero.',
    'Prova semplicemente a chiederti:',
  ],
  domandaGuida: '“Se chiedessimo alle persone che mi conoscono, come penso che mi descriverebbero?”',
  chiusura: 'Non ci sono risposte giuste o sbagliate.',
};

// ── Le 6 aree × 3 indicatori ciascuna ──────────────────────────────────
// indicator_id IDENTICI a quelli della Scheda A (self_01…wellbeing_03) e
// nello STESSO ordine di area. Ogni domanda B è la versione SPECULARE
// della domanda A con lo stesso id: misura lo STESSO identico costrutto,
// cambia solo il punto di vista ("come mi vedo" → "come penso che mi
// vedano gli altri"). La scala di risposta è quella comune della Scheda A
// (N/O · 1 · 2 · 3), mostrata uguale per ogni domanda. Il costrutto A di
// riferimento è riportato in commento sopra ogni domanda.
export const AREE_PPU = [
  {
    id: 'self', nome: 'IO CON ME STESSO', colore: '#5a8a4a', emoji: '🧭',
    notaLabel: 'Note dell’educatore per quest’area',
    domande: [
      {
        // A self_01 — riconoscere le proprie emozioni forti e comunicarle
        id: 'self_01',
        testo: 'Quando provo un’emozione forte (rabbia, tristezza, paura), come penso che le persone che mi conoscono mi vedano nel capire cosa provo e nel comunicarlo?',
      },
      {
        // A self_02 — gestire la propria reazione quando si è arrabbiati o delusi
        id: 'self_02',
        testo: 'Quando mi arrabbio, sono deluso o qualcosa non va come vorrei, come penso che le persone che mi conoscono mi vedano nel gestire la mia reazione?',
      },
      {
        // A self_03 — chiedere aiuto quando si è in difficoltà
        id: 'self_03',
        testo: 'Quando sono in difficoltà, come penso che le persone che mi conoscono mi vedano nel chiedere aiuto?',
      },
    ],
  },
  {
    id: 'others', nome: 'IO E GLI ALTRI', colore: '#3b6ea5', emoji: '🤝',
    notaLabel: 'Note dell’educatore per quest’area',
    domande: [
      {
        // A others_01 — entrare in relazione e stare con coetanei e adulti
        id: 'others_01',
        testo: 'Come penso che le persone che mi conoscono mi vedano nell’entrare in relazione e stare con gli altri ragazzi e con gli adulti?',
      },
      {
        // A others_02 — collaborare quando si fa qualcosa insieme
        id: 'others_02',
        testo: 'Quando bisogna fare qualcosa insieme, come penso che le persone che mi conoscono mi vedano nel collaborare?',
      },
      {
        // A others_03 — affrontare un conflitto/disaccordo senza rompere la relazione
        id: 'others_03',
        testo: 'Quando litigo o non sono d’accordo con qualcuno, come penso che le persone che mi conoscono mi vedano nell’affrontare la situazione senza rompere la relazione?',
      },
    ],
  },
  {
    id: 'environment', nome: 'IO E L’AMBIENTE', colore: '#e07b39', emoji: '🏡',
    notaLabel: 'Note dell’educatore per quest’area',
    domande: [
      {
        // A environment_01 — rispetto e cura delle proprie cose e degli spazi/oggetti comuni
        id: 'environment_01',
        testo: 'Come penso che le persone che mi conoscono mi vedano nel rispettare e avere cura delle mie cose, degli spazi e delle cose che usiamo tutti?',
      },
      {
        // A environment_02 — portare avanti un piccolo incarico affidato
        id: 'environment_02',
        testo: 'Quando mi viene affidato un piccolo incarico, come penso che le persone che mi conoscono mi vedano nel portarlo avanti?',
      },
      {
        // A environment_03 — prendersi cura di qualcosa che non riguarda soltanto sé
        id: 'environment_03',
        testo: 'Come penso che le persone che mi conoscono mi vedano nel prendermi cura di qualcosa che non riguarda soltanto me (una persona, un animale, un progetto, uno spazio comune)?',
      },
    ],
  },
  {
    id: 'future', nome: 'IO E IL FUTURO', colore: '#8558a5', emoji: '🌱',
    notaLabel: 'Note dell’educatore per quest’area',
    domande: [
      {
        // A future_01 — immaginare qualcosa che si vorrebbe fare, raggiungere o diventare
        id: 'future_01',
        testo: 'Come penso che le persone che mi conoscono mi vedano nell’immaginare qualcosa che vorrei fare, raggiungere o diventare?',
      },
      {
        // A future_02 — decidere pensando anche a cosa potrebbe succedere dopo
        id: 'future_02',
        testo: 'Quando devo fare una scelta, come penso che le persone che mi conoscono mi vedano nel decidere tenendo conto di cosa potrebbe succedere dopo?',
      },
      {
        // A future_03 — portare avanti nel tempo un impegno preso
        id: 'future_03',
        testo: 'Quando prendo un impegno o decido di fare qualcosa, come penso che le persone che mi conoscono mi vedano nel portarlo avanti nel tempo?',
      },
    ],
  },
  {
    id: 'expression', nome: 'ESPRESSIONE E CREATIVITÀ', colore: '#d9634f', emoji: '🎨',
    notaLabel: 'Note dell’educatore per quest’area',
    domande: [
      {
        // A expression_01 — riconoscere cosa piace, cosa interessa e in cosa ci si sente capaci
        id: 'expression_01',
        testo: 'Come penso che le persone che mi conoscono mi vedano nel riconoscere cosa mi piace, cosa mi interessa e in cosa mi sento capace?',
      },
      {
        // A expression_02 — trovare un modo per esprimere ciò che si pensa, si prova o interessa
        id: 'expression_02',
        testo: 'Come penso che le persone che mi conoscono mi vedano nel trovare un modo per esprimere quello che penso, provo o mi interessa?',
      },
      {
        // A expression_03 — provare attività o esperienze nuove anche senza sapere se si sarà capaci
        id: 'expression_03',
        testo: 'Come penso che le persone che mi conoscono mi vedano nel provare attività o esperienze nuove, anche senza sapere già se sarò capace?',
      },
    ],
  },
  {
    id: 'wellbeing', nome: 'BENESSERE E CURA', colore: '#3ba7c9', emoji: '🌤️',
    notaLabel: 'Note dell’educatore per quest’area',
    domande: [
      {
        // A wellbeing_01 — prendersi cura di sé e delle proprie necessità quotidiane
        id: 'wellbeing_01',
        testo: 'Come penso che le persone che mi conoscono mi vedano nel prendermi cura di me e delle mie necessità quotidiane (igiene, alimentazione, sonno, salute)?',
      },
      {
        // A wellbeing_02 — accorgersi di quando si è stanchi, stressati, agitati o non si sta bene
        id: 'wellbeing_02',
        testo: 'Come penso che le persone che mi conoscono mi vedano nell’accorgermi quando sono stanco, stressato, agitato o comunque non sto bene?',
      },
      {
        // A wellbeing_03 — quando non si sta bene, fare qualcosa che aiuta o rivolgersi a qualcuno
        id: 'wellbeing_03',
        testo: 'Quando non sto bene, come penso che le persone che mi conoscono mi vedano nel fare qualcosa che mi aiuta o nel rivolgermi a qualcuno?',
      },
    ],
  },
];

export const TOTALE_INDICATORI = AREE_PPU.reduce((n, a) => n + a.domande.length, 0); // 18

// ── Momento del percorso PPU (identico alla Scheda A) ────────────────────
export const MOMENTI_PPU = [
  { value: 'ingresso',              label: 'Ingresso' },
  { value: 'verifica_3_mesi',       label: 'Verifica 3 mesi' },
  { value: 'verifica_6_mesi',       label: 'Verifica 6 mesi' },
  { value: 'verifica_intermedia',   label: 'Verifica intermedia' },
  { value: 'uscita',                label: 'Uscita' },
  { value: 'altro',                 label: 'Altro' },
];

// ── Firestore: CRUD ──────────────────────────────────────────────────────

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
  const areaNotesVuote = {};
  AREE_PPU.forEach(a => { areaNotesVuote[a.id] = ''; });

  const ref = await addDoc(collection(db, COLLECTION), {
    minorId, comunitaId,
    assessmentDate: serverTimestamp(),
    ppuMoment: null,
    ppuMomentNote: '',
    status: 'bozza',
    createdBy,
    conductedBy: createdBy, // precompilato con chi crea la scheda, modificabile
    passoCorrente: 0,
    risposte: {},        // indicator_id -> 'NO' | 1 | 2 | 3  (stesso formato della Scheda A)
    areaNotes: areaNotesVuote,
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
  return { id: snap.id, ...snap.data() };
}

// Salva un patch parziale (risposta, nota, momento PPU, passo corrente…)
// senza toccare il resto del documento.
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

// ── Operatori della comunità (per il selettore "condotto da") ───────────
// Identico alla Scheda A: filtro client-side su comunitaId (stringa o array).
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

// ── Validazione prima del completamento ──────────────────────────────────
export function validaCompletamento(scheda) {
  const problemi = [];
  if (!scheda.ppuMoment) {
    problemi.push({ tipo: 'momento', msg: 'Seleziona il momento del percorso PPU prima di completare la scheda.' });
  }
  if (!scheda.conductedBy) {
    problemi.push({ tipo: 'conduttore', msg: 'Indica chi ha condotto il colloquio prima di completare la scheda.' });
  }
  AREE_PPU.forEach((area, areaIndex) => {
    const mancanti = area.domande.filter(d => scheda.risposte?.[d.id] === undefined);
    if (mancanti.length) {
      problemi.push({
        tipo: 'risposte', areaIndex,
        msg: `Mancano ${mancanti.length} rispost${mancanti.length === 1 ? 'a' : 'e'} nell'area "${area.nome}".`
      });
    }
  });
  return problemi;
}

// ── Utilità di sola lettura ─────────────────────────────────────────────
export function contaRisposteArea(risposte, area) {
  return area.domande.filter(d => risposte?.[d.id] !== undefined).length;
}

export function indicatoriNonCompilati(risposte) {
  const mancanti = [];
  AREE_PPU.forEach(area => area.domande.forEach(d => {
    if (risposte?.[d.id] === undefined) mancanti.push(d.id);
  }));
  return mancanti;
}

export function labelMomento(value) {
  return MOMENTI_PPU.find(m => m.value === value)?.label || '';
}

// Helper scala — identici alla Scheda A.
export function labelScala(value) {
  return SCALA.find(o => o.value === value)?.label || '—';
}
export function descScala(value) {
  return SCALA.find(o => o.value === value)?.desc || 'Non ancora risposto';
}
function coloreScala(value) {
  return SCALA.find(o => o.value === value)?.colore || '#999';
}

// ── UI: helpers generici (identici alla Scheda A) ───────────────────────

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

// ── UI: elenco schede di un ragazzo ──────────────────────────────────────
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
        <div class="folder-title">COME PENSO CHE MI VEDANO GLI ALTRI</div>
        <div style="font-size:0.72rem;color:#999;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-top:1px;">Scheda PPU · B</div>
      </div>
      ${canWrite ? '<div class="folder-actions"><button class="btn-act" id="ppub-nuova">➕ Nuova scheda</button></div>' : ''}
    </div>
    <p style="padding:0 14px 10px;font-size:0.78rem;color:#888;">Si compila insieme a ${esc(ragazzo.nome||'il ragazzo/a')} durante un colloquio educativo. Serve a capire come ${esc(ragazzo.nome||'il ragazzo/a')} pensa di essere visto dalle persone che lo conoscono realmente (immagine riflessa).</p>
    <div class="item-list" id="ppub-lista"></div>`;

  const nomiCache = {};
  async function nome(uid) {
    if (!uid) return '—';
    if (!nomiCache[uid]) nomiCache[uid] = await getNomePersona(db, uid);
    return nomiCache[uid];
  }

  const lista = document.getElementById('ppub-lista');
  if (!schede.length) {
    lista.innerHTML = '<p class="empty-msg">📭 Nessuna scheda compilata finora.</p>';
  } else {
    for (const s of schede) {
      const badge = s.status === 'completata'
        ? '<span style="background:#e8f5e9;color:#2d7a3a;border-radius:20px;padding:2px 10px;font-size:0.68rem;font-weight:700;">✅ Completata</span>'
        : '<span style="background:#fff3cd;color:#8a6a1a;border-radius:20px;padding:2px 10px;font-size:0.68rem;font-weight:700;">✏️ Bozza</span>';
      const momento = labelMomento(s.ppuMoment) || 'Momento non indicato';
      const conduttore = await nome(s.conductedBy);
      const row = document.createElement('div');
      row.className = 'item-row folder-row';
      row.innerHTML = `
        <span class="item-icon">👥</span>
        <div class="item-info">
          <div class="item-name">${fmtData(s.assessmentDate || s.createdAt)} · ${esc(momento)} ${badge}</div>
          <div class="item-meta">Colloquio condotto da: ${esc(conduttore)}</div>
        </div>
        <span class="item-chevron">›</span>`;
      row.addEventListener('click', () => {
        go(momento, () => montaEditor(main, { ...ctx, schedaId: s.id }));
      });
      lista.appendChild(row);
    }
  }

  const btnNuova = document.getElementById('ppub-nuova');
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

// ── UI: editor/vista della Scheda B ──────────────────────────────────────
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

  // Una scheda completata si apre in sola lettura: l'editing va riattivato
  // esplicitamente con "Riapri per modifica".
  let modalitaLettura = scheda.status === 'completata';

  if (modalitaLettura) { await renderLettura(); return; }
  await renderStepper();

  // ── Vista sola lettura ──────────────────────────────────────────────
  async function renderLettura() {
    const conduttore = await getNomePersona(db, scheda.conductedBy);
    const areeHtml = AREE_PPU.map(area => `
      <div style="margin-bottom:16px;">
        <div style="background:${area.colore}18;border-left:4px solid ${area.colore};border-radius:0 10px 10px 0;padding:8px 12px;margin-bottom:8px;">
          <div style="font-weight:800;color:${area.colore};font-size:0.9rem;">${area.emoji} ${esc(area.nome)}</div>
        </div>
        ${area.domande.map((d, i) => {
          const v = scheda.risposte?.[d.id];
          const risposto = v !== undefined;
          return `
          <div style="padding:6px 12px;">
            <div style="font-size:0.82rem;color:#333;font-weight:600;">${i+1}. ${esc(d.testo)}</div>
            <div style="font-size:0.82rem;color:${risposto ? coloreScala(v) : '#999'};font-weight:700;margin-top:2px;">
              ${risposto ? `${esc(labelScala(v))} — ${esc(descScala(v))}` : '— nessuna risposta —'}
            </div>
          </div>`;
        }).join('')}
        ${scheda.areaNotes?.[area.id] ? `
          <div style="margin:8px 12px 0;background:#f4f6f8;border:1px solid #e2e6ea;border-radius:8px;padding:8px 10px;">
            <div style="font-size:0.68rem;color:#8a94a0;font-weight:800;letter-spacing:0.03em;text-transform:uppercase;margin-bottom:2px;">Note dell’educatore</div>
            <div style="font-size:0.8rem;color:#555;white-space:pre-wrap;">${esc(scheda.areaNotes[area.id])}</div>
          </div>` : ''}
      </div>`).join('');

    main.innerHTML = `
      <div style="padding:14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;flex-wrap:wrap;">
          <div style="font-weight:800;font-size:1rem;color:#333;">COME PENSO CHE MI VEDANO GLI ALTRI</div>
          <span style="background:#e8f5e9;color:#2d7a3a;border-radius:20px;padding:2px 10px;font-size:0.7rem;font-weight:700;">✅ Scheda completata</span>
        </div>
        <div style="font-size:0.78rem;color:#999;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px;">Scheda PPU · B</div>
        <div style="font-size:0.76rem;color:#999;margin-bottom:10px;">Immagine riflessa: come il ragazzo pensa di essere visto dalle persone che lo conoscono realmente.</div>
        <div style="font-size:0.82rem;color:#666;line-height:1.7;margin-bottom:14px;">
          <strong style="color:#333;">${esc(ragazzo.nome||'')}</strong><br>
          Comunità: ${esc(community.label || community.id || '')}<br>
          Momento: ${esc(labelMomento(scheda.ppuMoment))}<br>
          Data: ${fmtData(scheda.assessmentDate || scheda.createdAt)}<br>
          Colloquio condotto da: ${esc(conduttore)}
        </div>
        ${areeHtml}
      </div>
      <div style="height:80px;"></div>
      ${canWrite ? `
      <div style="position:fixed;bottom:62px;left:0;right:0;background:#fff;border-top:1px solid #e5e5e5;padding:10px 14px;z-index:90;">
        <button class="btn-orange" id="ppub-riapri" style="width:100%;">🔓 Riapri per modifica</button>
      </div>` : ''}`;

    document.getElementById('ppub-riapri')?.addEventListener('click', async () => {
      if (!confirm('Riaprire questa scheda per modificarla? Tornerà in stato "bozza".')) return;
      try {
        await riapriScheda(db, schedaId, currentUid);
        scheda.status = 'bozza';
        scheda.reopenedAt = new Date();
        scheda.reopenedBy = currentUid;
        modalitaLettura = false;
        await renderStepper();
      } catch (e) { alert('Errore: ' + e.message); }
    });
  }

  // ── Vista stepper (bozza, editabile) ─────────────────────────────────
  async function renderStepper() {
    let passo = Math.min(Math.max(scheda.passoCorrente || 0, 0), AREE_PPU.length - 1);
    const TOTALE_PASSI = AREE_PPU.length; // 6 aree, nessuna sezione di chiusura

    let pendingPatch = {};
    let saveTimer = null;

    function setSaveStatus(text, isError = false) {
      const el = document.getElementById('ppub-save-status');
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

    function segna(path, value, localApply) {
      localApply();
      pendingPatch[path] = value;
      scheduleAutosave();
    }

    function renderHeader() {
      const areaCorrente = AREE_PPU[passo];
      const etichettaPasso = `Area ${passo + 1} di ${AREE_PPU.length}`;
      const dots = Array.from({ length: TOTALE_PASSI }, (_, i) =>
        `<span style="width:8px;height:8px;border-radius:50%;background:${i===passo?'#e07b39':(i<passo?'#f0c8a0':'#e5e5e5')};display:inline-block;"></span>`
      ).join('');
      const momentoOpts = MOMENTI_PPU.map(m =>
        `<option value="${m.value}" ${scheda.ppuMoment===m.value?'selected':''}>${esc(m.label)}</option>`
      ).join('');
      const operatoriOpts = operatori.map(o =>
        `<option value="${esc(o.uid)}" ${scheda.conductedBy===o.uid?'selected':''}>${esc(o.nome)}</option>`
      ).join('');

      return `
        <div style="padding:12px 14px 4px;">
          <div style="font-weight:800;font-size:1rem;color:#333;line-height:1.15;">COME PENSO CHE MI VEDANO GLI ALTRI</div>
          <div style="font-size:0.7rem;color:#999;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin:2px 0 8px;">Scheda PPU · B · ${esc(ragazzo.nome||'')}</div>

          ${canWrite ? `
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
            <div style="flex:1;min-width:150px;">
              <label style="font-size:0.68rem;color:#888;font-weight:700;display:block;margin-bottom:2px;">MOMENTO DEL PERCORSO PPU</label>
              <select id="ppub-momento" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:5px 8px;font-family:'Nunito',sans-serif;font-size:0.8rem;">
                <option value="">— seleziona —</option>${momentoOpts}
              </select>
            </div>
            ${scheda.ppuMoment === 'altro' ? `
            <div style="flex:1;min-width:150px;">
              <label style="font-size:0.68rem;color:#888;font-weight:700;display:block;margin-bottom:2px;">DESCRIZIONE (facoltativa)</label>
              <input type="text" id="ppub-momento-nota" value="${esc(scheda.ppuMomentNote||'')}" placeholder="Es. Dopo rientro da esperienza esterna"
                style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:5px 8px;font-family:'Nunito',sans-serif;font-size:0.8rem;">
            </div>` : ''}
            <div style="flex:1;min-width:150px;">
              <label style="font-size:0.68rem;color:#888;font-weight:700;display:block;margin-bottom:2px;">COLLOQUIO CONDOTTO DA</label>
              <select id="ppub-conduttore" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:5px 8px;font-family:'Nunito',sans-serif;font-size:0.8rem;">
                <option value="">— seleziona —</option>${operatoriOpts}
              </select>
            </div>
          </div>` : ''}

          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-weight:800;font-size:0.9rem;color:#333;">${etichettaPasso}</div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span id="ppub-save-status" style="font-size:0.68rem;color:#999;min-width:70px;text-align:right;"></span>
              <div style="display:flex;gap:4px;">${dots}</div>
            </div>
          </div>
        </div>`;
    }

    // Testo introduttivo (sezione 3 dello strumento): mostrato solo sulla
    // prima area, in forma graficamente leggibile, sopra le domande.
    function renderIntro() {
      if (passo !== 0) return '';
      const p = TESTO_INTRO.paragrafi.map(t =>
        `<p style="margin:0 0 6px;font-size:0.82rem;color:#555;line-height:1.5;">${esc(t)}</p>`
      ).join('');
      return `
        <div style="margin:0 14px 14px;background:#fff;border:1px solid #e6e0d6;border-left:4px solid #e07b39;border-radius:0 12px 12px 0;padding:12px 14px;">
          <div style="font-weight:800;font-size:0.95rem;color:#333;margin-bottom:6px;">${esc(TESTO_INTRO.titolo)}</div>
          ${p}
          <p style="margin:8px 0 6px;font-size:0.86rem;color:#333;font-weight:700;font-style:italic;line-height:1.5;">${esc(TESTO_INTRO.domandaGuida)}</p>
          <p style="margin:0;font-size:0.82rem;color:#555;line-height:1.5;">${esc(TESTO_INTRO.chiusura)}</p>
        </div>`;
    }

    // Scala di risposta — identica alla Scheda A: N/O · 1 · 2 · 3, uguale
    // per ogni domanda. `data-val` = 'NO' oppure '1'/'2'/'3'.
    function renderScalaButtons(indicatorId, valoreAttuale) {
      return `
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:8px;">
          ${SCALA.map(opt => {
            const selezionato = valoreAttuale === opt.value;
            return `<button type="button" class="ppub-scala-btn" data-ind="${esc(indicatorId)}" data-val="${esc(String(opt.value))}"
              style="text-align:left;padding:9px 11px;border-radius:10px;cursor:pointer;font-family:'Nunito',sans-serif;
                     border:2px solid ${selezionato ? opt.colore : '#e5e5e5'};
                     background:${selezionato ? opt.colore + '22' : '#fff'};">
              <div style="font-weight:800;font-size:0.85rem;color:${opt.colore};">${opt.label}</div>
              <div style="font-size:0.72rem;color:#555;line-height:1.25;">${esc(opt.desc)}</div>
            </button>`;
          }).join('')}
        </div>`;
    }

    function renderAreaBody(area) {
      const nota = scheda.areaNotes?.[area.id] || '';
      return `
        <div style="padding:0 14px 90px;">
          <div style="background:${area.colore}18;border-left:4px solid ${area.colore};border-radius:0 10px 10px 0;padding:10px 12px;margin-bottom:14px;">
            <div style="font-weight:800;color:${area.colore};font-size:0.95rem;">${area.emoji} ${esc(area.nome)}</div>
          </div>
          ${area.domande.map((d, i) => `
            <div style="background:#fff;border-radius:12px;box-shadow:0 1px 5px rgba(0,0,0,0.07);padding:14px;margin-bottom:12px;">
              <div style="font-size:0.88rem;font-weight:700;color:#333;line-height:1.4;">${i+1}. ${esc(d.testo)}</div>
              ${renderScalaButtons(d.id, scheda.risposte?.[d.id])}
            </div>`).join('')}
          <div style="margin-top:6px;background:#f4f6f8;border:1px solid #e2e6ea;border-radius:10px;padding:10px 12px;">
            <label style="font-size:0.72rem;color:#8a94a0;font-weight:800;letter-spacing:0.03em;text-transform:uppercase;display:block;margin-bottom:4px;">
              ${esc(area.notaLabel)} <span style="font-weight:600;text-transform:none;letter-spacing:0;">(facoltativo · non visibile come risposta del ragazzo)</span>
            </label>
            <textarea id="ppub-nota-area" rows="3" placeholder="Osservazioni, contesto, nomi, elementi emersi nel colloquio…"
              style="width:100%;border:1.5px solid #d5dbe1;border-radius:10px;padding:9px 12px;font-family:'Nunito',sans-serif;font-size:0.85rem;resize:vertical;outline:none;background:#fff;">${esc(nota)}</textarea>
          </div>
        </div>`;
    }

    function renderFooter() {
      const isUltimoPasso = passo === AREE_PPU.length - 1;
      return `
        <div style="position:fixed;bottom:62px;left:0;right:0;background:#fff;border-top:1px solid #e5e5e5;padding:10px 14px;display:flex;gap:8px;z-index:90;">
          <button class="btn-ghost" id="ppub-indietro" ${passo===0?'disabled style="opacity:0.4;"':''}>← Indietro</button>
          <div style="flex:1;"></div>
          ${!canWrite ? '' : isUltimoPasso
            ? `<button class="btn-ghost" id="ppub-salva-bozza">💾 Salva bozza</button><button class="btn-orange" id="ppub-completa">✅ Completa scheda</button>`
            : `<button class="btn-orange" id="ppub-avanti">Avanti →</button>`}
        </div>`;
    }

    function renderAvvisi() {
      const problemi = validaCompletamento(scheda);
      if (!problemi.length || passo !== AREE_PPU.length - 1) return '';
      return `
        <div style="margin:0 14px 12px;background:#fff3cd;border:1.5px solid #f0d090;border-radius:10px;padding:10px 12px;font-size:0.8rem;color:#8a6a1a;">
          <strong>Prima di completare:</strong>
          <ul style="margin:6px 0 0 18px;padding:0;">
            ${problemi.map(p => p.tipo === 'risposte'
              ? `<li><a href="#" class="ppub-vai-area" data-area="${p.areaIndex}" style="color:#8a6a1a;">${esc(p.msg)}</a></li>`
              : `<li>${esc(p.msg)}</li>`
            ).join('')}
          </ul>
        </div>`;
    }

    function render() {
      const areaCorrente = AREE_PPU[passo];
      main.innerHTML = renderHeader() + renderIntro() + renderAvvisi() + renderAreaBody(areaCorrente) + renderFooter();
      wire(areaCorrente);
    }

    function cambiaPasso(nuovo) {
      flush(); // non blocca la navigazione, ma avvia subito il salvataggio
      passo = Math.min(Math.max(nuovo, 0), AREE_PPU.length - 1);
      segna('passoCorrente', passo, () => { scheda.passoCorrente = passo; });
      render();
    }

    function wire(areaCorrente) {
      if (canWrite) {
        document.getElementById('ppub-momento')?.addEventListener('change', e => {
          const val = e.target.value || null;
          segna('ppuMoment', val, () => { scheda.ppuMoment = val; });
          render(); // per mostrare/nascondere il campo "descrizione" di 'altro'
        });
        document.getElementById('ppub-momento-nota')?.addEventListener('input', e => {
          segna('ppuMomentNote', e.target.value, () => { scheda.ppuMomentNote = e.target.value; });
        });
        document.getElementById('ppub-conduttore')?.addEventListener('change', e => {
          const val = e.target.value || null;
          segna('conductedBy', val, () => { scheda.conductedBy = val; });
        });

        // Risposta sulla scala N/O · 1 · 2 · 3 — identico alla Scheda A:
        // 'NO' resta la stringa 'NO' (mai 0), 1/2/3 diventano numeri.
        main.querySelectorAll('.ppub-scala-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const ind = btn.dataset.ind;
            const raw = btn.dataset.val;
            const val = raw === 'NO' ? 'NO' : Number(raw);
            segna(`risposte.${ind}`, val, () => { scheda.risposte = { ...(scheda.risposte||{}), [ind]: val }; });
            render();
          });
        });

        const notaEl = document.getElementById('ppub-nota-area');
        if (notaEl && areaCorrente) {
          notaEl.addEventListener('input', () => {
            segna(`areaNotes.${areaCorrente.id}`, notaEl.value, () => {
              scheda.areaNotes = { ...(scheda.areaNotes||{}), [areaCorrente.id]: notaEl.value };
            });
          });
        }

        main.querySelectorAll('.ppub-vai-area').forEach(a => {
          a.addEventListener('click', e => {
            e.preventDefault();
            cambiaPasso(parseInt(a.dataset.area, 10));
          });
        });
      }

      document.getElementById('ppub-indietro')?.addEventListener('click', () => {
        if (passo === 0) return;
        cambiaPasso(passo - 1);
      });
      document.getElementById('ppub-avanti')?.addEventListener('click', () => cambiaPasso(passo + 1));
      document.getElementById('ppub-salva-bozza')?.addEventListener('click', async () => {
        await flush();
        document.getElementById('btn-back')?.click();
      });
      document.getElementById('ppub-completa')?.addEventListener('click', async () => {
        await flush();
        const problemi = validaCompletamento(scheda);
        if (problemi.length) { render(); return; } // l'avviso inline è già visibile
        try {
          await completaScheda(db, schedaId, currentUid);
          scheda.status = 'completata';
          scheda.completedAt = new Date();
          scheda.completedBy = currentUid;
          modalitaLettura = true;
          await renderLettura();
        } catch (e) { alert('Errore: ' + e.message); }
      });
    }

    render();
  }
}
