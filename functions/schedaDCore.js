/**
 * functions/schedaDCore.js — nucleo PURO (nessun require di firebase-*, nessun
 * DOM) del motore server-side della Scheda D PPU "Sintesi educativa integrata".
 *
 * Perché un modulo a parte, e non un import di js/ppu-scheda-d-model.js:
 *  - Firebase Functions impacchetta e deploya SOLO la cartella functions/: un
 *    require('../js/ppu-scheda-d-model.js') non sarebbe presente a runtime.
 *  - js/ppu-scheda-d-model.js è ESM (export …), functions/ è CommonJS.
 *  - servono anche le mappe dei TESTI delle opzioni di risposta A/B, che vivono
 *    in js/ppu-scheda-a.js e js/ppu-scheda-b.js (moduli ESM che a loro volta
 *    importano da https://… — non importabili in Node) e che NON possono essere
 *    modificati in questo intervento.
 * Di conseguenza le costanti e le funzioni pure necessarie sono REPLICATE qui,
 * mantenendo identici nomi e semantica. La verità concettuale resta
 * js/ppu-scheda-d-model.js. Un test di allineamento (functions/test/…) confronta
 * questa replica con i sorgenti browser-side per intercettare eventuali drift.
 *
 * Errori: tutte le funzioni orchestranti lanciano `AppError(code, message)` con
 * `code` già uguale a un codice callable valido (unauthenticated, permission-
 * denied, invalid-argument, failed-precondition, unavailable, aborted, internal).
 * functions/schedaD.js si limita a mappare AppError → HttpsError.
 */

'use strict';

const crypto = require('crypto');

// ── Errore applicativo (mappato 1:1 su HttpsError da schedaD.js) ────────
class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

// ── Identità admin (identica a firestore.rules / documenti.html) ───────
const ADMIN_UID = 'mCSgNMVEphVIIf4HX0bkcKq2ZKv2';

// ── I sei pilastri PPU (id = aree di Scheda A/B), ordine canonico ──────
const PILASTRI = [
  { id: 'self', ordine: 1, nome: 'Io con me stesso' },
  { id: 'others', ordine: 2, nome: 'Io e gli altri' },
  { id: 'environment', ordine: 3, nome: 'Io e l\u2019ambiente' },
  { id: 'future', ordine: 4, nome: 'Io e il futuro' },
  { id: 'expression', ordine: 5, nome: 'Espressione e creativit\u00e0' },
  { id: 'wellbeing', ordine: 6, nome: 'Benessere e cura' },
];
const PILASTRI_ID = PILASTRI.map((p) => p.id);

// ── Costrutto osservato da ciascun indicatore (da js/ppu-scheda-a.js) ──
const COSTRUTTI = {
  self_01: 'riconoscere le proprie emozioni forti e comunicarle',
  self_02: 'gestire la propria reazione a rabbia, delusione o provocazione',
  self_03: 'chiedere aiuto quando si \u00e8 in difficolt\u00e0',
  others_01: 'entrare in relazione e stare con coetanei e adulti',
  others_02: 'collaborare a un compito comune',
  others_03: 'affrontare un conflitto senza rompere la relazione',
  environment_01: 'rispetto e cura delle proprie cose e degli spazi e oggetti comuni',
  environment_02: 'portare a termine un incarico affidato',
  environment_03: 'prendersi cura di qualcosa che non riguarda soltanto s\u00e9, anche senza un ordine',
  future_01: 'immaginare qualcosa che si vorrebbe fare, raggiungere o diventare',
  future_02: 'decidere tenendo conto di cosa potrebbe succedere dopo',
  future_03: 'portare avanti nel tempo un impegno preso',
  expression_01: 'riconoscere cosa piace, cosa interessa e in cosa ci si sente capaci',
  expression_02: 'trovare un modo per esprimere ci\u00f2 che si pensa, si prova o interessa',
  expression_03: 'provare attivit\u00e0 o esperienze nuove anche senza sapere se si sar\u00e0 capaci',
  wellbeing_01: 'prendersi cura di s\u00e9 e delle proprie necessit\u00e0 quotidiane',
  wellbeing_02: 'accorgersi di quando si \u00e8 stanchi, stressati o non si sta bene',
  wellbeing_03: 'quando non si sta bene, fare qualcosa che aiuta o rivolgersi a qualcuno',
};
const AB_INDICATORS = Object.keys(COSTRUTTI); // 18

// ── Domande aperte di chiusura della Scheda A (risposte del ragazzo) ───
const CLOSING_IDS = ['perceivedStrength', 'desiredImprovement', 'chosenGrowthArea'];
const DOMANDE_CHIUSURA = {
  perceivedStrength: 'Quale di queste cose pensi di saper fare meglio?',
  desiredImprovement: 'Quale vorresti riuscire a fare meglio?',
  chosenGrowthArea: 'Su quale ti piacerebbe lavorare insieme agli educatori?',
};

// ── Testi delle opzioni di risposta — Scheda A (da js/ppu-scheda-a.js) ─
// Chiave: 'NO' | '1' | '2' | '3'.  'NO' = assenza di collocazione, NON 0.
const OPZIONI_A = {
  self_01: { NO: 'Su questo non so ancora bene come funziono.', 1: 'Faccio fatica a capire io cosa provo, e taglio corto con un "niente".', 2: 'Capisco cosa sento, ma lo dico solo a poche persone.', 3: 'Capisco cosa provo e, se voglio, riesco a spiegarlo.' },
  self_02: { NO: 'Cambia troppo a seconda di chi ho davanti: non saprei.', 1: 'Faccio fatica a fermarmi: rispondo o reagisco d\u2019istinto.', 2: 'A volte lascio perdere, a volte ci casco e poi me ne pento.', 3: 'Anche quando sono furioso/a, in genere decido io come reagire.' },
  self_03: { NO: 'Non saprei: dipende da quanto \u00e8 grosso il problema.', 1: 'Tengo tutto per me, anche quando sono davvero in difficolt\u00e0.', 2: 'Chiedo aiuto solo quando la cosa \u00e8 gi\u00e0 diventata grande.', 3: 'Se da solo/a non ci arrivo, di solito chiedo aiuto per tempo.' },
  others_01: { NO: 'In un gruppo nuovo con me cambia ogni volta: non saprei.', 1: 'Resto in disparte: fare il primo passo mi mette a disagio.', 2: 'Con qualcuno riesco a parlare, con altri o con gli adulti faccio fatica.', 3: 'Riesco a inserirmi, sia con i ragazzi sia con gli adulti.' },
  others_02: { NO: 'In squadra con me cambia da volta a volta: non saprei.', 1: 'O prendo in mano tutto io, o mollo e lascio fare agli altri.', 2: 'Collaboro, ma quando gli altri sbagliano mi innervosisco.', 3: 'Faccio la mia parte e provo a tenere insieme la squadra.' },
  others_03: { NO: 'Con chi ho litigato conta parecchio: non saprei dire.', 1: 'Di solito il rapporto si rompe, o resta il gelo a lungo.', 2: 'Prima o poi ci riparliamo, ma di solito fa il primo passo l\u2019altro/a.', 3: 'Quasi sempre cerco il chiarimento e rimetto a posto le cose.' },
  environment_01: { NO: 'Non ci ho mai fatto davvero caso.', 1: 'La lascio com\u2019\u00e8 e vado, anche se non \u00e8 in ordine.', 2: 'La sistemo, ma di solito solo se qualcuno me lo fa notare.', 3: 'Lascio in ordine anche quando nessuno mi guarda.' },
  environment_02: { NO: 'Non saprei: dipende da che compito \u00e8.', 1: 'Parto, ma spesso lo lascio a met\u00e0 o me ne dimentico.', 2: 'Lo finisco, ma se qualcuno mi segue o me lo ricorda.', 3: 'Se prendo un incarico, di norma lo finisco da solo/a.' },
  environment_03: { NO: 'Su questo non saprei cosa farei.', 1: 'Lascio stare: se non l\u2019ho sporcato io, non tocca a me.', 2: 'Se qualcuno inizia a raccogliere do una mano, da solo/a no.', 3: 'Lo raccolgo lo stesso: \u00e8 un posto di tutti.' },
  future_01: { NO: 'Sul mio futuro non so ancora bene cosa penso.', 1: 'Preferisco non pensarci: non mi viene in mente niente.', 2: 'Ho qualche desiderio, ma vago, e non so se sia possibile.', 3: 'Ho un\u2019idea abbastanza chiara, anche se pu\u00f2 cambiare.' },
  future_02: { NO: 'Non saprei: dipende da cosa c\u2019\u00e8 da scegliere.', 1: 'Decido sul momento, per quello che mi va adesso.', 2: 'Ci penso, ma spesso quando ho gi\u00e0 deciso.', 3: 'Prima peso cosa succede dopo, poi scelgo.' },
  future_03: { NO: 'Non saprei: dipende da quanto ci tengo.', 1: 'Mollo appena passa la voglia iniziale.', 2: 'Vado avanti a tratti: quando si fa dura rischio di lasciare.', 3: 'Vado avanti anche quando \u00e8 faticoso, magari cambiando metodo.' },
  expression_01: { NO: 'Su questo non so ancora bene come sono fatto/a.', 1: 'Faccio fatica: non so cosa mi piace n\u00e9 in cosa sono capace.', 2: 'Qualcosa che mi piace so dirlo, ma non con sicurezza.', 3: 'So abbastanza bene cosa mi interessa e cosa mi riesce.' },
  expression_02: { NO: 'Non saprei: dipende da cosa ho da dire.', 1: 'Faccio molta fatica a farlo uscire: di solito resta dentro.', 2: 'Ci riesco, ma solo con certe persone o in certi momenti.', 3: 'Trovo un modo mio per dirlo, a parole o in altro modo.' },
  expression_03: { NO: 'Davanti a una cosa nuova non saprei cosa farei.', 1: 'Se rischio la figuraccia, preferisco non provare.', 2: 'Provo pi\u00f9 facilmente se qualcuno \u00e8 con me o mi sento sicuro/a.', 3: 'La curiosit\u00e0 di solito vince sulla paura: provo.' },
  wellbeing_01: { NO: 'Cambia da periodo a periodo: non saprei.', 1: 'Faccio fatica: dormo poco col telefono, salto i pasti.', 2: 'Me ne occupo, ma di solito se qualcuno me lo ricorda.', 3: 'Mi gestisco da solo/a con sonno, pasti e cura di me.' },
  wellbeing_02: { NO: 'Non saprei dire se di solito me ne accorgo.', 1: 'Me ne accorgo solo quando esplodo o crollo.', 2: 'Me ne accorgo, ma quando il malessere \u00e8 gi\u00e0 forte.', 3: 'Capisco abbastanza presto quando sono sotto stress.' },
  wellbeing_03: { NO: 'Nei momenti no non saprei cosa faccio.', 1: 'Di solito resto l\u00ec fermo/a, senza fare n\u00e9 dire niente.', 2: 'Ogni tanto reagisco o ne parlo, ma se qualcuno se ne accorge prima.', 3: 'Faccio qualcosa che mi tira su, o ne parlo con chi mi fido.' },
};

// ── Testi delle opzioni di risposta — Scheda B (da js/ppu-scheda-b.js) ─
// Stessa scala 'NO'|'1'|'2'|'3'. B = "come il ragazzo pensa di essere visto".
const OPZIONI_B = {
  self_01: { NO: 'Non saprei: quando sto cos\u00ec con me cambia troppo.', 1: '"Quando stai male non riesci a dire cosa hai, nemmeno a te stesso/a."', 2: '"Capisci cosa provi, ma lo dici solo a chi ti fidi davvero."', 3: '"Di solito capisci cosa senti e, se vuoi, lo dici."' },
  self_02: { NO: 'Con me dipende da chi c\u2019\u00e8: non saprei dire.', 1: '"Se ti provocano davanti agli altri, parti subito."', 2: '"A volte lasci correre, a volte ci caschi e poi te ne penti."', 3: '"Anche quando sei furioso/a, quasi sempre decidi tu come rispondere."' },
  self_03: { NO: 'Non saprei: dipende da quanto \u00e8 grosso il problema.', 1: '"Anche quando sei in difficolt\u00e0 tieni tutto per te, non chiedi aiuto."', 2: '"Chiedi aiuto solo all\u2019ultimo, o solo a una persona di cui ti fidi."', 3: '"Quando serve, chiedi aiuto senza aspettare troppo."' },
  others_01: { NO: 'In un gruppo nuovo con me cambia ogni volta: non saprei.', 1: '"In un posto nuovo resti per conto tuo, fai fatica ad avvicinarti."', 2: '"Con qualcuno leghi subito, con altri o con gli adulti fai pi\u00f9 fatica."', 3: '"Di solito ti inserisci e parli con tutti, ragazzi e adulti."' },
  others_02: { NO: 'Nei gruppi con me cambia parecchio: non saprei.', 1: '"Nei giochi di squadra o fai tutto tu o ti sfili."', 2: '"Collabori, ma quando gli altri sbagliano ti innervosisci."', 3: '"Fai la tua parte e cerchi di tenere insieme la squadra."' },
  others_03: { NO: 'Dipende da con chi ho litigato: non saprei cosa direbbero.', 1: '"Quando litighi forte, quel rapporto spesso si chiude."', 2: '"Alla fine chiarisci, ma di solito muove prima l\u2019altro/a."', 3: '"Litighi, ma poi chiarisci senza rompere il rapporto."' },
  environment_01: { NO: 'Non \u00e8 una cosa su cui mi guardano di solito: non saprei.', 1: '"Lasci le cose come capita, non ci fai caso."', 2: '"Le sistemi, ma soprattutto se qualcuno te lo dice."', 3: '"Hai cura degli spazi comuni anche quando nessuno controlla."' },
  environment_02: { NO: 'Con me dipende dal compito: non saprei dire.', 1: '"Se ti affidano una cosa, spesso la lasci a met\u00e0."', 2: '"La finisci, ma vai seguito/a o te lo devono ricordare."', 3: '"Se prendi un impegno, di solito lo porti fino in fondo."' },
  environment_03: { NO: 'Non ci ho mai fatto caso davvero: non so cosa direbbero.', 1: '"Se non l\u2019hai sporcato tu, lasci stare."', 2: '"Dai una mano se qualcuno comincia, da solo/a di rado."', 3: '"Ci pensi lo stesso, anche se non tocca a te."' },
  future_01: { NO: 'Del mio futuro non saprei cosa direbbero.', 1: '"Del futuro preferisci non parlarne, non sai cosa vuoi."', 2: '"Qualche idea ce l\u2019hai, ma \u00e8 ancora tutto vago."', 3: '"Hai un\u2019idea abbastanza precisa di dove vuoi arrivare."' },
  future_02: { NO: 'Dipende da cosa c\u2019\u00e8 da scegliere: non saprei.', 1: '"Decidi sul momento, non pensi a cosa viene dopo."', 2: '"Ci pensi, ma di solito quando hai gi\u00e0 deciso."', 3: '"Prima pesi cosa succede dopo, poi scegli."' },
  future_03: { NO: 'Non saprei: dipende da quanto ci tengo alla cosa.', 1: '"Quando passa l\u2019entusiasmo iniziale, di solito molli."', 2: '"Vai a fasi: quando si fa dura rischi di lasciare."', 3: '"Anche quando \u00e8 faticoso, di solito arrivi in fondo."' },
  expression_01: { NO: 'Forse non lo saprebbero bene neanche loro: non saprei.', 1: '"Fai fatica a dire cosa ti piace o in cosa sei bravo/a."', 2: '"Qualcosa sai dirlo, ma solo per alcune cose."', 3: '"Sai bene cosa ti interessa e cosa ti riesce."' },
  expression_02: { NO: '\u00c8 una cosa che vedono poco di me: non saprei.', 1: '"Quello che hai dentro resta l\u00ec, fai fatica a dirlo."', 2: '"Ti esprimi, ma solo con alcune persone o in certi momenti."', 3: '"Hai modi tuoi per dire quello che pensi e senti."' },
  expression_03: { NO: 'Davanti a una cosa nuova non saprei cosa si aspettano da me.', 1: '"Se pensi di poter fare brutta figura, di solito non provi."', 2: '"Provi, soprattutto se ti senti sostenuto/a o abbastanza sicuro/a."', 3: '"Anche se non sai come andr\u00e0, di solito parti e provi."' },
  wellbeing_01: { NO: 'Forse non lo sanno bene neanche loro: non saprei.', 1: '"Non ti regoli: dormi poco, salti i pasti, telefono fino a tardi."', 2: '"Ti prendi cura di te, ma vai ricordato/a."', 3: '"Di solito ti gestisci da solo/a con sonno, pasti e cura di te."' },
  wellbeing_02: { NO: 'Non saprei se se ne accorgerebbero.', 1: '"Non ti accorgi di stare male finch\u00e9 non esplodi o crolli."', 2: '"Te ne accorgi, ma quando sei gi\u00e0 messo/a male."', 3: '"Di solito capisci presto quando sei stanco/a o sotto stress."' },
  wellbeing_03: { NO: 'Nei momenti no con me cambia: non saprei cosa direbbero.', 1: '"Quando stai male resti l\u00ec, non fai niente e non ne parli."', 2: '"A volte reagisci o ne parli, ma se qualcuno se ne accorge prima."', 3: '"Di solito fai qualcosa che ti aiuta o ne parli con qualcuno."' },
};

// ── Momenti del percorso PPU ──────────────────────────────────────────
const MOMENTI_PPU = [
  { value: 'ingresso', label: 'Ingresso' },
  { value: 'verifica_3_mesi', label: 'Verifica 3 mesi' },
  { value: 'verifica_6_mesi', label: 'Verifica 6 mesi' },
  { value: 'verifica_intermedia', label: 'Verifica intermedia' },
  { value: 'uscita', label: 'Uscita' },
  { value: 'altro', label: 'Altro' },
];
const MOMENTI_VALIDI = MOMENTI_PPU.map((m) => m.value);

// ── Etichette leggibili delle tre schede fonte ───────────────────────
const LABEL_SCHEDE = {
  A: 'Scheda A \u2014 Come mi vedo',
  B: 'Scheda B \u2014 Come penso che mi vedano gli altri',
  C: 'Scheda C \u2014 Le persone intorno a me',
};

// ── Traduzioni leggibili dei codici tecnici della Scheda C ───────────
const LEGGIBILE_DIREZIONE = {
  forward: 'unidirezionale, dalla prima persona verso la seconda',
  backward: 'unidirezionale, dalla seconda persona verso la prima',
  both: 'reciproca',
};
const LEGGIBILE_QUALITA = {
  green: 'positivo',
  yellow: 'altalenante o incerto',
  red: 'difficile o conflittuale',
  grey: 'neutro o poco definito',
};

// ── Costanti di versionamento e testo fisso ──────────────────────────
// Storia del contratto generativo:
//   v1 — prima versione (solo sintesi A/B/C).
//   v2 — introduzione di `contenutoAI.chiaviPsicoPedagogiche`.
//   v3 — (Passo 6C · FASE 6) blocco epistemico sui dati insufficienti +
//        concisione + retry max_tokens-aware.
//   v4 — (Passo 6C · FASE 7) contratto delle fonti reso inequivocabile:
//        `pilastro` sempre uno dei sei canonici, dominio esplicito FONTI
//        CITABILI passato al modello e verificato server-side, retry sulle
//        fonti più preciso, ulteriore concisione (regola "una informazione,
//        una sola volta"). Schema di `contenutoAI` INVARIATO.
// La LETTURA resta compatibile con v1, v2, v3 e v4 (nessun ramo dipende dal
// numero); nessuna migrazione dei vecchi documenti. Le NUOVE generazioni
// salvano promptVersion: 4.
const PROMPT_VERSION = 4;

// Passo 6 — chiavi psico-pedagogiche: array 0..MAX_CHIAVI_PP.
// Passo 6C: max 4 → 3 (evita output enciclopedici e riempitivi).
const MAX_CHIAVI_PP = 3;
const AMBITI_CHIAVE = ['pilastro', 'trasversale'];
// Passo 6C — tetti d'array per le chiavi (min, max). La lunghezza in prosa dei
// singoli campi è invece guidata dal SYSTEM_PROMPT, non da validatori fragili.
const LIMITI_ARRAY_CHIAVE = {
  lettureAlternative: [0, 2],
  elementiDaOsservare: [1, 3],
  domandeEquipe: [1, 3],
};
const NOTA_METODOLOGICA =
  'Questa sintesi \u00e8 generata attraverso l\u2019elaborazione delle risposte contenute ' +
  'nelle Schede A, B e C. Non costituisce una valutazione diagnostica n\u00e9 sostituisce ' +
  'l\u2019osservazione professionale. Le ipotesi formulate devono essere confrontate con ' +
  'la storia educativa del ragazzo, con l\u2019osservazione dell\u2019\u00e9quipe e con il dialogo ' +
  'con il ragazzo stesso.';

const LOCK_TTL_MS = 3 * 60 * 1000;

// ── Timestamp → millisecondi ─────────────────────────────────────────
function tsMillis(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v instanceof Date) { const t = v.getTime(); return isNaN(t) ? null : t; }
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
  if (typeof v === 'object') {
    if (typeof v.toMillis === 'function') { try { const t = v.toMillis(); if (typeof t === 'number') return t; } catch (_) { /* noop */ } }
    if (typeof v.toDate === 'function') { try { const d = v.toDate(); if (d instanceof Date) return d.getTime(); } catch (_) { /* noop */ } }
    const secs = typeof v.seconds === 'number' ? v.seconds : typeof v._seconds === 'number' ? v._seconds : null;
    if (secs != null) {
      const ns = typeof v.nanoseconds === 'number' ? v.nanoseconds : typeof v._nanoseconds === 'number' ? v._nanoseconds : 0;
      return secs * 1000 + Math.floor(ns / 1e6);
    }
  }
  return null;
}

function tsRecenza(scheda) {
  return (
    tsMillis(scheda && scheda.completedAt) ??
    tsMillis(scheda && scheda.updatedAt) ??
    tsMillis(scheda && scheda.assessmentDate) ??
    tsMillis(scheda && scheda.createdAt) ??
    0
  );
}

function piuRecenteCompletata(schede) {
  const done = (Array.isArray(schede) ? schede : []).filter((s) => s && s.status === 'completata');
  if (!done.length) return null;
  return done.slice().sort((x, y) => tsRecenza(y) - tsRecenza(x))[0];
}

// ── Momento: chiave (gestione speciale di 'altro') ──────────────────
function chiaveMomento(ppuMoment, ppuMomentNote) {
  const m = ppuMoment ? String(ppuMoment) : '';
  if (!m) return null;
  if (m === 'altro') return 'altro:' + String(ppuMomentNote == null ? '' : ppuMomentNote).trim();
  return m;
}
function chiaveMomentoDoc(scheda) {
  return chiaveMomento(scheda && scheda.ppuMoment, scheda && scheda.ppuMomentNote);
}
function labelMomento(value) {
  const m = MOMENTI_PPU.find((x) => x.value === value);
  return m ? m.label : value ? String(value) : '';
}
function descriviMomento(ppuMoment, ppuMomentNote) {
  if (ppuMoment === 'altro') return String(ppuMomentNote == null ? '' : ppuMomentNote).trim() || 'Altro';
  return labelMomento(ppuMoment);
}

function pilastroDiIndicatore(indicatorId) {
  const mm = String(indicatorId || '').match(/^([a-z]+)_\d{2}$/);
  return mm && PILASTRI_ID.includes(mm[1]) ? mm[1] : null;
}
function elencaIndicatoriPilastro(pilastroId) {
  return AB_INDICATORS.filter((id) => pilastroDiIndicatore(id) === pilastroId);
}

// ── Selezione AUTOREVOLE della terna A+B+C ──────────────────────────
// Filtra per stato 'completata' + stesso momento (per 'altro' anche la nota),
// poi sceglie la compilazione più recente di ciascun tipo. Nessun fallback.
function selezionaTerna({ schedeA = [], schedeB = [], schedeC = [], ppuMoment, ppuMomentNote = '' }) {
  const key = chiaveMomento(ppuMoment, ppuMomentNote);
  const pick = (list) =>
    piuRecenteCompletata(
      (Array.isArray(list) ? list : []).filter(
        (s) => s && s.status === 'completata' && chiaveMomentoDoc(s) === key,
      ),
    );
  const a = pick(schedeA);
  const b = pick(schedeB);
  const c = pick(schedeC);
  const mancanti = [];
  if (!a) mancanti.push('A');
  if (!b) mancanti.push('B');
  if (!c) mancanti.push('C');
  return { a, b, c, mancanti, chiave: key };
}

function descriviMancanti(ppuMoment, ppuMomentNote, mancanti) {
  const label = descriviMomento(ppuMoment, ppuMomentNote);
  const nomi = (mancanti || []).map((k) => LABEL_SCHEDE[k] || k);
  if (nomi.length === 1) return `Per il momento \u00ab${label}\u00bb manca la ${nomi[0]}.`;
  return `Per il momento \u00ab${label}\u00bb mancano: ${nomi.join('; ')}.`;
}

// ── Snapshot "congelato" delle fonti usate ─────────────────────────
function riepilogoFonti(a, b, c) {
  const uno = (s) => {
    if (!s) return null;
    const out = {
      schedaId: s.id || null,
      completedAt: s.completedAt != null ? s.completedAt : null,
      assessmentDate: s.assessmentDate != null ? s.assessmentDate : null,
    };
    if (s.instrumentVersion != null) out.instrumentVersion = s.instrumentVersion;
    return out;
  };
  return { a: uno(a), b: uno(b), c: uno(c) };
}

// ── Chiave del lock anti-doppia-generazione ────────────────────────
function lockKey(minorId, comunitaId, ppuMoment, ppuMomentNote) {
  return crypto
    .createHash('sha256')
    .update(`${minorId}|${comunitaId}|${chiaveMomento(ppuMoment, ppuMomentNote)}`)
    .digest('hex');
}

// ── Costruzione del payload minimizzato per il modello ─────────────
function clamp01(v) {
  v = Number(v);
  if (!isFinite(v)) return 0.5;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function normalizzaDistanza(n) {
  if (n && typeof n.distance === 'number' && isFinite(n.distance)) {
    return Math.round(Math.min(1, Math.max(0, n.distance)) * 1000) / 1000;
  }
  const x = clamp01(n && n.x);
  const y = clamp01(n && n.y);
  const d = Math.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2) / 0.5;
  return Math.round(Math.min(1, Math.max(0, d)) * 1000) / 1000;
}

function rispostaIndicatore(v, opz) {
  if (v === undefined || v === null) return { valore: null, testoRisposta: null };
  if (v === 'NO') return { valore: 'NO', testoRisposta: opz ? opz.NO : null };
  const n = Number(v);
  return { valore: n, testoRisposta: opz ? (opz[String(n)] != null ? opz[String(n)] : null) : null };
}

// Rete relazionale della Scheda C: SOLO elementi strutturati espressi dal
// ragazzo (persone, distanza dal centro, direzione e qualità dei legami).
// Le note dei nodi e la `note` generale NON vengono incluse: il modello dati
// attuale non permette di attribuirle con certezza al ragazzo (sezione 9).
function costruisciRete(c) {
  const socios = (c && c.sociogrammi) || {};
  const out = {};
  for (const key of ['vicinanza', 'fatica']) {
    const raw = socios[key] || {};
    const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
    const edges = Array.isArray(raw.edges) ? raw.edges : [];
    const nomePerId = new Map();
    const persone = [];
    for (const n of nodes) {
      if (!n || !n.id) continue;
      const isCenter = n.id === 'io' || n.isCenter === true;
      const nome = isCenter
        ? 'IO'
        : typeof n.name === 'string' && n.name.trim()
        ? n.name.trim()
        : '(persona senza nome)';
      nomePerId.set(String(n.id), nome);
      if (isCenter) continue;
      persone.push({
        ref: `C:${key}:persona:${n.id}`,
        nome,
        distanzaDalCentro: normalizzaDistanza(n),
      });
    }
    const legami = [];
    for (const e of edges) {
      if (!e || !e.id) continue;
      const s = String(e.source);
      const t = String(e.target);
      if (!nomePerId.has(s) || !nomePerId.has(t)) continue;
      legami.push({
        ref: `C:${key}:legame:${e.id}`,
        da: nomePerId.get(s),
        a: nomePerId.get(t),
        daRef: `C:${key}:persona:${s}`,
        aRef: `C:${key}:persona:${t}`,
        direzione: LEGGIBILE_DIREZIONE[e.direction] || 'non specificata',
        qualita: LEGGIBILE_QUALITA[e.quality] || 'non specificata',
      });
    }
    out[key] = {
      significatoDistanza:
        key === 'vicinanza'
          ? 'valore 0..1; pi\u00f9 vicino a 0 = persona sentita pi\u00f9 vicina dal ragazzo'
          : 'valore 0..1; pi\u00f9 vicino a 0 = difficolt\u00e0 o conflitto pi\u00f9 intenso per il ragazzo',
      persone,
      legami,
    };
  }
  return out;
}

function costruisciPayload({ a, b, c, ppuMoment, ppuMomentNote }) {
  const indicatori = [];
  for (const pid of PILASTRI_ID) {
    for (const id of elencaIndicatoriPilastro(pid)) {
      indicatori.push({
        indicatorId: id,
        pilastro: pid,
        costrutto: COSTRUTTI[id],
        riferimenti: { a: `A:${id}`, b: `B:${id}` },
        a: rispostaIndicatore(a && a.risposte ? a.risposte[id] : undefined, OPZIONI_A[id]),
        b: rispostaIndicatore(b && b.risposte ? b.risposte[id] : undefined, OPZIONI_B[id]),
      });
    }
  }
  const chiusuraSchedaA = [];
  for (const cid of CLOSING_IDS) {
    const val = a && a.closing ? a.closing[cid] : undefined;
    if (typeof val === 'string' && val.trim()) {
      chiusuraSchedaA.push({ ref: `A:${cid}`, domanda: DOMANDE_CHIUSURA[cid], risposta: val.trim() });
    }
  }
  return {
    soggetto: 'il ragazzo',
    momentoPPU: descriviMomento(ppuMoment, ppuMomentNote),
    scala: {
      descrizione:
        'Scala di Scheda A e B: NO, 1, 2, 3. "NO" significa che il ragazzo non sa collocarsi ' +
        'su quell\u2019aspetto: NON \u00e8 uno zero e NON \u00e8 un esito negativo. 1 = pi\u00f9 bisogno di ' +
        'accompagnamento; 2 = situazione intermedia; 3 = maggiore autonomia.',
    },
    indicatori,
    chiusuraSchedaA,
    reteSchedaC: costruisciRete(c),
  };
}

// ── Riferimenti di fonte realmente citabili (dal payload) ──────────
function estraiFontiCitabili(payload) {
  const ab = new Set((payload.indicatori || []).map((i) => i.indicatorId));
  const closingA = new Set(
    (payload.chiusuraSchedaA || []).map((x) => String(x.ref).replace(/^A:/, '')),
  );
  const cSets = {
    'vicinanza:persona': new Set(),
    'vicinanza:legame': new Set(),
    'fatica:persona': new Set(),
    'fatica:legame': new Set(),
  };
  const rete = payload.reteSchedaC || {};
  for (const key of ['vicinanza', 'fatica']) {
    const blk = rete[key] || {};
    for (const p of blk.persone || []) {
      const mm = String(p.ref).match(/^C:(vicinanza|fatica):persona:(.+)$/);
      if (mm) cSets[`${mm[1]}:persona`].add(mm[2]);
    }
    for (const l of blk.legami || []) {
      const mm = String(l.ref).match(/^C:(vicinanza|fatica):legame:(.+)$/);
      if (mm) cSets[`${mm[1]}:legame`].add(mm[2]);
    }
  }
  return { ab, closingA, c: cSets };
}

// ═══════════════════════════════════════════════════════════════════
//  PASSO 6C · FASE 7 — Contratto delle fonti
//
//  `costruisciFontiCitabili` deriva dal PAYLOAD (nessuna nuova informazione:
//  solo gli identificatori già presenti) il DOMINIO ESATTO delle fonti
//  citabili. Serve sia a rendere inequivocabile al modello quali triplette
//  { scheda, pilastro, elementoId } sono ammesse (elencoFontiCitabiliTesto),
//  sia alla validazione server-side (verificaFontiSemantica): una tripletta è
//  ammessa solo se appartiene a questo insieme. Nessuna patch specifica per
//  singoli elementoId (es. domande di chiusura): la regola è generale —
//  `pilastro` ∈ PILASTRI_ID (i sei canonici), sempre.
//
//  Ritorna Map<elementoId, { schede:Set<'A'|'B'|'C'>, pilastri:Set<pilastro>,
//                            pilastriAll:boolean }>.
//  · indicatori 18: schede {A,B}, pilastro = quello canonico dell'id.
//  · domande di chiusura Scheda A: scheda {A}, pilastriAll (trasversali:
//    qualunque dei sei, coerentemente con il blocco in cui si scrive).
//  · elementi della rete C (persone/legami): scheda {C}, pilastriAll.
function costruisciFontiCitabili(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const map = new Map();
  const add = (id, scheda, pilastri) => {
    if (!id || typeof id !== 'string') return;
    let e = map.get(id);
    if (!e) { e = { schede: new Set(), pilastri: new Set(), pilastriAll: false }; map.set(id, e); }
    e.schede.add(scheda);
    if (pilastri === 'ALL') e.pilastriAll = true;
    else for (const pil of pilastri) e.pilastri.add(pil);
  };
  for (const it of (Array.isArray(p.indicatori) ? p.indicatori : [])) {
    if (it && typeof it.indicatorId === 'string' && typeof it.pilastro === 'string') {
      add(it.indicatorId, 'A', [it.pilastro]);
      add(it.indicatorId, 'B', [it.pilastro]);
    }
  }
  for (const ch of (Array.isArray(p.chiusuraSchedaA) ? p.chiusuraSchedaA : [])) {
    const m = String((ch && ch.ref) || '').match(/^A:(.+)$/);
    if (m) add(m[1], 'A', 'ALL');
  }
  const rete = p.reteSchedaC && typeof p.reteSchedaC === 'object' ? p.reteSchedaC : {};
  for (const k of ['vicinanza', 'fatica']) {
    const blk = rete[k] && typeof rete[k] === 'object' ? rete[k] : {};
    const elems = [
      ...(Array.isArray(blk.persone) ? blk.persone : []),
      ...(Array.isArray(blk.legami) ? blk.legami : []),
    ];
    for (const x of elems) {
      const m = String((x && x.ref) || '').match(/^C:(.+)$/);
      if (m) add(m[1], 'C', 'ALL');
    }
  }
  return map;
}

// Testo COMPATTO dell'elenco delle fonti citabili, da inserire nel messaggio
// utente. Contiene SOLO identificatori già nel payload + i nomi dei sei
// pilastri canonici (costante). Nessun testo di risposta, nessun nome, nessuna
// nota educatore, nessun dato personale.
function elencoFontiCitabiliTesto(payload) {
  const map = costruisciFontiCitabili(payload);
  const indPerPilastro = new Map(PILASTRI_ID.map((pil) => [pil, []]));
  const chiusure = [];
  const cElems = [];
  for (const [id, e] of map) {
    if (/^[a-z]+_\d{2}$/.test(id) && !e.pilastriAll) {
      const pil = [...e.pilastri][0];
      if (indPerPilastro.has(pil)) indPerPilastro.get(pil).push(id);
    } else if (e.schede.has('A') && e.pilastriAll && !id.includes(':')) {
      chiusure.push(id);
    } else {
      cElems.push(id);
    }
  }
  const righe = [
    `FONTI CITABILI — in "fonti" usa ESCLUSIVAMENTE questi identificatori; "pilastro" DEVE essere uno di: ${PILASTRI_ID.join(', ')}.`,
  ];
  for (const pil of PILASTRI_ID) {
    const ids = indPerPilastro.get(pil).slice().sort();
    if (ids.length) righe.push(`- Schede A/B, "pilastro": "${pil}" -> elementoId: ${ids.join(', ')}`);
  }
  if (chiusure.length) {
    righe.push(`- Scheda A, domande di chiusura (elementoId; "pilastro" = quello del blocco in cui scrivi): ${chiusure.slice().sort().join(', ')}`);
  }
  if (cElems.length) {
    righe.push(`- Scheda C, rete (elementoId; "pilastro" = quello del blocco): ${cElems.slice().sort().join(', ')}`);
  }
  return righe.join('\n');
}

// ── Validazione STRUTTURALE dell'output (allineata a
//    js/ppu-scheda-d-model.js::validaOutputAI). Ritorna un array di errori.
function isNonEmptyStr(v) {
  return typeof v === 'string' && v.trim().length > 0;
}
function validaListaFonti(fonti, path, minimo) {
  const e = [];
  if (!Array.isArray(fonti)) {
    e.push(`${path} deve essere un array.`);
    return e;
  }
  if (fonti.length < (minimo || 0)) e.push(`${path} deve contenere almeno ${minimo} riferimento/i alle fonti.`);
  fonti.forEach((rif, i) => {
    if (!rif || typeof rif !== 'object' || Array.isArray(rif)) {
      e.push(`${path}[${i}] non è un oggetto.`);
      return;
    }
    if (!['A', 'B', 'C'].includes(rif.scheda)) e.push(`${path}[${i}] scheda "${rif.scheda}" non è A/B/C.`);
    if (!PILASTRI_ID.includes(rif.pilastro)) e.push(`${path}[${i}] pilastro "${rif.pilastro}" non valido.`);
    if (typeof rif.elementoId !== 'string' || !rif.elementoId.trim())
      e.push(`${path}[${i}] elementoId mancante o vuoto.`);
  });
  return e;
}
// Passo 6 — validazione STRUTTURALE di `chiaviPsicoPedagogiche` (allineata a
// js/ppu-scheda-d-model.js). Non valida MAI la correttezza teorica o la
// pertinenza: solo forma, campi, enum, limiti e struttura delle fonti. Il campo
// è opzionale (assente = nessuna chiave / documento legacy).
function validaChiaviPsicoPedagogiche(json) {
  const e = [];
  if (!('chiaviPsicoPedagogiche' in json) || json.chiaviPsicoPedagogiche == null) return e;
  const arr = json.chiaviPsicoPedagogiche;
  if (!Array.isArray(arr)) {
    e.push('chiaviPsicoPedagogiche deve essere un array.');
    return e;
  }
  if (arr.length > MAX_CHIAVI_PP) {
    e.push(`chiaviPsicoPedagogiche: al massimo ${MAX_CHIAVI_PP} elementi (ricevuti ${arr.length}).`);
  }
  arr.forEach((k, i) => {
    const P = `chiaviPsicoPedagogiche[${i}]`;
    if (!k || typeof k !== 'object' || Array.isArray(k)) {
      e.push(`${P} non è un oggetto.`);
      return;
    }
    if (!AMBITI_CHIAVE.includes(k.ambito)) {
      e.push(`${P}.ambito "${k.ambito}" non valido (atteso "pilastro" o "trasversale").`);
    }
    if (k.ambito === 'pilastro') {
      if (!PILASTRI_ID.includes(k.pilastro)) {
        e.push(`${P}.pilastro "${k.pilastro}" non valido per ambito "pilastro".`);
      }
    } else if (k.ambito === 'trasversale') {
      if (k.pilastro != null && k.pilastro !== '') {
        e.push(`${P}.pilastro deve essere null per ambito "trasversale".`);
      }
    }
    for (const campo of ['configurazioneOsservata', 'questioneEducativa', 'pertinenzaNelCaso', 'limitiDellaLettura']) {
      if (!isNonEmptyStr(k[campo])) e.push(`${P}.${campo} mancante o vuoto.`);
    }
    const rt = k.riferimentoTeorico;
    if (!rt || typeof rt !== 'object' || Array.isArray(rt)) {
      e.push(`${P}.riferimentoTeorico mancante o non è un oggetto.`);
    } else {
      for (const campo of ['autore', 'teoria', 'concetto', 'spiegazione']) {
        if (!isNonEmptyStr(rt[campo])) e.push(`${P}.riferimentoTeorico.${campo} mancante o vuoto.`);
      }
    }
    for (const campo of ['lettureAlternative', 'elementiDaOsservare', 'domandeEquipe']) {
      const [minimo, massimo] = LIMITI_ARRAY_CHIAVE[campo];
      const a = k[campo];
      if (!Array.isArray(a)) {
        e.push(`${P}.${campo} deve essere un array.`);
        continue;
      }
      if (a.length < minimo) e.push(`${P}.${campo} deve contenere almeno ${minimo} elemento/i.`);
      if (a.length > massimo) e.push(`${P}.${campo}: al massimo ${massimo} elementi (ricevuti ${a.length}).`);
      a.forEach((s, j) => {
        if (!isNonEmptyStr(s)) e.push(`${P}.${campo}[${j}] deve essere una stringa non vuota.`);
      });
    }
    e.push(...validaListaFonti(k.fonti, `${P}.fonti`, 1));
  });
  return e;
}

function validaOutputAI(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return ["L'output AI non è un oggetto JSON."];
  }
  const e = [];
  if (!isNonEmptyStr(json.sintesiGenerale)) e.push('sintesiGenerale mancante o vuota.');

  const pil = json.pilastri;
  if (!Array.isArray(pil) || pil.length !== PILASTRI.length) {
    e.push(`pilastri deve essere un array di esattamente ${PILASTRI.length} elementi.`);
  } else {
    pil.forEach((p, i) => {
      const atteso = PILASTRI[i].id;
      if (!p || typeof p !== 'object' || Array.isArray(p)) {
        e.push(`pilastri[${i}] non è un oggetto.`);
        return;
      }
      if (p.pilastro !== atteso)
        e.push(`pilastri[${i}].pilastro = "${p.pilastro}", atteso "${atteso}" (ordine canonico).`);
      for (const campo of [
        'comeMiVedo',
        'comeMiVedonoGliAltri',
        'elementiRete',
        'letturaEducativaPossibile',
        'aspettoDaApprofondire',
      ]) {
        if (!isNonEmptyStr(p[campo])) e.push(`pilastri[${i}].${campo} mancante o vuoto.`);
      }
      const cd = p.convergenzeDiscrepanze;
      if (!cd || typeof cd !== 'object' || Array.isArray(cd)) {
        e.push(`pilastri[${i}].convergenzeDiscrepanze mancante.`);
      } else {
        for (const campo of ['convergenze', 'discrepanze', 'datiInsufficienti']) {
          if (typeof cd[campo] !== 'string')
            e.push(`pilastri[${i}].convergenzeDiscrepanze.${campo} deve essere una stringa.`);
        }
      }
      e.push(...validaListaFonti(p.fonti, `pilastri[${i}].fonti`, 1));
    });
  }

  const lt = json.letturaTrasversale;
  if (!lt || typeof lt !== 'object' || Array.isArray(lt)) {
    e.push('letturaTrasversale mancante.');
  } else {
    for (const campo of ['risorse', 'aspettiAttenzione', 'elementiDaApprofondire']) {
      const arr = lt[campo];
      if (!Array.isArray(arr)) {
        e.push(`letturaTrasversale.${campo} deve essere un array.`);
        continue;
      }
      arr.forEach((it, i) => {
        if (!it || typeof it !== 'object' || Array.isArray(it)) {
          e.push(`letturaTrasversale.${campo}[${i}] non è un oggetto.`);
          return;
        }
        if (!isNonEmptyStr(it.testo)) e.push(`letturaTrasversale.${campo}[${i}].testo mancante o vuoto.`);
        e.push(...validaListaFonti(it.fonti, `letturaTrasversale.${campo}[${i}].fonti`, 1));
      });
    }
  }

  e.push(...validaChiaviPsicoPedagogiche(json));
  return e;
}

// ── Verifica SEMANTICA (rafforzata) dei riferimenti di fonte ───────
// FASE 7: ogni tripletta { scheda, pilastro, elementoId } deve appartenere
// ESATTAMENTE all'insieme server-side delle fonti citabili (costruito solo dal
// payload). `pilastro` deve sempre essere uno dei sei PILASTRI_ID. NESSUNA
// correzione silenziosa: un errore del modello resta rilevabile e viene
// segnalato con precisione per il retry.
function verificaFontiSemantica(json, payload) {
  const citabili = costruisciFontiCitabili(payload);
  const errori = [];
  const controlla = (rif, path) => {
    if (!rif || typeof rif !== 'object' || Array.isArray(rif)) {
      errori.push(`${path}: riferimento non è un oggetto.`);
      return;
    }
    const scheda = rif.scheda;
    const pilastro = rif.pilastro;
    const id = typeof rif.elementoId === 'string' ? rif.elementoId.trim() : '';
    if (!['A', 'B', 'C'].includes(scheda)) {
      errori.push(`${path}: scheda "${scheda}" non valida (usare "A", "B" o "C").`);
      return;
    }
    if (!PILASTRI_ID.includes(pilastro)) {
      errori.push(`${path}: "pilastro" = "${pilastro}" non valido. "pilastro" deve essere ESATTAMENTE uno di: ${PILASTRI_ID.join(', ')} (mai un elementoId).`);
      return;
    }
    if (!id) {
      errori.push(`${path}: elementoId mancante.`);
      return;
    }
    const e = citabili.get(id);
    if (!e) {
      errori.push(`${path}: l'elementoId "${id}" non è tra le FONTI CITABILI dei DATI forniti.`);
      return;
    }
    if (!e.schede.has(scheda)) {
      errori.push(`${path}: l'elementoId "${id}" non appartiene alla Scheda ${scheda} (ammessa: ${[...e.schede].join('/')}).`);
      return;
    }
    if (!e.pilastriAll && !e.pilastri.has(pilastro)) {
      errori.push(`${path}: l'elementoId "${id}" appartiene al pilastro "${[...e.pilastri][0]}", non a "${pilastro}".`);
    }
  };
  const pilastri = Array.isArray(json && json.pilastri) ? json.pilastri : [];
  pilastri.forEach((p, i) =>
    (Array.isArray(p && p.fonti) ? p.fonti : []).forEach((r, j) =>
      controlla(r, `pilastri[${i}].fonti[${j}]`),
    ),
  );
  const lt = json && json.letturaTrasversale;
  if (lt && typeof lt === 'object') {
    for (const campo of ['risorse', 'aspettiAttenzione', 'elementiDaApprofondire']) {
      (Array.isArray(lt[campo]) ? lt[campo] : []).forEach((it, i) =>
        (Array.isArray(it && it.fonti) ? it.fonti : []).forEach((r, j) =>
          controlla(r, `letturaTrasversale.${campo}[${i}].fonti[${j}]`),
        ),
      );
    }
  }
  // Passo 6: le fonti di ogni chiave psico-pedagogica devono essere elementi
  // A/B/C realmente presenti nel payload, esattamente come per pilastri e
  // lettura trasversale. La fonte sostiene la CONFIGURAZIONE osservata, non
  // "certifica" la teoria.
  (Array.isArray(json && json.chiaviPsicoPedagogiche) ? json.chiaviPsicoPedagogiche : []).forEach((k, i) =>
    (Array.isArray(k && k.fonti) ? k.fonti : []).forEach((r, j) =>
      controlla(r, `chiaviPsicoPedagogiche[${i}].fonti[${j}]`),
    ),
  );
  return errori;
}

// ═══════════════════════════════════════════════════════════════════
//  PASSO 6C · FASE 6 — Blocco epistemico sui dati insufficienti
//
//  PRINCIPIO VINCOLANTE: ASSENZA DI INFORMAZIONE ≠ CARATTERISTICA DEL RAGAZZO.
//  `NO` / risposta mancante / dato non interpretabile NON sono evidenza
//  positiva di alcunché. Molti dati assenti NON si aggregano in una
//  configurazione del ragazzo.
//
//  `valutaSufficienzaDatiPerChiavi` è una funzione PURA e DETERMINISTICA
//  (nessun modello, nessuna interpretazione dei punteggi). Misura solo la
//  DISPONIBILITÀ di informazione UTILIZZABILE a fondare una eventuale chiave
//  psico-pedagogica; non sceglie teorie, non legge i valori come "livelli".
//  Informativo = una risposta 1/2/3. Non informativo = `NO` o mancante.
//
//  Soglie — motivate dalla struttura reale (18 A + 18 B + 3 chiusure + rete C),
//  NON tarate per far passare un singolo caso:
//   · una chiave richiede una CONFIGURAZIONE: un nucleo di ~4 elementi coerenti,
//     non una singola risposta;
//   · l'evidenza può essere CONCENTRATA (pochi dati totali, ma un nucleo A/B
//     reale) oppure DIFFUSA (≈metà degli indicatori informativi su ≥ 3 pilastri);
//   · A/B e C sono vie INDIPENDENTI: una discrepanza A↔B chiara è interrogabile
//     anche con C povera, e la rete C può bastare con A/B parziali.
const SOGLIE_SUFFICIENZA = Object.freeze({
  AB_ENTRAMBI_MIN: 4,       // indicatori con A e B entrambi informativi → nucleo A/B
  AB_ALMENO_UNO_MIN: 9,     // indicatori con A o B informativo → evidenza diffusa (metà di 18)
  PILASTRI_MIN: 3,          // pilastri (su 6) con almeno un indicatore informativo
  C_PERSONE_SOLO_MIN: 3,    // persone nella rete C (vicinanza+fatica, escluso IO)
  C_PERSONE_CON_LEGAME_MIN: 2, // persone + ≥ 1 legame QUALIFICATO (non neutro/non spec.)
});

function _valoreInformativo(v) {
  return v === 1 || v === 2 || v === 3;
}
function _legameQualificato(l) {
  const q = l && l.qualita;
  return typeof q === 'string' && q !== 'non specificata' && q !== 'neutro o poco definito';
}

// Ritorna { sufficiente: boolean, dettaglio: {...} }. `dettaglio` è solo
// diagnostica interna (conteggi), MAI una classificazione del ragazzo, e non
// viene inviato al modello né salvato nella Scheda D.
function valutaSufficienzaDatiPerChiavi(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const indicatori = Array.isArray(p.indicatori) ? p.indicatori : [];

  let aInfo = 0;
  let bInfo = 0;
  let abEntrambi = 0;
  let abAlmenoUno = 0;
  const pilastriConEvidenza = new Set();
  for (const it of indicatori) {
    const a = _valoreInformativo(it && it.a && it.a.valore);
    const b = _valoreInformativo(it && it.b && it.b.valore);
    if (a) aInfo += 1;
    if (b) bInfo += 1;
    if (a && b) abEntrambi += 1;
    if (a || b) {
      abAlmenoUno += 1;
      if (it && typeof it.pilastro === 'string') pilastriConEvidenza.add(it.pilastro);
    }
  }
  const chiusureInformative = Array.isArray(p.chiusuraSchedaA) ? p.chiusuraSchedaA.length : 0;

  const rete = p.reteSchedaC && typeof p.reteSchedaC === 'object' ? p.reteSchedaC : {};
  let cPersone = 0;
  let cLegamiQualificati = 0;
  for (const k of ['vicinanza', 'fatica']) {
    const blk = rete[k] && typeof rete[k] === 'object' ? rete[k] : {};
    cPersone += Array.isArray(blk.persone) ? blk.persone.length : 0;
    for (const l of (Array.isArray(blk.legami) ? blk.legami : [])) {
      if (_legameQualificato(l)) cLegamiQualificati += 1;
    }
  }

  // Vie indipendenti verso la sufficienza:
  const contributoAB = abEntrambi >= SOGLIE_SUFFICIENZA.AB_ENTRAMBI_MIN;
  const contributoDiffuso = abAlmenoUno >= SOGLIE_SUFFICIENZA.AB_ALMENO_UNO_MIN
    && pilastriConEvidenza.size >= SOGLIE_SUFFICIENZA.PILASTRI_MIN;
  const contributoC = cPersone >= SOGLIE_SUFFICIENZA.C_PERSONE_SOLO_MIN
    || (cPersone >= SOGLIE_SUFFICIENZA.C_PERSONE_CON_LEGAME_MIN && cLegamiQualificati >= 1);

  const sufficiente = contributoAB || contributoDiffuso || contributoC;

  return {
    sufficiente,
    dettaglio: {
      aInformative: aInfo,
      bInformative: bInfo,
      abEntrambiInformativi: abEntrambi,
      abAlmenoUnoInformativo: abAlmenoUno,
      pilastriConEvidenza: pilastriConEvidenza.size,
      chiusureInformative,
      cPersone,
      cLegamiQualificati,
      contributoAB,
      contributoDiffuso,
      contributoC,
      soglie: SOGLIE_SUFFICIENZA,
    },
  };
}

// Validazione SEMANTICA server-side del blocco epistemico: se le chiavi NON
// sono ammesse (dati insufficienti) e il modello ne ha prodotta comunque una,
// l'output va RESPINTO (→ retry, e se persiste nessuna D salvata).
//   chiaviAmmesse === false  ⇒  chiaviPsicoPedagogiche.length === 0
function verificaBloccoEpistemico(json, chiaviAmmesse) {
  if (chiaviAmmesse) return [];
  const arr = json && Array.isArray(json.chiaviPsicoPedagogiche) ? json.chiaviPsicoPedagogiche : [];
  if (arr.length > 0) {
    return [`CHIAVI_PSICO_PEDAGOGICHE_NON_AMMESSE: i dati non consentono chiavi psico-pedagogiche fondate; "chiaviPsicoPedagogiche" deve essere [] (ricevute ${arr.length}).`];
  }
  return [];
}

// ── Estrazione robusta del JSON dalla risposta del modello ─────────
function estraiJson(text) {
  if (typeof text !== 'string') return null;
  // Il modello deve restituire SOLO l'oggetto JSON. Se aggiunge un blocco di
  // codice o testo attorno, si prova prima la stringa ripulita e poi il primo
  // oggetto { … } più esterno.
  const s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const tentativi = [s];
  const primo = s.indexOf('{');
  const ultimo = s.lastIndexOf('}');
  if (primo >= 0 && ultimo > primo) tentativi.push(s.slice(primo, ultimo + 1));
  for (const t of tentativi) {
    try { return JSON.parse(t); } catch (_) { /* prova il prossimo */ }
  }
  return null;
}

// ── PROMPT DI SISTEMA ─────────────────────────────────────────────
const SYSTEM_PROMPT = [
  'Sei uno strumento di supporto documentale per un\u2019\u00e9quipe educativa che lavora con adolescenti (13\u201317 anni) accolti in comunit\u00e0. Redigi la "Scheda D \u2014 Sintesi educativa integrata" incrociando tre schede gi\u00e0 compilate con il ragazzo. La Scheda D \u00e8 destinata esclusivamente all\u2019\u00e9quipe educativa.',
  '',
  'LE TRE FONTI',
  '- Scheda A "Come mi vedo": autorappresentazione del ragazzo.',
  '- Scheda B "Come penso che mi vedano gli altri": IMMAGINE RIFLESSA, cio\u00e8 come il ragazzo PENSA di essere visto dalle persone che lo conoscono. NON \u00e8 ci\u00f2 che gli altri pensano realmente di lui.',
  '- Scheda C "Le persone intorno a me": rete relazionale PERCEPITA dal ragazzo (persone, vicinanza/fatica percepita, direzione e qualit\u00e0 dei legami). NON \u00e8 una ricostruzione oggettiva della rete sociale.',
  'A e B usano gli stessi 18 indicatori (stesso indicatorId), in 6 pilastri. Scala: "NO" = il ragazzo non sa collocarsi su quell\u2019aspetto (NON \u00e8 uno zero, NON \u00e8 un esito negativo); 1 = pi\u00f9 bisogno di accompagnamento; 2 = intermedio; 3 = maggiore autonomia.',
  '',
  'COSA DEVI FARE',
  'Organizzare le informazioni; metterle in relazione; descrivere convergenze e discrepanze; individuare risorse effettivamente sostenute dai dati; formulare ipotesi educative prudenti; formulare domande utili all\u2019\u00e9quipe e indicare cosa osservare nella vita quotidiana. Prepari una base ragionata che sar\u00e0 discussa e validata dall\u2019\u00e9quipe.',
  '',
  'COSA NON DEVI MAI FARE',
  '- formulare diagnosi psicologiche o psichiatriche, o usare etichette cliniche;',
  '- inferire traumi, disturbi, intenzioni, o tratti di personalit\u00e0 non direttamente sostenuti dai dati;',
  '- attribuire cause familiari o ambientali senza informazioni esplicite nelle schede;',
  '- trasformare un punteggio basso (1) in un "deficit", una "carenza" o un "problema";',
  '- trasformare una discrepanza tra A e B in "scarsa consapevolezza" o in un problema;',
  '- scegliere gli obiettivi educativi o il pilastro prioritario su cui lavorare;',
  '- suggerire trattamenti sanitari, psicoterapeutici o farmacologici;',
  '- inventare informazioni non presenti nelle fonti o completare dati mancanti con ipotesi;',
  '- presentare un\u2019ipotesi come un fatto accertato;',
  '- usare aggettivi di giudizio sulla persona ("debole", "fragile", "problematico", "immaturo", "manipolatore", ecc.) o punteggi/percentuali globali sul ragazzo.',
  '',
  'REGOLA SULLE DISCREPANZE A/B (fondamentale)',
  'Una differenza tra A e B va DESCRITTA, non SPIEGATA. Esempio corretto: "Si rileva una discrepanza tra autorappresentazione e immagine riflessa rispetto alla gestione del conflitto. I dati disponibili non consentono di stabilire l\u2019origine di questa distanza. Pu\u00f2 essere utile confrontarla con l\u2019osservazione dell\u2019\u00e9quipe e con il punto di vista del ragazzo."',
  'Sono VIETATE conclusioni come "Il ragazzo non \u00e8 consapevole del proprio comportamento" oppure "Il ragazzo tende a negare le proprie difficolt\u00e0", se non direttamente sostenute da informazioni esplicite.',
  '',
  'LIMITI INFORMATIVI',
  'Quando i dati non consentono una lettura fondata, scrivi esattamente: "I dati disponibili non consentono di formulare una lettura sufficientemente fondata su questo aspetto." Preferisci sempre l\u2019incertezza dichiarata all\u2019inferenza.',
  'ASSENZA DI INFORMAZIONE \u2260 CARATTERISTICA DEL RAGAZZO. "NO", "non so", una risposta mancante, un dato non disponibile o non interpretabile rappresentano assenza o insufficienza di informazione: NON sono evidenza positiva di identit\u00e0 poco definita, incertezza personale, difficolt\u00e0 di autorappresentazione, scarsa consapevolezza, fragilit\u00e0, dipendenza dallo sguardo altrui, difficolt\u00e0 relazionale, deficit, tratto di personalit\u00e0, causa familiare, trauma, attaccamento o qualunque altra configurazione psicologica o educativa. NON aggregare risposte non informative per inferire una configurazione del ragazzo. VIETATO: "Il ragazzo presenta una diffusa incertezza nella rappresentazione di s\u00e9" derivato da molte risposte NO/non so/mancanti. CORRETTO: "Le informazioni disponibili non consentono una lettura sufficientemente fondata di questo aspetto." La povert\u00e0 informativa descrive un limite della conoscenza disponibile, non il ragazzo: quando i dati non bastano, descrivi il limite e indica cosa approfondire.',
  '',
  'USO DELLA SCHEDA C',
  'Collega alla lettura di un pilastro SOLO gli elementi della rete realmente pertinenti a quel pilastro. Se per un pilastro la Scheda C non offre elementi pertinenti, dichiaralo ("La Scheda C non contiene elementi pertinenti per questo pilastro") senza costruire collegamenti.',
  '',
  'LINGUAGGIO',
  'Formule ipotetiche: "pu\u00f2 suggerire\u2026", "potrebbe essere utile esplorare\u2026", "sembra emergere\u2026", "i dati indicano una possibile\u2026", "merita di essere approfondito\u2026". Riferisciti al ragazzo in modo impersonale ("il ragazzo", "la persona"). Tono sobrio, adatto a una riunione d\u2019\u00e9quipe. Italiano.',
  '',
  'TRACCIABILIT\u00c0 DELLE FONTI',
  'Ogni voce di "fonti" \u00e8 un oggetto { "scheda", "pilastro", "elementoId" }.',
  '"scheda" \u2208 { "A", "B", "C" }. "pilastro" DEVE essere ESATTAMENTE uno di: self, others, environment, future, expression, wellbeing \u2014 nessun altro valore. Gli identificatori delle domande di chiusura della Scheda A e degli elementi della rete C sono "elementoId", MAI "pilastro".',
  '"elementoId": per un indicatore = il suo id (es. "self_01"), con "pilastro" = quello indicato nell\u2019elenco FONTI CITABILI; per una domanda di chiusura A o un elemento della rete C = l\u2019id fornito, con "pilastro" = quello del blocco in cui stai scrivendo.',
  'Cita ESCLUSIVAMENTE triplette ricavabili dall\u2019elenco FONTI CITABILI presente nei DATI. Non inventare "elementoId" n\u00e9 "pilastro"; non citare persone, legami, indicatori o risposte che non compaiono nell\u2019elenco.',
  '',
  'CHIAVE PSICO-PEDAGOGICA PER L\u2019\u00c9QUIPE (livello aggiuntivo, opzionale)',
  'Quando \u2014 e SOLO quando \u2014 la configurazione dei dati lo giustifica, offri all\u2019\u00e9quipe una o pi\u00f9 "chiavi psico-pedagogiche": un riferimento teorico consolidato usato come LENTE per interrogare meglio il caso (anche funzione formativa: l\u2019educatore incontra un concetto tramite una situazione concreta). SEQUENZA OBBLIGATORIA \u2014 la teoria \u00e8 convocata dal caso, mai il contrario: dati \u2192 configurazione rilevante \u2192 questione educativa \u2192 eventuale teoria \u2192 concetto specifico \u2192 pertinenza per QUESTI dati \u2192 limiti \u2192 cosa osservare \u2192 domande.',
  'La teoria \u00e8 una LENTE, non una spiegazione causale: formule ipotetiche ("questa configurazione pu\u00f2 essere interrogata attraverso il concetto di\u2026", "una possibile lente \u00e8 offerta da\u2026"); MAI "secondo la teoria X il ragazzo\u2026", "dimostra\u2026", "presenta\u2026". Non usarla per inferire diagnosi, trauma, attaccamento, disturbi, tratti, intenzioni, cause familiari, deficit o funzionamenti non osservabili assenti dalle fonti.',
  'NESSUNA associazione rigida pilastro \u2192 autore; nessun autore \u00e8 legato stabilmente a un pilastro; non una teoria per ogni pilastro. Se i dati di un pilastro non giustificano un approfondimento fondato, NON metterne uno: meglio nessuna chiave che una generica. Se la configurazione attraversa pi\u00f9 pilastri, usa una chiave TRASVERSALE.',
  'Contributi che POSSONO essere pertinenti in casi diversi (elenco esemplificativo e NON esaustivo, NON una checklist; mai citare per prestigio, variet\u00e0 o completezza): Albert Bandura; Lev Vygotskij; Urie Bronfenbrenner; Erik Erikson; James Marcia; Edward Deci e Richard Ryan; Carl Rogers; John Bowlby; George Herbert Mead; Charles Horton Cooley; John Dewey; Jerome Bruner; Paulo Freire; Lawrence Kohlberg; Daniel Stern; Lazarus e Folkman; Donald Winnicott; Howard Gardner; Aaron Antonovsky; Martin Seligman; e altri riferimenti consolidati quando realmente pertinenti. Test per ogni riferimento: "perch\u00e9 PROPRIO questa teoria aiuta a interrogare QUESTI dati?"; senza risposta fondata in A/B/C la teoria non compare.',
  'PRECISIONE: autore/i corretti; un CONCETTO SPECIFICO, non l\u2019intera teoria; spiegazione breve e corretta, comprensibile a chi non ha studiato quell\u2019autore; distingui il concetto dalla sua applicazione; non attribuire all\u2019autore ci\u00f2 che non gli appartiene; non inventare opere, citazioni, date, definizioni, bibliografia; nessuna citazione testuale; in dubbio sull\u2019attribuzione, ometti il riferimento. Niente banalizzazioni, frasi motivazionali, psicologia pop, formule da coaching, tecnicismi non spiegati.',
  'VARIABILIT\u00c0: non lo stesso autore per lo stesso tipo di dato, non sempre lo stesso numero di chiavi o la stessa struttura; non ridurre ogni "1" o ogni discrepanza A/B alla stessa lettura; niente formule ricorrenti tipo "lavorare sull\u2019autonomia", "rafforzare l\u2019autostima", "migliorare la gestione emotiva". La differenziazione deriva dalla CONFIGURAZIONE DEI DATI di questo ragazzo. IPOTESI ALTERNATIVE: se i dati non permettono di distinguere fra letture plausibili, dichiaralo e metti in "lettureAlternative" 1\u20132 direzioni di esplorazione (non diagnosi alternative: domande verificabili con osservazione e dialogo).',
  'NUMERO: da 0 a 3 chiavi; solo quelle con reale valore euristico. Se nessuna \u00e8 fondata \u2192 "chiaviPsicoPedagogiche": []. Filtro finale: "aiuta a vedere qualcosa da osservare e discutere in QUESTO caso, o si incollerebbe su molti ragazzi?" \u2014 nel secondo caso non generarla. "elementiDaOsservare" e "domandeEquipe" NON sono obiettivi, attivit\u00e0, interventi, programmi, priorit\u00e0 o trattamenti (la scelta degli obiettivi PPU \u00e8 un passo successivo dell\u2019\u00e9quipe).',
  'DATI INSUFFICIENTI: le chiavi NON possono nascere dall\u2019assenza di informazione. Molte risposte NO/non so/mancanti NON sono una configurazione: non aggregarle per proporre "identit\u00e0 incerta", "scarsa consapevolezza", "fragilit\u00e0", "dipendenza dallo sguardo altrui", "diffusa incertezza nella rappresentazione di s\u00e9" o simili. Se ricevi nei DATI l\u2019indicazione "CHIAVI_PSICO_PEDAGOGICHE_NON_AMMESSE", restituisci OBBLIGATORIAMENTE "chiaviPsicoPedagogiche": [] e limitati a descrivere il limite informativo.',
  'FONTI DELLE CHIAVI: stesso formato e stesso vincolo delle altre fonti (solo triplette da FONTI CITABILI); sostengono la CONFIGURAZIONE osservata, non "certificano" la teoria. Se la chiave ha ambito "pilastro", NON ripetere in "configurazioneOsservata" ci\u00f2 che hai gi\u00e0 scritto nei campi di quel pilastro: richiamala in forma sintetica e concentra la chiave su lente teorica, limiti e cosa osservare.',
  '',
  'FORMATO DELL\u2019OUTPUT',
  'Rispondi con un SOLO oggetto JSON valido, senza testo prima o dopo, senza blocchi di codice.',
  'LUNGHEZZA E CONCISIONE (vincolante). La Scheda D \u00e8 un documento di lavoro leggibile dall\u2019\u00e9quipe in pochi minuti: circa 700\u20131100 parole in tutto. Rispetta questi limiti per campo:',
  '- sintesiGenerale: 3\u20135 frasi;',
  '- ogni pilastro \u2014 comeMiVedo / comeMiVedonoGliAltri / elementiRete: 1\u20132 frasi ciascuno; convergenzeDiscrepanze.{convergenze,discrepanze,datiInsufficienti}: 1 frase ciascuno (stringa vuota ammessa dove non pertinente); letturaEducativaPossibile: 1\u20132 frasi; aspettoDaApprofondire: 1 frase;',
  '- ogni voce di letturaTrasversale: 1\u20132 frasi;',
  '- ogni chiave \u2014 configurazioneOsservata: max 2 frasi brevi; questioneEducativa: 1 frase; riferimentoTeorico.spiegazione: max 2 frasi; pertinenzaNelCaso: max 2 frasi; limitiDellaLettura: max 2 frasi; lettureAlternative: max 2; elementiDaOsservare: max 3; domandeEquipe: max 3.',
  'UNA informazione va espressa UNA SOLA VOLTA, nel campo pi\u00f9 appropriato: NON ripetere la stessa evidenza tra configurazioneOsservata, questioneEducativa, pertinenzaNelCaso, limitiDellaLettura, lettureAlternative, elementiDaOsservare e domandeEquipe.',
  'Se un campo di pilastro non ha contenuto fondato, usa una frase sintetica o la formula di insufficienza: non allungare artificialmente. Meglio conciso e completo che lungo e troncato: emetti SEMPRE l\u2019oggetto JSON completo.',
  'Struttura:',
  '{',
  '  "sintesiGenerale": "testo breve: convergenze principali, discrepanze principali, risorse riconoscibili, elementi da approfondire. Nessun giudizio globale sulla persona.",',
  '  "pilastri": [',
  '    {',
  '      "pilastro": "self|others|environment|future|expression|wellbeing",',
  '      "comeMiVedo": "sintesi delle informazioni pertinenti dalla Scheda A per questo pilastro",',
  '      "comeMiVedonoGliAltri": "sintesi corrispondente dalla Scheda B (immagine riflessa)",',
  '      "elementiRete": "elementi pertinenti dalla Scheda C, oppure la dichiarazione di assenza",',
  '      "convergenzeDiscrepanze": { "convergenze": "", "discrepanze": "descritte non spiegate", "datiInsufficienti": "" },',
  '      "letturaEducativaPossibile": "una breve ipotesi prudente, in forma dubitativa",',
  '      "aspettoDaApprofondire": "una domanda educativa concreta o un elemento osservabile nella vita quotidiana",',
  '      "fonti": [ { "scheda": "A", "pilastro": "self", "elementoId": "self_01" } ]',
  '    }',
  '  ],',
  '  "letturaTrasversale": {',
  '    "risorse": [ { "testo": "capacit\u00e0/relazioni/atteggiamenti positivi sostenuti dai dati", "fonti": [ ] } ],',
  '    "aspettiAttenzione": [ { "testo": "elementi ricorrenti o discrepanze con possibile rilevanza educativa", "fonti": [ ] } ],',
  '    "elementiDaApprofondire": [ { "testo": "aree in cui A/B/C non danno una lettura solida o divergono", "fonti": [ ] } ]',
  '  },',
  '  "chiaviPsicoPedagogiche": [',
  '    {',
  '      "ambito": "pilastro" | "trasversale",',
  '      "pilastro": "self|others|environment|future|expression|wellbeing quando ambito=pilastro, altrimenti null",',
  '      "configurazioneOsservata": "descrizione sintetica della configurazione, ricavata SOLO dalle fonti",',
  '      "questioneEducativa": "la domanda educativa che rende pertinente l\u2019approfondimento",',
  '      "riferimentoTeorico": { "autore": "\u2026", "teoria": "\u2026", "concetto": "un concetto specifico, non l\u2019intera teoria", "spiegazione": "breve spiegazione formativa del concetto" },',
  '      "pertinenzaNelCaso": "perch\u00e9 questo concetto aiuta a interrogare proprio questa configurazione",',
  '      "limitiDellaLettura": "cosa NON pu\u00f2 essere concluso sulla base dei dati disponibili",',
  '      "lettureAlternative": [ "eventuale diversa direzione da verificare, non diagnosi" ],',
  '      "elementiDaOsservare": [ "comportamenti/situazioni concrete osservabili nella vita quotidiana" ],',
  '      "domandeEquipe": [ "domande che aiutano l\u2019\u00e9quipe a verificare, discutere o confutare la lettura" ],',
  '      "fonti": [ { "scheda": "A", "pilastro": "self", "elementoId": "self_01" } ]',
  '    }',
  '  ]',
  '}',
  '"pilastri" deve contenere ESATTAMENTE 6 elementi, nell\u2019ordine: self, others, environment, future, expression, wellbeing. Ogni voce di "pilastri" e ogni voce della "letturaTrasversale" deve avere almeno un riferimento in "fonti". La "letturaTrasversale" cerca configurazioni che ATTRAVERSANO pi\u00f9 pilastri, non ripete le sei analisi. Le sue tre categorie NON sono una classificazione del ragazzo.',
  '"chiaviPsicoPedagogiche": array 0..3 (vuoto valido). Ogni chiave: ambito coerente (pilastro\u2192pilastro valido; trasversale\u2192pilastro null), campi testuali compilati, \u2265 1 fonte da FONTI CITABILI. Non inserire chiavi generiche.',
  'NON generare il campo "notaMetodologica": viene aggiunto dall\u2019applicazione. Rispondi con il solo JSON, completo e valido.',
].join('\n');

// ── Costruzione dei messaggi per il modello (iniziale + un retry) ──
// `troncato` (Passo 6C): il tentativo precedente ha raggiunto max_tokens ed e
// stato tagliato. In quel caso NON si reinserisce il testo troncato (sarebbe un
// template rotto da "riparare" e gonfierebbe l'input): si rigenera dal payload
// con una direttiva di concisione forte.
// `chiaviAmmesse` (Passo 6C · FASE 6): calcolato SERVER-SIDE da
// valutaSufficienzaDatiPerChiavi. Se false -> flag CHIAVI_PSICO_PEDAGOGICHE_NON_
// AMMESSE + obbligo di "chiaviPsicoPedagogiche": []. Il flag e testo derivato:
// NON aggiunge alcun dato del ragazzo al payload.
function costruisciMessaggiModello({ payload, precedente, errori, troncato = false, chiaviAmmesse = true }) {
  const userText = [
    'Genera la Scheda D \u2014 Sintesi educativa integrata a partire dai seguenti dati del ragazzo (Schede A, B, C).',
    'Rispondi ESCLUSIVAMENTE con un oggetto JSON conforme allo schema indicato nelle istruzioni di sistema. Nessun testo prima o dopo, nessun blocco di codice.',
    '',
    'DATI (JSON):',
    JSON.stringify(payload, null, 2),
    '',
    elencoFontiCitabiliTesto(payload),
    ...(chiaviAmmesse ? [] : [
      '',
      'CHIAVI_PSICO_PEDAGOGICHE_NON_AMMESSE',
      'Per questo set di dati la quantità e la qualità delle informazioni disponibili NON consentono una lettura psico-pedagogica sufficientemente fondata.',
      'Devi restituire OBBLIGATORIAMENTE "chiaviPsicoPedagogiche": []. NON trasformare l’insufficienza dei dati in una caratteristica del ragazzo: descrivi il limite delle informazioni e indica ciò che deve essere approfondito. Il resto della Scheda D va comunque compilato.',
    ]),
    ...(troncato ? [
      '',
      'NOTA: un tentativo precedente è stato TRONCATO perché troppo lungo e non è risultato un JSON valido.',
      'Rispetta RIGOROSAMENTE i limiti di lunghezza per ogni campo indicati nelle istruzioni di sistema; riduci la prosa dove serve mantenendo i contenuti essenziali; non aggiungere campi.',
      'Emetti ESCLUSIVAMENTE l’oggetto JSON completo, senza testo prima o dopo e senza blocchi di codice.',
    ] : []),
  ].join('\n');

  // NB: claude-sonnet-5 NON supporta il prefill del turno assistant: la
  // conversazione DEVE terminare con un messaggio `user`. Il JSON-only \u00e8
  // ottenuto via istruzioni esplicite (system + user) + estrazione robusta
  // lato codice (estraiJson).
  const messages = [{ role: 'user', content: userText }];
  if (!troncato && precedente != null) {
    messages.push({ role: 'assistant', content: String(precedente) });
    messages.push({
      role: 'user',
      content: [
        'Il JSON che hai prodotto non ha superato i controlli automatici.',
        'Errori riscontrati:',
        ...(Array.isArray(errori) ? errori : []).map((e) => '- ' + e),
        '',
        'Correggi ESCLUSIVAMENTE il JSON perch\u00e9 rispetti lo schema.',
        'Per ogni voce di "fonti": "pilastro" deve essere ESATTAMENTE uno di ' + PILASTRI_ID.join(', ') + '; "elementoId" e la coppia (pilastro, elementoId) devono comparire nell\u2019elenco FONTI CITABILI dei DATI. Gli identificatori delle domande di chiusura e della rete C sono "elementoId", MAI "pilastro".',
        'Non aggiungere nuove interpretazioni e non modificare il merito delle analisi se non per correggere gli errori elencati.',
        'Rispondi di nuovo con il solo JSON, senza testo prima o dopo e senza blocchi di codice.',
      ].join('\n'),
    });
  }
  return messages;
}

// ── Verifica di accesso equivalente a canAccessPPU(comunitaId) ─────
async function verificaAccessoPPU(db, uid, comunitaId) {
  if (!uid) return false;
  if (uid === ADMIN_UID) return true;
  let snap;
  try {
    snap = await db.collection('staff').doc(uid).get();
  } catch (_) {
    return false;
  }
  if (!snap || !snap.exists) return false;
  const s = snap.data() || {};
  const com = s.comunitaId;
  const match = Array.isArray(com) ? com.includes(comunitaId) : com === comunitaId;
  if (!match) return false;
  const ruolo = String(s.ruolo || '').toLowerCase();
  if (/coordinat|responsabil/.test(ruolo)) return true;
  if (s.accessoDocumenti === true) return true;
  return false;
}

function str(v) {
  return v == null ? '' : String(v).trim();
}

// ── Orchestrazione completa (testabile con db/chiamaModello fittizi) ──
async function eseguiGenerazione(deps) {
  const {
    db,
    auth,
    data,
    chiamaModello,
    modelloAIdefault = 'modello-non-specificato',
    serverTimestamp = () => new Date(),
    now = () => Date.now(),
    logger = { info() {}, warn() {}, error() {} },
  } = deps || {};

  // 1. Autenticazione
  if (!auth || !auth.uid) {
    throw new AppError('unauthenticated', 'Devi essere autenticato per generare la sintesi.');
  }
  const uid = auth.uid;

  // 2. Input
  const minorId = str(data && data.minorId);
  const comunitaId = str(data && data.comunitaId);
  const ppuMoment = str(data && data.ppuMoment);
  const ppuMomentNote = str(data && data.ppuMomentNote);
  if (data && (str(data.sourceAId) || str(data.sourceBId) || str(data.sourceCId))) {
    throw new AppError('invalid-argument', 'Le fonti (Schede A/B/C) non possono essere indicate dal client.');
  }
  if (!minorId || !comunitaId) {
    throw new AppError('invalid-argument', 'Parametri obbligatori mancanti (minorId, comunitaId).');
  }
  if (!MOMENTI_VALIDI.includes(ppuMoment)) {
    throw new AppError('invalid-argument', 'Momento del percorso PPU non valido.');
  }
  if (ppuMoment === 'altro' && !ppuMomentNote) {
    throw new AppError('invalid-argument', 'Per il momento \u00abAltro\u00bb \u00e8 richiesta una descrizione (ppuMomentNote).');
  }

  // 3. Autorizzazione
  const consentito = await verificaAccessoPPU(db, uid, comunitaId);
  if (!consentito) {
    throw new AppError('permission-denied', 'Non hai i permessi per operare su questa comunit\u00e0.');
  }

  // 4. Coerenza ragazzo ↔ comunità (modello dati: utenti/{id}.comunitaId)
  let uSnap;
  try {
    uSnap = await db.collection('utenti').doc(minorId).get();
  } catch (_) {
    throw new AppError('internal', 'Errore nella lettura dei dati del ragazzo.');
  }
  if (!uSnap || !uSnap.exists) {
    throw new AppError('failed-precondition', 'Il ragazzo indicato non \u00e8 stato trovato.');
  }
  const uCom = (uSnap.data() || {}).comunitaId;
  const okCom = Array.isArray(uCom) ? uCom.includes(comunitaId) : uCom === comunitaId;
  if (!okCom) {
    throw new AppError('failed-precondition', 'Il ragazzo indicato non appartiene alla comunit\u00e0 richiesta.');
  }

  // 5. Selezione autorevole della terna A+B+C
  const mapDocs = (q) => (q && Array.isArray(q.docs) ? q.docs : []).map((d) => ({ id: d.id, ...d.data() }));
  let aq, bq, cq;
  try {
    [aq, bq, cq] = await Promise.all([
      db.collection('ppu_schede_a').where('minorId', '==', minorId).where('comunitaId', '==', comunitaId).get(),
      db.collection('ppu_schede_b').where('minorId', '==', minorId).where('comunitaId', '==', comunitaId).get(),
      db.collection('ppu_schede_c').where('minorId', '==', minorId).where('comunitaId', '==', comunitaId).get(),
    ]);
  } catch (_) {
    throw new AppError('internal', 'Errore nella lettura delle schede A/B/C.');
  }
  const terna = selezionaTerna({
    schedeA: mapDocs(aq),
    schedeB: mapDocs(bq),
    schedeC: mapDocs(cq),
    ppuMoment,
    ppuMomentNote,
  });
  if (terna.mancanti.length) {
    throw new AppError('failed-precondition', descriviMancanti(ppuMoment, ppuMomentNote, terna.mancanti));
  }

  // 6. Lock anti-doppia-generazione (server-only, Admin SDK; TTL breve; non
  //    ostacola la futura "Rigenera — nuova versione").
  const lock = db.collection('ppu_schede_d_locks').doc(lockKey(minorId, comunitaId, ppuMoment, ppuMomentNote));
  try {
    await lock.create({ startedAt: serverTimestamp(), by: uid });
  } catch (_) {
    let lockSnap = null;
    try {
      lockSnap = await lock.get();
    } catch (_e) {
      /* noop */
    }
    const started = lockSnap && lockSnap.exists ? tsMillis((lockSnap.data() || {}).startedAt) : null;
    if (started != null && now() - started < LOCK_TTL_MS) {
      throw new AppError('aborted', 'Una generazione per questo momento \u00e8 gi\u00e0 in corso. Attendere qualche istante e riprovare.');
    }
    try {
      await lock.set({ startedAt: serverTimestamp(), by: uid });
    } catch (_e) {
      /* noop: proseguo comunque */
    }
  }

  // 7. Payload + generazione (max 1 retry).
  //    Passo 6C: due strategie di retry distinte \u2014
  //    \u00b7 stop_reason === 'max_tokens' (output troncato): si rigenera dal payload
  //      originale con direttiva di concisione forte, SENZA reinserire il testo
  //      troncato (che sarebbe un template rotto e gonfierebbe l'input);
  //    \u00b7 errore strutturale/semantico su un JSON parsato: si reinserisce
  //      l'output precedente e si chiede la sola correzione (comportamento
  //      storico, l'unico che recupera davvero questi casi).
  //    Non si tenta MAI di "completare" un JSON troncato.
  const payload = costruisciPayload({ a: terna.a, b: terna.b, c: terna.c, ppuMoment, ppuMomentNote });
  // FASE 6 — blocco epistemico: i dati bastano a fondare EVENTUALI chiavi?
  // (calcolo SERVER-SIDE, deterministico, mai deciso dal client). La Scheda D
  // resta comunque generabile; se `!chiaviAmmesse` si obbliga [] via prompt e
  // si respinge server-side qualunque output che contenga comunque una chiave.
  const suff = valutaSufficienzaDatiPerChiavi(payload);
  const chiaviAmmesse = suff.sufficiente;
  const t0 = now();
  let jsonOk = null;
  let tentativi = 0;
  let modelloAI = modelloAIdefault;
  let grezzoPrec = null;
  let erroriPrec = null;
  let troncatoPrec = false;

  try {
    for (let k = 1; k <= 2; k++) {
      tentativi = k;
      const messages = costruisciMessaggiModello({
        payload,
        precedente: troncatoPrec ? null : grezzoPrec,
        errori: troncatoPrec ? null : erroriPrec,
        troncato: troncatoPrec,
        chiaviAmmesse,
      });
      let res;
      try {
        res = await chiamaModello({ system: SYSTEM_PROMPT, messages });
      } catch (_) {
        throw new AppError('unavailable', 'Il servizio di generazione non \u00e8 al momento disponibile. Riprovare pi\u00f9 tardi.');
      }
      if (res && res.model) modelloAI = res.model;
      const troncato = !!(res && res.stopReason === 'max_tokens');
      const parsed = estraiJson(res && res.text);
      const errs = parsed
        ? [
          ...validaOutputAI(parsed),
          ...verificaFontiSemantica(parsed, payload),
          ...verificaBloccoEpistemico(parsed, chiaviAmmesse),
        ]
        : [troncato
          ? 'Output troncato (max_tokens): JSON incompleto.'
          : "L'output del modello non \u00e8 un JSON valido."];
      if (!errs.length) {
        jsonOk = parsed;
        break;
      }
      // FASE 7: stop_reason === 'max_tokens' ⇒ documento definitivamente
      // incompleto → retry dal payload originale con direttiva di concisione,
      // MAI reinserire il testo (anche se estraiJson ne avesse salvato un
      // oggetto parziale: gonfierebbe l'input con un template rotto).
      troncatoPrec = troncato;
      grezzoPrec = (res && res.text) || '';
      erroriPrec = errs;
    }
  } finally {
    try {
      await lock.delete();
    } catch (_) {
      /* noop */
    }
  }

  if (!jsonOk) {
    logger.warn('ppu_d_fail', { esito: 'coerenza', tentativi, durataMs: now() - t0 });
    throw new AppError(
      'internal',
      'La sintesi non ha superato i controlli di coerenza. Nessun dato \u00e8 stato salvato. \u00c8 possibile riprovare.',
    );
  }

  // 8. Scrittura del NUOVO documento (mai sovrascrittura)
  // Contratto promptVersion 2: `chiaviPsicoPedagogiche` è SEMPRE presente come
  // array (anche vuoto) nel contenutoAI salvato. Il resto dell'output del
  // modello non viene toccato.
  const contenutoAI = {
    ...jsonOk,
    chiaviPsicoPedagogiche: Array.isArray(jsonOk.chiaviPsicoPedagogiche) ? jsonOk.chiaviPsicoPedagogiche : [],
  };
  const docData = {
    minorId,
    comunitaId,
    createdBy: uid,
    stato: 'GENERATA',
    generatedAt: serverTimestamp(),
    ppuMoment,
    ppuMomentNote: ppuMoment === 'altro' ? ppuMomentNote : '',
    sourceAId: terna.a.id,
    sourceBId: terna.b.id,
    sourceCId: terna.c.id,
    fonti: riepilogoFonti(terna.a, terna.b, terna.c),
    modelloAI,
    promptVersion: PROMPT_VERSION,
    contenutoAI,
    notaMetodologica: NOTA_METODOLOGICA,
    tentativiGenerazione: tentativi,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    validatedAt: null,
    validatedBy: null,
    rilettura: null,
  };
  let ref;
  try {
    ref = await db.collection('ppu_schede_d').add(docData);
  } catch (_) {
    logger.error('ppu_d_firestore_error', { tentativi });
    throw new AppError('internal', 'Errore nel salvataggio della sintesi. Riprovare.');
  }

  logger.info('ppu_d_done', { esito: 'ok', tentativi, durataMs: now() - t0, model: modelloAI });
  return {
    schedaDId: ref.id,
    stato: 'GENERATA',
    ppuMoment,
    ppuMomentNote: docData.ppuMomentNote,
    promptVersion: PROMPT_VERSION,
    modelloAI,
    tentativiGenerazione: tentativi,
  };
}

module.exports = {
  AppError,
  ADMIN_UID,
  PILASTRI,
  PILASTRI_ID,
  COSTRUTTI,
  AB_INDICATORS,
  CLOSING_IDS,
  DOMANDE_CHIUSURA,
  OPZIONI_A,
  OPZIONI_B,
  MOMENTI_PPU,
  MOMENTI_VALIDI,
  LABEL_SCHEDE,
  LEGGIBILE_DIREZIONE,
  LEGGIBILE_QUALITA,
  PROMPT_VERSION,
  MAX_CHIAVI_PP,
  AMBITI_CHIAVE,
  LIMITI_ARRAY_CHIAVE,
  NOTA_METODOLOGICA,
  LOCK_TTL_MS,
  SYSTEM_PROMPT,
  tsMillis,
  piuRecenteCompletata,
  chiaveMomento,
  chiaveMomentoDoc,
  labelMomento,
  descriviMomento,
  pilastroDiIndicatore,
  elencaIndicatoriPilastro,
  selezionaTerna,
  descriviMancanti,
  riepilogoFonti,
  lockKey,
  costruisciRete,
  costruisciPayload,
  estraiFontiCitabili,
  costruisciFontiCitabili,
  elencoFontiCitabiliTesto,
  validaOutputAI,
  validaChiaviPsicoPedagogiche,
  verificaFontiSemantica,
  valutaSufficienzaDatiPerChiavi,
  verificaBloccoEpistemico,
  SOGLIE_SUFFICIENZA,
  estraiJson,
  costruisciMessaggiModello,
  verificaAccessoPPU,
  eseguiGenerazione,
};
