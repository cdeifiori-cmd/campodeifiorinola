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
// value/label/colore sono IDENTICI alla Scheda A (parità metrica): NON
// cambiano. `desc` è solo testo di fallback, mostrato unicamente se una
// domanda non avesse le sue `opzioni`; oggi tutte le 18 domande le hanno,
// quindi questi testi non compaiono mai a schermo. Sono tenuti neutri e
// coerenti con l'impostazione narrativa, senza incidere sul significato
// metrico di NO/1/2/3.
export const SCALA = [
  { value: 'NO', label: 'N/O', desc: 'Non saprei dire', colore: '#8a8a8a' },
  { value: 1,    label: '1',   desc: 'Pensano che io abbia bisogno di molto aiuto', colore: '#c0392b' },
  { value: 2,    label: '2',   desc: 'Pensano che a volte io abbia bisogno di aiuto', colore: '#d9822b' },
  { value: 3,    label: '3',   desc: 'Pensano che generalmente me la cavi da solo/a', colore: '#3a8a4a' },
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
// della domanda A con lo stesso id: STESSA scena, STESSO costrutto, cambia
// solo il punto di osservazione ("come mi comporto" → "cosa penso direbbero
// di me le persone che mi conoscono"). Le alternative B sono la voce diretta
// di chi ti conosce ("Di solito tu…", "Quando succede…"): stesso significato
// metrico della Scheda A, tono di seconda persona. `opzioni` contiene i
// QUATTRO testi propri di ogni scena; la chiave ('NO'|'1'|'2'|'3') è l'unico
// valore registrato.
export const AREE_PPU = [
  {
    id: 'self', nome: 'IO CON ME STESSO', colore: '#5a8a4a', emoji: '🧭',
    notaLabel: 'Note dell’educatore per quest’area',
    domande: [
      {
        // A self_01 — riconoscere le proprie emozioni forti e comunicarle
        id: 'self_01',
        testo: 'Sei giù o arrabbiato/a per qualcosa e qualcuno se ne accorge. Se le persone che ti conoscono fossero lì, cosa pensi direbbero di come vivi quel momento?',
        opzioni: {
          'NO': 'Non saprei: quando sto così con me cambia troppo.',
          '1':  '"Quando stai male non riesci a dire cosa hai, nemmeno a te stesso/a."',
          '2':  '"Capisci cosa provi, ma lo dici solo a chi ti fidi davvero."',
          '3':  '"Di solito capisci cosa senti e, se vuoi, lo dici."',
        },
      },
      {
        // A self_02 — gestire la propria reazione (rabbia / delusione / provocazione)
        id: 'self_02',
        testo: 'Ti provocano davanti agli altri per farti reagire. Chi ti conosce bene, vedendoti in quel momento, cosa pensi direbbe di come reagisci?',
        opzioni: {
          'NO': 'Con me dipende da chi c’è: non saprei dire.',
          '1':  '"Se ti provocano davanti agli altri, parti subito."',
          '2':  '"A volte lasci correre, a volte ci caschi e poi te ne penti."',
          '3':  '"Anche quando sei furioso/a, quasi sempre decidi tu come rispondere."',
        },
      },
      {
        // A self_03 — chiedere aiuto quando si è in difficoltà
        id: 'self_03',
        testo: 'Sei in difficoltà con qualcosa e potresti chiedere aiuto. Se le persone che ti conoscono fossero lì, cosa pensi direbbero di quanto chiedi aiuto?',
        opzioni: {
          'NO': 'Non saprei: dipende da quanto è grosso il problema.',
          '1':  '"Anche quando sei in difficoltà tieni tutto per te, non chiedi aiuto."',
          '2':  '"Chiedi aiuto solo all’ultimo, o solo a una persona di cui ti fidi."',
          '3':  '"Quando serve, chiedi aiuto senza aspettare troppo."',
        },
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
        testo: 'Sei il primo giorno in un gruppo nuovo dove non conosci nessuno. Se le persone che ti conoscono fossero lì, cosa pensi direbbero di come stai con gli altri?',
        opzioni: {
          'NO': 'In un gruppo nuovo con me cambia ogni volta: non saprei.',
          '1':  '"In un posto nuovo resti per conto tuo, fai fatica ad avvicinarti."',
          '2':  '"Con qualcuno leghi subito, con altri o con gli adulti fai più fatica."',
          '3':  '"Di solito ti inserisci e parli con tutti, ragazzi e adulti."',
        },
      },
      {
        // A others_02 — collaborare in un compito comune (NON "proteggere il più debole")
        id: 'others_02',
        testo: 'State giocando in squadra: uno continua a sbagliare e qualcuno si innervosisce, ma dovete collaborare per farcela. Se le persone che ti conoscono fossero lì, cosa pensi direbbero di come stai nella squadra?',
        opzioni: {
          'NO': 'Nei gruppi con me cambia parecchio: non saprei.',
          '1':  '"Nei giochi di squadra o fai tutto tu o ti sfili."',
          '2':  '"Collabori, ma quando gli altri sbagliano ti innervosisci."',
          '3':  '"Fai la tua parte e cerchi di tenere insieme la squadra."',
        },
      },
      {
        // A others_03 — affrontare un conflitto senza rompere la relazione
        id: 'others_03',
        testo: 'Hai litigato forte con una persona a cui tieni. Chi ti conosce, guardandoti in un litigio così, cosa pensi direbbe di come lo gestisci?',
        opzioni: {
          'NO': 'Dipende da con chi ho litigato: non saprei cosa direbbero.',
          '1':  '"Quando litighi forte, quel rapporto spesso si chiude."',
          '2':  '"Alla fine chiarisci, ma di solito muove prima l’altro/a."',
          '3':  '"Litighi, ma poi chiarisci senza rompere il rapporto."',
        },
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
        testo: 'Hai usato uno spazio comune e poi lo lasci. Se le persone che ti conoscono fossero lì, cosa pensi direbbero di come tratti le cose di tutti?',
        opzioni: {
          'NO': 'Non è una cosa su cui mi guardano di solito: non saprei.',
          '1':  '"Lasci le cose come capita, non ci fai caso."',
          '2':  '"Le sistemi, ma soprattutto se qualcuno te lo dice."',
          '3':  '"Hai cura degli spazi comuni anche quando nessuno controlla."',
        },
      },
      {
        // A environment_02 — portare a termine un incarico affidato
        id: 'environment_02',
        testo: 'Ti hanno affidato un compito con una scadenza. Se le persone che ti conoscono fossero lì, cosa pensi direbbero di quanto sei affidabile?',
        opzioni: {
          'NO': 'Con me dipende dal compito: non saprei dire.',
          '1':  '"Se ti affidano una cosa, spesso la lasci a metà."',
          '2':  '"La finisci, ma vai seguito/a o te lo devono ricordare."',
          '3':  '"Se prendi un impegno, di solito lo porti fino in fondo."',
        },
      },
      {
        // A environment_03 — prendersi cura di qualcosa che non riguarda soltanto sé, anche senza un ordine
        id: 'environment_03',
        testo: 'Arrivi in uno spazio comune e lo trovi pieno di cose lasciate in giro, ma non sei stato/a tu. Chi ti conosce, vedendoti lì, cosa pensi direbbe di come tratti quello che è di tutti?',
        opzioni: {
          'NO': 'Non ci ho mai fatto caso davvero: non so cosa direbbero.',
          '1':  '"Se non l’hai sporcato tu, lasci stare."',
          '2':  '"Dai una mano se qualcuno comincia, da solo/a di rado."',
          '3':  '"Ci pensi lo stesso, anche se non tocca a te."',
        },
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
        testo: 'Ti chiedono cosa vorresti fare o diventare da grande. Se chi ti conosce ti sentisse rispondere, cosa pensi direbbe del tuo modo di guardare al futuro?',
        opzioni: {
          'NO': 'Del mio futuro non saprei cosa direbbero.',
          '1':  '"Del futuro preferisci non parlarne, non sai cosa vuoi."',
          '2':  '"Qualche idea ce l’hai, ma è ancora tutto vago."',
          '3':  '"Hai un’idea abbastanza precisa di dove vuoi arrivare."',
        },
      },
      {
        // A future_02 — decidere pensando anche a cosa potrebbe succedere dopo
        id: 'future_02',
        testo: 'Devi scegliere tra qualcosa che ti va adesso e qualcosa che conta di più più avanti — per esempio 30 euro da spendere o da tenere. Se le persone che ti conoscono fossero lì, cosa pensi direbbero di come decidi?',
        opzioni: {
          'NO': 'Dipende da cosa c’è da scegliere: non saprei.',
          '1':  '"Decidi sul momento, non pensi a cosa viene dopo."',
          '2':  '"Ci pensi, ma di solito quando hai già deciso."',
          '3':  '"Prima pesi cosa succede dopo, poi scegli."',
        },
      },
      {
        // A future_03 — portare avanti nel tempo un impegno preso (perseveranza)
        id: 'future_03',
        testo: 'Hai iniziato una cosa che dopo un po’ stanca e annoia. Se le persone che ti conoscono fossero lì, cosa pensi direbbero di quanto porti a termine quello che inizi?',
        opzioni: {
          'NO': 'Non saprei: dipende da quanto ci tengo alla cosa.',
          '1':  '"Quando passa l’entusiasmo iniziale, di solito molli."',
          '2':  '"Vai a fasi: quando si fa dura rischi di lasciare."',
          '3':  '"Anche quando è faticoso, di solito arrivi in fondo."',
        },
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
        testo: 'Ti chiedono cosa ti piace e in cosa sei bravo/a. Se le persone che ti conoscono fossero lì, cosa pensi direbbero di quanto ti conosci su questo?',
        opzioni: {
          'NO': 'Forse non lo saprebbero bene neanche loro: non saprei.',
          '1':  '"Fai fatica a dire cosa ti piace o in cosa sei bravo/a."',
          '2':  '"Qualcosa sai dirlo, ma solo per alcune cose."',
          '3':  '"Sai bene cosa ti interessa e cosa ti riesce."',
        },
      },
      {
        // A expression_02 — trovare un modo per esprimere ciò che si pensa, si prova o interessa
        id: 'expression_02',
        testo: 'Hai qualcosa dentro che vorresti far uscire. Se le persone che ti conoscono fossero lì, cosa pensi direbbero di quanto riesci a esprimerti?',
        opzioni: {
          'NO': 'È una cosa che vedono poco di me: non saprei.',
          '1':  '"Quello che hai dentro resta lì, fai fatica a dirlo."',
          '2':  '"Ti esprimi, ma solo con alcune persone o in certi momenti."',
          '3':  '"Hai modi tuoi per dire quello che pensi e senti."',
        },
      },
      {
        // A expression_03 — provare attività o esperienze nuove anche senza sapere se si sarà capaci
        id: 'expression_03',
        testo: 'Sei davanti a una cosa nuova, con il rischio di sbagliare davanti agli altri. Se le persone che ti conoscono fossero lì, cosa pensi direbbero di te?',
        opzioni: {
          'NO': 'Davanti a una cosa nuova non saprei cosa si aspettano da me.',
          '1':  '"Se pensi di poter fare brutta figura, di solito non provi."',
          '2':  '"Provi, soprattutto se ti senti sostenuto/a o abbastanza sicuro/a."',
          '3':  '"Anche se non sai come andrà, di solito parti e provi."',
        },
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
        testo: 'Pensa a come tieni sonno, telefono la sera, pasti, cura di te. Se le persone che ti conoscono fossero lì, cosa pensi direbbero?',
        opzioni: {
          'NO': 'Forse non lo sanno bene neanche loro: non saprei.',
          '1':  '"Non ti regoli: dormi poco, salti i pasti, telefono fino a tardi."',
          '2':  '"Ti prendi cura di te, ma vai ricordato/a."',
          '3':  '"Di solito ti gestisci da solo/a con sonno, pasti e cura di te."',
        },
      },
      {
        // A wellbeing_02 — accorgersi di quando si è stanchi, stressati, agitati o non si sta bene
        id: 'wellbeing_02',
        testo: 'Sei sotto pressione e il corpo e l’umore ti mandano segnali. Se le persone che ti conoscono fossero lì, cosa pensi direbbero di quanto ti accorgi quando non stai bene?',
        opzioni: {
          'NO': 'Non saprei se se ne accorgerebbero.',
          '1':  '"Non ti accorgi di stare male finché non esplodi o crolli."',
          '2':  '"Te ne accorgi, ma quando sei già messo/a male."',
          '3':  '"Di solito capisci presto quando sei stanco/a o sotto stress."',
        },
      },
      {
        // A wellbeing_03 — quando non si sta bene, fare qualcosa che aiuta o rivolgersi a qualcuno
        id: 'wellbeing_03',
        testo: 'Stai male e potresti reagire facendo qualcosa o parlandone. Chi ti conosce, in una giornata così, cosa pensi direbbe di come la affronti?',
        opzioni: {
          'NO': 'Nei momenti no con me cambia: non saprei cosa direbbero.',
          '1':  '"Quando stai male resti lì, non fai niente e non ne parli."',
          '2':  '"A volte reagisci o ne parli, ma se qualcuno se ne accorge prima."',
          '3':  '"Di solito fai qualcosa che ti aiuta o ne parli con qualcuno."',
        },
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
          const testoOpt = d.opzioni?.[String(v)] ?? descScala(v);
          return `
          <div style="padding:6px 12px;">
            <div style="font-size:0.82rem;color:#333;font-weight:600;">${i+1}. ${esc(d.testo)}</div>
            <div style="font-size:0.82rem;color:${risposto ? coloreScala(v) : '#999'};font-weight:700;margin-top:2px;">
              ${risposto ? `${esc(labelScala(v))} — ${esc(testoOpt)}` : '— nessuna risposta —'}
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

    // Scala di risposta — valori identici alla Scheda A (N/O · 1 · 2 · 3),
    // ma con i QUATTRO testi propri di ogni domanda (domanda.opzioni).
    // `data-val` resta 'NO'|'1'|'2'|'3': è l'unico valore che viene salvato.
    // `opt.desc` è solo fallback se una domanda non avesse `opzioni`.
    function renderScalaButtons(domanda, valoreAttuale) {
      return `
        <div style="display:grid;grid-template-columns:1fr;gap:6px;margin-top:8px;">
          ${SCALA.map(opt => {
            const selezionato = valoreAttuale === opt.value;
            const testoOpt = domanda.opzioni?.[String(opt.value)] ?? opt.desc;
            return `<button type="button" class="ppub-scala-btn" data-ind="${esc(domanda.id)}" data-val="${esc(String(opt.value))}"
              style="display:flex;gap:9px;align-items:flex-start;text-align:left;padding:10px 11px;border-radius:10px;cursor:pointer;font-family:'Nunito',sans-serif;min-height:44px;
                     border:2px solid ${selezionato ? opt.colore : '#e5e5e5'};
                     background:${selezionato ? opt.colore + '22' : '#fff'};">
              <span style="flex:0 0 auto;font-weight:800;font-size:0.85rem;color:${opt.colore};width:1.6em;">${opt.label}</span>
              <span style="font-size:0.8rem;color:#333;line-height:1.3;">${esc(testoOpt)}</span>
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
              ${renderScalaButtons(d, scheda.risposte?.[d.id])}
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
