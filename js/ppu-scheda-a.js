// js/ppu-scheda-a.js — "Come mi vedo" (Scheda PPU): autovalutazione del
// ragazzo (13/14-17 anni), compilata CON il ragazzo durante un colloquio
// educativo. Non è un test, non produce punteggi né classificazioni.
// Nome tecnico interno: PPUSelfAssessment.
//
// Gli indicator_id (self_01…wellbeing_03) sono stabili per progettazione:
// la futura "Scheda B – Cosa osservo" dovrà usare gli STESSI id per
// permettere il confronto (delta = valore A - valore B, solo quando
// entrambi numerici, non ancora implementato). Non modificare questi id.
//
// Riceve `db` per dependency injection (nessuna init Firebase propria):
// il chiamante (documenti.html) passa la stessa istanza già inizializzata.

import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const COLLECTION = 'ppu_schede_a';
const AUTOSAVE_DEBOUNCE_MS = 1000;

// ── Scala comune PPU ────────────────────────────────────────────────────
// N/O NON è 0: è l'assenza di una risposta numerica. Il valore è la
// stringa 'NO' quando scelto esplicitamente; la chiave dell'indicatore è
// del tutto assente dalla mappa "risposte" finché non si risponde.
export const SCALA = [
  { value: 'NO', label: 'N/O', desc: 'Non so / non saprei dirlo', colore: '#8a8a8a' },
  { value: 1,    label: '1',   desc: 'Ho bisogno di molto aiuto', colore: '#c0392b' },
  { value: 2,    label: '2',   desc: 'A volte ho bisogno di aiuto', colore: '#d9822b' },
  { value: 3,    label: '3',   desc: 'Generalmente me la cavo da solo', colore: '#3a8a4a' },
];

// ── Le 6 aree × 3 indicatori ciascuna (indicator_id stabili) ────────────
// Ogni domanda è una scena di vita concreta; `opzioni` contiene i QUATTRO
// testi di risposta propri di quella scena. La chiave dell'opzione
// ('NO' | '1' | '2' | '3') è ciò che il software registra: il ragazzo/la
// ragazza legge invece quattro possibilità diverse per ogni domanda. La
// progressione metrica resta invariata: 'NO' = non riesco/non saprei
// collocarmi; 1 = maggiore difficoltà / più bisogno di accompagnamento;
// 2 = situazione intermedia; 3 = maggiore autonomia / capacità
// generalmente acquisita. Le parole visibili possono cambiare: il
// significato metrico sottostante no.
export const AREE_PPU = [
  {
    id: 'self', nome: 'IO CON ME STESSO', colore: '#5a8a4a', emoji: '🧭',
    notaLabel: 'Se vuoi raccontare qualcosa o fare un esempio…',
    domande: [
      {
        // costrutto: riconoscere le proprie emozioni forti e comunicarle
        id: 'self_01',
        testo: 'Ti è successo qualcosa che ti ha fatto stare male o arrabbiare parecchio. Qualcuno se ne accorge e ti chiede cos’hai. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Su questo non so ancora bene come funziono.',
          '1':  'Faccio fatica a capire io cosa provo, e taglio corto con un "niente".',
          '2':  'Capisco cosa sento, ma lo dico solo a poche persone.',
          '3':  'Capisco cosa provo e, se voglio, riesco a spiegarlo.',
        },
      },
      {
        // costrutto: gestire la propria reazione (rabbia / delusione / provocazione)
        id: 'self_02',
        testo: 'Qualcuno ti prende in giro o ti provoca davanti agli altri, apposta per farti reagire. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Cambia troppo a seconda di chi ho davanti: non saprei.',
          '1':  'Faccio fatica a fermarmi: rispondo o reagisco d’istinto.',
          '2':  'A volte lascio perdere, a volte ci casco e poi me ne pento.',
          '3':  'Anche quando sono furioso/a, in genere decido io come reagire.',
        },
      },
      {
        // costrutto: chiedere aiuto quando si è in difficoltà
        id: 'self_03',
        testo: 'Sei bloccato/a su qualcosa che da solo/a non riesci a sbrogliare — una materia in cui stai andando sotto, un problema che ti pesa. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Non saprei: dipende da quanto è grosso il problema.',
          '1':  'Tengo tutto per me, anche quando sono davvero in difficoltà.',
          '2':  'Chiedo aiuto solo quando la cosa è già diventata grande.',
          '3':  'Se da solo/a non ci arrivo, di solito chiedo aiuto per tempo.',
        },
      },
    ]
  },
  {
    id: 'others', nome: 'IO E GLI ALTRI', colore: '#3b6ea5', emoji: '🤝',
    notaLabel: 'Se vuoi raccontare qualcosa sui tuoi rapporti con gli altri…',
    domande: [
      {
        // costrutto: entrare in relazione e stare con coetanei e adulti
        id: 'others_01',
        testo: 'Primo giorno in un posto nuovo — una classe, una squadra, un gruppo — dove non conosci quasi nessuno, ragazzi e adulti. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'In un gruppo nuovo con me cambia ogni volta: non saprei.',
          '1':  'Resto in disparte: fare il primo passo mi mette a disagio.',
          '2':  'Con qualcuno riesco a parlare, con altri o con gli adulti faccio fatica.',
          '3':  'Riesco a inserirmi, sia con i ragazzi sia con gli adulti.',
        },
      },
      {
        // costrutto: collaborare in un compito comune (NON "proteggere il più debole")
        id: 'others_02',
        testo: 'State facendo qualcosa in squadra — un gioco online, una partita, un lavoro di gruppo. Uno continua a sbagliare e qualcuno si innervosisce, ma per farcela dovete comunque collaborare. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'In squadra con me cambia da volta a volta: non saprei.',
          '1':  'O prendo in mano tutto io, o mollo e lascio fare agli altri.',
          '2':  'Collaboro, ma quando gli altri sbagliano mi innervosisco.',
          '3':  'Faccio la mia parte e provo a tenere insieme la squadra.',
        },
      },
      {
        // costrutto: affrontare un conflitto senza rompere la relazione
        id: 'others_03',
        testo: 'Litighi sul serio con un amico/a o con una persona a cui tieni. Restate male tutti e due. Cosa ti assomiglia di più nei giorni dopo?',
        opzioni: {
          'NO': 'Con chi ho litigato conta parecchio: non saprei dire.',
          '1':  'Di solito il rapporto si rompe, o resta il gelo a lungo.',
          '2':  'Prima o poi ci riparliamo, ma di solito fa il primo passo l’altro/a.',
          '3':  'Quasi sempre cerco il chiarimento e rimetto a posto le cose.',
        },
      },
    ]
  },
  {
    id: 'environment', nome: 'IO E L’AMBIENTE', colore: '#e07b39', emoji: '🏡',
    notaLabel: 'Se vuoi fare un esempio…',
    domande: [
      {
        // costrutto: rispetto e cura delle proprie cose e degli spazi/oggetti comuni
        id: 'environment_01',
        testo: 'Hai usato la cucina o la stanza comune con gli altri. Hai finito e devi decidere come lasciarla. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Non ci ho mai fatto davvero caso.',
          '1':  'La lascio com’è e vado, anche se non è in ordine.',
          '2':  'La sistemo, ma di solito solo se qualcuno me lo fa notare.',
          '3':  'Lascio in ordine anche quando nessuno mi guarda.',
        },
      },
      {
        // costrutto: portare a termine un incarico affidato
        id: 'environment_02',
        testo: 'Ti hanno affidato una cosa da fare entro oggi — un turno, andare a prendere qualcosa per il gruppo, una piccola responsabilità. Contano su di te. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Non saprei: dipende da che compito è.',
          '1':  'Parto, ma spesso lo lascio a metà o me ne dimentico.',
          '2':  'Lo finisco, ma se qualcuno mi segue o me lo ricorda.',
          '3':  'Se prendo un incarico, di norma lo finisco da solo/a.',
        },
      },
      {
        // costrutto: prendersi cura di qualcosa che non riguarda soltanto sé, anche senza un ordine
        id: 'environment_03',
        testo: 'Arrivi al campetto o allo spazio comune dove stai con gli altri e lo trovi pieno di bottiglie e cartacce lasciate in giro. Nessuno ti ha detto di sistemare e non sei stato/a tu a sporcare. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Su questo non saprei cosa farei.',
          '1':  'Lascio stare: se non l’ho sporcato io, non tocca a me.',
          '2':  'Se qualcuno inizia a raccogliere do una mano, da solo/a no.',
          '3':  'Lo raccolgo lo stesso: è un posto di tutti.',
        },
      },
    ]
  },
  {
    id: 'future', nome: 'IO E IL FUTURO', colore: '#8558a5', emoji: '🌱',
    notaLabel: 'Una cosa che vorrei per il mio futuro…',
    domande: [
      {
        // costrutto: immaginare qualcosa che si vorrebbe fare, raggiungere o diventare
        id: 'future_01',
        testo: 'Un adulto ti chiede cosa vorresti fare o diventare più avanti — che lavoro, che vita. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Sul mio futuro non so ancora bene cosa penso.',
          '1':  'Preferisco non pensarci: non mi viene in mente niente.',
          '2':  'Ho qualche desiderio, ma vago, e non so se sia possibile.',
          '3':  'Ho un’idea abbastanza chiara, anche se può cambiare.',
        },
      },
      {
        // costrutto: decidere pensando anche a cosa potrebbe succedere dopo
        id: 'future_02',
        testo: 'Ti ritrovi con 30 euro in mano. Puoi spenderli subito in qualcosa che ti va adesso, oppure tenerli per una cosa che ti interessa di più ma che arriva più avanti. Cosa ti assomiglia di più quando decidi?',
        opzioni: {
          'NO': 'Non saprei: dipende da cosa c’è da scegliere.',
          '1':  'Decido sul momento, per quello che mi va adesso.',
          '2':  'Ci penso, ma spesso quando ho già deciso.',
          '3':  'Prima peso cosa succede dopo, poi scelgo.',
        },
      },
      {
        // costrutto: portare avanti nel tempo un impegno preso (perseveranza)
        id: 'future_03',
        testo: 'Hai iniziato una cosa che volevi portare avanti — allenarti, recuperare a scuola, imparare qualcosa. Dopo un po’ diventa faticosa e noiosa. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Non saprei: dipende da quanto ci tengo.',
          '1':  'Mollo appena passa la voglia iniziale.',
          '2':  'Vado avanti a tratti: quando si fa dura rischio di lasciare.',
          '3':  'Vado avanti anche quando è faticoso, magari cambiando metodo.',
        },
      },
    ]
  },
  {
    id: 'expression', nome: 'ESPRESSIONE E CREATIVITÀ', colore: '#d9634f', emoji: '🎨',
    notaLabel: 'Una cosa che mi piace o in cui mi sento bravo…',
    domande: [
      {
        // costrutto: riconoscere cosa piace, cosa interessa e in cosa ci si sente capaci
        id: 'expression_01',
        testo: 'Devi scegliere un’attività per i prossimi mesi e un educatore ti chiede in cosa ti senti bravo/a e cosa ti piace davvero. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Su questo non so ancora bene come sono fatto/a.',
          '1':  'Faccio fatica: non so cosa mi piace né in cosa sono capace.',
          '2':  'Qualcosa che mi piace so dirlo, ma non con sicurezza.',
          '3':  'So abbastanza bene cosa mi interessa e cosa mi riesce.',
        },
      },
      {
        // costrutto: trovare un modo per esprimere ciò che si pensa, si prova o interessa
        id: 'expression_02',
        testo: 'Hai qualcosa in testa che vorresti far uscire — un’idea, una cosa che ti gira dentro, qualcosa che ti appassiona. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Non saprei: dipende da cosa ho da dire.',
          '1':  'Faccio molta fatica a farlo uscire: di solito resta dentro.',
          '2':  'Ci riesco, ma solo con certe persone o in certi momenti.',
          '3':  'Trovo un modo mio per dirlo, a parole o in altro modo.',
        },
      },
      {
        // costrutto: provare attività o esperienze nuove anche senza sapere se si sarà capaci
        id: 'expression_03',
        testo: 'Ti propongono di provare una cosa che non hai mai fatto. Non sai se sarai capace e potresti fare una figuraccia davanti agli altri. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Davanti a una cosa nuova non saprei cosa farei.',
          '1':  'Se rischio la figuraccia, preferisco non provare.',
          '2':  'Provo più facilmente se qualcuno è con me o mi sento sicuro/a.',
          '3':  'La curiosità di solito vince sulla paura: provo.',
        },
      },
    ]
  },
  {
    id: 'wellbeing', nome: 'BENESSERE E CURA', colore: '#3ba7c9', emoji: '🌤️',
    notaLabel: 'Quando non sto bene, quello che mi aiuta di più è…',
    domande: [
      {
        // costrutto: prendersi cura di sé e delle proprie necessità quotidiane
        id: 'wellbeing_01',
        testo: 'Pensa a come tieni sonno, telefono la sera, pasti, doccia — le cose di base per stare in piedi. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Cambia da periodo a periodo: non saprei.',
          '1':  'Faccio fatica: dormo poco col telefono, salto i pasti.',
          '2':  'Me ne occupo, ma di solito se qualcuno me lo ricorda.',
          '3':  'Mi gestisco da solo/a con sonno, pasti e cura di me.',
        },
      },
      {
        // costrutto: accorgersi di quando si è stanchi, stressati, agitati o non si sta bene
        id: 'wellbeing_02',
        testo: 'Hai avuto giorni pesanti — scuola, tensioni, poco sonno. Il corpo e l’umore ti mandano segnali: nervoso/a, mal di testa, scatti. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Non saprei dire se di solito me ne accorgo.',
          '1':  'Me ne accorgo solo quando esplodo o crollo.',
          '2':  'Me ne accorgo, ma quando il malessere è già forte.',
          '3':  'Capisco abbastanza presto quando sono sotto stress.',
        },
      },
      {
        // costrutto: quando non si sta bene, fare qualcosa che aiuta o rivolgersi a qualcuno
        id: 'wellbeing_03',
        testo: 'Sei in un momento no: giù, agitato/a, o è successo qualcosa che ti pesa. Potresti fare qualcosa che ti aiuta o parlarne con qualcuno. Cosa ti assomiglia di più?',
        opzioni: {
          'NO': 'Nei momenti no non saprei cosa faccio.',
          '1':  'Di solito resto lì fermo/a, senza fare né dire niente.',
          '2':  'Ogni tanto reagisco o ne parlo, ma se qualcuno se ne accorge prima.',
          '3':  'Faccio qualcosa che mi tira su, o ne parlo con chi mi fido.',
        },
      },
    ]
  },
];

export const TOTALE_INDICATORI = AREE_PPU.reduce((n, a) => n + a.domande.length, 0); // 18

// ── Chiusura del colloquio: 3 domande aperte, mai trasformate in punteggio ──
export const DOMANDE_CHIUSURA = [
  { id: 'perceivedStrength',  testo: 'Quale di queste cose pensi di saper fare meglio?' },
  { id: 'desiredImprovement', testo: 'Quale vorresti riuscire a fare meglio?' },
  { id: 'chosenGrowthArea',   testo: 'Su quale ti piacerebbe lavorare insieme agli educatori?' },
];

// ── Momento del percorso PPU ──────────────────────────────────────────────
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
  const closingVuota = {};
  DOMANDE_CHIUSURA.forEach(q => { closingVuota[q.id] = ''; });

  const ref = await addDoc(collection(db, COLLECTION), {
    minorId, comunitaId,
    assessmentDate: serverTimestamp(),
    ppuMoment: null,
    ppuMomentNote: '',
    status: 'bozza',
    createdBy,
    conductedBy: createdBy, // precompilato con chi crea la scheda, modificabile
    passoCorrente: 0,
    risposte: {},
    areaNotes: areaNotesVuote,
    closing: closingVuota,
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
// Riusa la stessa collezione/pattern già usato da staff.html e dal gate di
// accesso di documenti.html: nessun nuovo sottosistema, solo un filtro
// client-side su comunitaId (stringa o array).
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
// Restituisce un array di problemi (vuoto = tutto ok), ciascuno con un
// messaggio parlante da mostrare inline (mai un alert generico).
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

// ── Utilità di sola lettura, per un'eventuale vista riassuntiva ─────────
// NIENTE media, NIENTE punteggio totale: solo conteggio di quanti indicatori
// per area hanno una risposta numerica, utile a mostrare "3/3 risposte" —
// non un giudizio.
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

export function labelScala(value) {
  return SCALA.find(o => o.value === value)?.label || '—';
}

export function descScala(value) {
  return SCALA.find(o => o.value === value)?.desc || 'Non ancora risposto';
}

// ── UI: helpers generici ─────────────────────────────────────────────────

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
// `go(label, renderFn)` è la stessa funzione di navigazione di documenti.html.
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
        <div class="folder-title">COME MI VEDO</div>
        <div style="font-size:0.72rem;color:#999;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-top:1px;">Scheda PPU</div>
      </div>
      ${canWrite ? '<div class="folder-actions"><button class="btn-act" id="ppu-nuova">➕ Nuova scheda</button></div>' : ''}
    </div>
    <p style="padding:0 14px 10px;font-size:0.78rem;color:#888;">Si compila insieme a ${esc(ragazzo.nome||'il ragazzo/a')} durante un colloquio educativo.</p>
    <div class="item-list" id="ppu-lista"></div>`;

  // Nomi "condotto da" risolti in batch per l'elenco
  const nomiCache = {};
  async function nome(uid) {
    if (!uid) return '—';
    if (!nomiCache[uid]) nomiCache[uid] = await getNomePersona(db, uid);
    return nomiCache[uid];
  }

  const lista = document.getElementById('ppu-lista');
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
        <span class="item-icon">📝</span>
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

  const btnNuova = document.getElementById('ppu-nuova');
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

// ── UI: editor/vista della Scheda A ──────────────────────────────────────
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
  // Garantisce che l'utente corrente sia sempre selezionabile come
  // conduttore, anche se non ha (ancora) un doc staff con questa comunità.
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
          const testoOpt = d.opzioni?.[String(v)] ?? descScala(v);
          return `
          <div style="padding:6px 12px;">
            <div style="font-size:0.82rem;color:#333;font-weight:600;">${i+1}. ${esc(d.testo)}</div>
            <div style="font-size:0.82rem;color:${SCALA.find(o=>o.value===v)?.colore || '#999'};font-weight:700;margin-top:2px;">
              ${v === undefined ? '— nessuna risposta —' : `${labelScala(v)} — ${esc(testoOpt)}`}
            </div>
          </div>`;
        }).join('')}
        ${scheda.areaNotes?.[area.id] ? `<div style="padding:6px 12px;font-size:0.8rem;color:#666;font-style:italic;">“${esc(scheda.areaNotes[area.id])}”</div>` : ''}
      </div>`).join('');

    const chiusuraHtml = DOMANDE_CHIUSURA.map(q => `
      <div style="margin-bottom:10px;">
        <div style="font-size:0.82rem;font-weight:700;color:#333;">${esc(q.testo)}</div>
        <div style="font-size:0.82rem;color:#555;margin-top:2px;">${esc(scheda.closing?.[q.id]) || '<span style="color:#bbb;">— nessuna risposta —</span>'}</div>
      </div>`).join('');

    main.innerHTML = `
      <div style="padding:14px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px;">
          <div style="font-weight:800;font-size:1rem;color:#333;">COME MI VEDO</div>
          <span style="background:#e8f5e9;color:#2d7a3a;border-radius:20px;padding:2px 10px;font-size:0.7rem;font-weight:700;">✅ Scheda completata</span>
        </div>
        <div style="font-size:0.78rem;color:#999;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:10px;">Scheda PPU</div>
        <div style="font-size:0.82rem;color:#666;line-height:1.7;margin-bottom:14px;">
          <strong style="color:#333;">${esc(ragazzo.nome||'')}</strong><br>
          Momento: ${esc(labelMomento(scheda.ppuMoment))}<br>
          Data: ${fmtData(scheda.assessmentDate || scheda.createdAt)}<br>
          Colloquio condotto da: ${esc(conduttore)}
        </div>
        ${areeHtml}
        <div style="margin-top:6px;">
          <div class="section-title muted" style="padding-left:0;">PER CONCLUDERE</div>
          ${chiusuraHtml}
        </div>
      </div>
      <div style="height:80px;"></div>
      ${canWrite ? `
      <div style="position:fixed;bottom:62px;left:0;right:0;background:#fff;border-top:1px solid #e5e5e5;padding:10px 14px;z-index:90;">
        <button class="btn-orange" id="ppu-riapri" style="width:100%;">🔓 Riapri per modifica</button>
      </div>` : ''}`;

    document.getElementById('ppu-riapri')?.addEventListener('click', async () => {
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
    let passo = Math.min(Math.max(scheda.passoCorrente || 0, 0), AREE_PPU.length);
    const TOTALE_PASSI = AREE_PPU.length + 1; // 6 aree + chiusura

    let pendingPatch = {};
    let saveTimer = null;

    function setSaveStatus(text, isError = false) {
      const el = document.getElementById('ppu-save-status');
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
      const areaCorrente = passo < AREE_PPU.length ? AREE_PPU[passo] : null;
      const etichettaPasso = areaCorrente ? `Area ${passo + 1} di ${AREE_PPU.length}` : 'Per concludere';
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
          <div style="font-weight:800;font-size:1rem;color:#333;line-height:1;">COME MI VEDO</div>
          <div style="font-size:0.7rem;color:#999;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin:2px 0 8px;">Scheda PPU · ${esc(ragazzo.nome||'')}</div>

          ${canWrite ? `
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
            <div style="flex:1;min-width:150px;">
              <label style="font-size:0.68rem;color:#888;font-weight:700;display:block;margin-bottom:2px;">MOMENTO DEL PERCORSO PPU</label>
              <select id="ppu-momento" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:5px 8px;font-family:'Nunito',sans-serif;font-size:0.8rem;">
                <option value="">— seleziona —</option>${momentoOpts}
              </select>
            </div>
            ${scheda.ppuMoment === 'altro' ? `
            <div style="flex:1;min-width:150px;">
              <label style="font-size:0.68rem;color:#888;font-weight:700;display:block;margin-bottom:2px;">DESCRIZIONE (facoltativa)</label>
              <input type="text" id="ppu-momento-nota" value="${esc(scheda.ppuMomentNote||'')}" placeholder="Es. Dopo rientro da esperienza esterna"
                style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:5px 8px;font-family:'Nunito',sans-serif;font-size:0.8rem;">
            </div>` : ''}
            <div style="flex:1;min-width:150px;">
              <label style="font-size:0.68rem;color:#888;font-weight:700;display:block;margin-bottom:2px;">COLLOQUIO CONDOTTO DA</label>
              <select id="ppu-conduttore" style="width:100%;border:1.5px solid #ddd;border-radius:8px;padding:5px 8px;font-family:'Nunito',sans-serif;font-size:0.8rem;">
                <option value="">— seleziona —</option>${operatoriOpts}
              </select>
            </div>
          </div>` : ''}

          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div style="font-weight:800;font-size:0.9rem;color:#333;">${etichettaPasso}</div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span id="ppu-save-status" style="font-size:0.68rem;color:#999;min-width:70px;text-align:right;"></span>
              <div style="display:flex;gap:4px;">${dots}</div>
            </div>
          </div>
        </div>`;
    }

    // Ogni domanda ha i suoi quattro testi di risposta (domanda.opzioni).
    // `data-val` resta 'NO'|'1'|'2'|'3': è l'unico valore che viene salvato.
    // `opt.desc` è solo fallback se una domanda non avesse `opzioni`.
    function renderScalaButtons(domanda, valoreAttuale) {
      return `
        <div style="display:grid;grid-template-columns:1fr;gap:6px;margin-top:8px;">
          ${SCALA.map(opt => {
            const selezionato = valoreAttuale === opt.value;
            const testoOpt = domanda.opzioni?.[String(opt.value)] ?? opt.desc;
            return `<button type="button" class="ppu-scala-btn" data-ind="${esc(domanda.id)}" data-val="${esc(String(opt.value))}"
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
          <div style="margin-top:6px;">
            <label style="font-size:0.76rem;color:#888;font-weight:700;display:block;margin-bottom:4px;">${esc(area.notaLabel)} <span style="font-weight:400;">(facoltativo)</span></label>
            <textarea id="ppu-nota-area" rows="2" placeholder="…" style="width:100%;border:1.5px solid #ddd;border-radius:10px;padding:9px 12px;font-family:'Nunito',sans-serif;font-size:0.85rem;resize:vertical;outline:none;">${esc(nota)}</textarea>
          </div>
        </div>`;
    }

    function renderChiusuraBody() {
      const problemi = validaCompletamento(scheda);
      const avvisoHtml = problemi.length ? `
        <div style="background:#fff3cd;border:1.5px solid #f0d090;border-radius:10px;padding:10px 12px;margin-bottom:14px;font-size:0.8rem;color:#8a6a1a;">
          <strong>Prima di completare:</strong>
          <ul style="margin:6px 0 0 18px;padding:0;">
            ${problemi.map(p => p.tipo === 'risposte'
              ? `<li><a href="#" class="ppu-vai-area" data-area="${p.areaIndex}" style="color:#8a6a1a;">${esc(p.msg)}</a></li>`
              : `<li>${esc(p.msg)}</li>`
            ).join('')}
          </ul>
        </div>` : '';
      return `
        <div style="padding:0 14px 90px;">
          ${avvisoHtml}
          <div class="section-title muted" style="padding-left:0;">PER CONCLUDERE</div>
          <p style="font-size:0.78rem;color:#888;margin:2px 0 12px;">Risposte libere, non trasformate in punteggio.</p>
          ${DOMANDE_CHIUSURA.map(q => `
            <div style="margin-bottom:14px;">
              <label style="font-size:0.85rem;font-weight:700;color:#333;display:block;margin-bottom:5px;">${esc(q.testo)}</label>
              <textarea id="ppu-chiusura-${esc(q.id)}" rows="2" placeholder="…"
                style="width:100%;border:1.5px solid #ddd;border-radius:10px;padding:9px 12px;font-family:'Nunito',sans-serif;font-size:0.85rem;resize:vertical;outline:none;">${esc(scheda.closing?.[q.id] || '')}</textarea>
            </div>`).join('')}
        </div>`;
    }

    function renderFooter() {
      const isUltimoPasso = passo === AREE_PPU.length;
      return `
        <div style="position:fixed;bottom:62px;left:0;right:0;background:#fff;border-top:1px solid #e5e5e5;padding:10px 14px;display:flex;gap:8px;z-index:90;">
          <button class="btn-ghost" id="ppu-indietro" ${passo===0?'disabled style="opacity:0.4;"':''}>← Indietro</button>
          <div style="flex:1;"></div>
          ${!canWrite ? '' : isUltimoPasso
            ? `<button class="btn-ghost" id="ppu-salva-bozza">💾 Salva bozza</button><button class="btn-orange" id="ppu-completa">✅ Completa scheda</button>`
            : `<button class="btn-orange" id="ppu-avanti">Avanti →</button>`}
        </div>`;
    }

    function render() {
      const areaCorrente = passo < AREE_PPU.length ? AREE_PPU[passo] : null;
      main.innerHTML = renderHeader() + (areaCorrente ? renderAreaBody(areaCorrente) : renderChiusuraBody()) + renderFooter();
      wire(areaCorrente);
    }

    function cambiaPasso(nuovo) {
      flush(); // non blocca la navigazione, ma avvia subito il salvataggio
      passo = nuovo;
      segna('passoCorrente', passo, () => { scheda.passoCorrente = passo; });
      render();
    }

    function wire(areaCorrente) {
      if (canWrite) {
        document.getElementById('ppu-momento')?.addEventListener('change', e => {
          const val = e.target.value || null;
          segna('ppuMoment', val, () => { scheda.ppuMoment = val; });
          render(); // per mostrare/nascondere il campo "descrizione" di 'altro'
        });
        document.getElementById('ppu-momento-nota')?.addEventListener('input', e => {
          segna('ppuMomentNote', e.target.value, () => { scheda.ppuMomentNote = e.target.value; });
        });
        document.getElementById('ppu-conduttore')?.addEventListener('change', e => {
          const val = e.target.value || null;
          segna('conductedBy', val, () => { scheda.conductedBy = val; });
        });

        main.querySelectorAll('.ppu-scala-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const ind = btn.dataset.ind;
            const raw = btn.dataset.val;
            const val = raw === 'NO' ? 'NO' : Number(raw);
            segna(`risposte.${ind}`, val, () => { scheda.risposte = { ...(scheda.risposte||{}), [ind]: val }; });
            render();
          });
        });
        const notaEl = document.getElementById('ppu-nota-area');
        if (notaEl && areaCorrente) {
          notaEl.addEventListener('input', () => {
            segna(`areaNotes.${areaCorrente.id}`, notaEl.value, () => {
              scheda.areaNotes = { ...(scheda.areaNotes||{}), [areaCorrente.id]: notaEl.value };
            });
          });
        }
        DOMANDE_CHIUSURA.forEach(q => {
          const el = document.getElementById(`ppu-chiusura-${q.id}`);
          if (!el) return;
          el.addEventListener('input', () => {
            segna(`closing.${q.id}`, el.value, () => {
              scheda.closing = { ...(scheda.closing||{}), [q.id]: el.value };
            });
          });
        });
        main.querySelectorAll('.ppu-vai-area').forEach(a => {
          a.addEventListener('click', e => {
            e.preventDefault();
            cambiaPasso(parseInt(a.dataset.area, 10));
          });
        });
      }

      document.getElementById('ppu-indietro')?.addEventListener('click', () => {
        if (passo === 0) return;
        cambiaPasso(passo - 1);
      });
      document.getElementById('ppu-avanti')?.addEventListener('click', () => cambiaPasso(passo + 1));
      document.getElementById('ppu-salva-bozza')?.addEventListener('click', async () => {
        await flush();
        // Riusa lo stesso meccanismo di "indietro" della pagina (pop dello
        // stack di navigazione di documenti.html), non la history del browser.
        document.getElementById('btn-back')?.click();
      });
      document.getElementById('ppu-completa')?.addEventListener('click', async () => {
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
