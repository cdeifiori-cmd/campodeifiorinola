// js/ppu-scheda-d-model.js — nucleo dati PURO (nessun Firebase, nessun DOM)
// della Scheda D PPU "Sintesi educativa integrata AI". Isolato in un modulo a
// parte così da poter essere testato in Node senza bundler né emulatore
// (il futuro js/ppu-scheda-d.js importerà da qui e vi aggiungerà persistenza
// Firestore e interfaccia; la Cloud Function di generazione riuserà le stesse
// costanti e le stesse funzioni di validazione).
//
// ─────────────────────────────────────────────────────────────────────────
// SEPARAZIONE RIGOROSA DEI TRE LIVELLI (requisito metodologico vincolante)
//
//   1. Dati provenienti dal ragazzo        → Schede A / B / C
//   2. Elaborazione AI di quei dati        → Scheda D (contenutoAI)
//   3. Interpretazione professionale       → Rilettura dell'équipe (rilettura)
//
// I tre livelli non vanno mai mescolati. In particolare, al modello AI si
// inviano SOLO i dati direttamente riconducibili alle tre prospettive:
//   A = autorappresentazione del ragazzo
//   B = come il ragazzo pensa di essere visto dagli altri
//   C = rete relazionale percepita dal ragazzo
// Restano ESCLUSI dall'invio al modello (entrano solo, eventualmente, nella
// rilettura d'équipe): `areaNotes` della Scheda A, `areaNotes` della Scheda B,
// qualsiasi annotazione libera dell'educatore, e la `note` generale della
// Scheda C (compilata dall'educatore, non è una risposta del ragazzo).
// Le tre risposte `closing` della Scheda A si mantengono perché sono risposte
// effettivamente fornite dal ragazzo. Per la Scheda C si usano solo gli
// elementi della rete espressi dal ragazzo (persone, distanza/vicinanza,
// direzione e qualità dei legami). Vedi CAMPI_PAYLOAD_AMMESSI più sotto.
//
// ─────────────────────────────────────────────────────────────────────────
// SELEZIONE DELLE FONTI (regola confermata, applicata anche server-side)
//
//   stesso `ppuMoment`  →  solo schede `status === 'completata'`
//   →  A più recente + B più recente + C più recente (indipendentemente)
//   →  nessun fallback tra momenti differenti
//   →  se manca anche una sola delle tre  →  momento NON generabile
//   →  la selezione definitiva la fa la Cloud Function (Admin SDK): il
//      client replica questa logica solo per il gating dell'interfaccia
//   →  `sourceAId` / `sourceBId` / `sourceCId` vengono congelati nella D e
//      non cambiano retroattivamente se in seguito si compilano nuove A/B/C
//   →  ogni momento produce la propria D; le D non si sovrascrivono.
//
// ─────────────────────────────────────────────────────────────────────────
// `ppuMoment === 'altro'` — SOLUZIONE TRANSITORIA
//
// Per questa versione il momento "Altro" è identificato dalla chiave
//   'altro:' + ppuMomentNote.trim()
// cioè l'identità temporale dipende da una stringa libera digitata
// dall'operatore. È una scelta consapevolmente provvisoria: due occasioni
// "Altro" con descrizione diversa restano momenti distinti, due con la
// stessa descrizione (a meno di spazi) collassano nello stesso momento.
// EVOLUZIONE FUTURA: introdurre in A/B/C un identificativo stabile del
// momento/ciclo PPU (`ppuCycleId` o equivalente) così che l'identità
// temporale non dipenda più da testo libero. In questo intervento NON si
// modificano A/B/C: la nota resta qui come promemoria.

// Riuso puro dal model della Scheda C (nessun Firebase / DOM): serve alla
// ricostruzione leggibile degli elementi di origine di rete (Passo 4).
import {
  CENTER_ID, distanzaDalCentro, labelQualita, labelDirezione, simboloDirezione,
} from './ppu-scheda-c-model.js';

// ── I sei pilastri PPU (id identici alle aree delle Schede A e B) ────────
export const PILASTRI = [
  { id: 'self',        ordine: 1, nome: 'Io con me stesso' },
  { id: 'others',      ordine: 2, nome: 'Io e gli altri' },
  { id: 'environment', ordine: 3, nome: 'Io e l’ambiente' },
  { id: 'future',      ordine: 4, nome: 'Io e il futuro' },
  { id: 'expression',  ordine: 5, nome: 'Espressione e creatività' },
  { id: 'wellbeing',   ordine: 6, nome: 'Benessere e cura' },
];
export const PILASTRI_ID = PILASTRI.map(p => p.id);

// ── Costrutto osservato da ciascun indicatore (id stabili self_01…wellbeing_03) ──
// Oggi in js/ppu-scheda-a.js questi costrutti vivono solo come commenti sopra
// ogni domanda: qui diventano dato, per poterli passare al modello e per
// validare i riferimenti di tracciabilità. Non modificano A/B.
export const COSTRUTTI = {
  self_01: 'riconoscere le proprie emozioni forti e comunicarle',
  self_02: 'gestire la propria reazione a rabbia, delusione o provocazione',
  self_03: 'chiedere aiuto quando si è in difficoltà',
  others_01: 'entrare in relazione e stare con coetanei e adulti',
  others_02: 'collaborare a un compito comune',
  others_03: 'affrontare un conflitto senza rompere la relazione',
  environment_01: 'rispetto e cura delle proprie cose e degli spazi e oggetti comuni',
  environment_02: 'portare a termine un incarico affidato',
  environment_03: 'prendersi cura di qualcosa che non riguarda soltanto sé, anche senza un ordine',
  future_01: 'immaginare qualcosa che si vorrebbe fare, raggiungere o diventare',
  future_02: 'decidere tenendo conto di cosa potrebbe succedere dopo',
  future_03: 'portare avanti nel tempo un impegno preso',
  expression_01: 'riconoscere cosa piace, cosa interessa e in cosa ci si sente capaci',
  expression_02: 'trovare un modo per esprimere ciò che si pensa, si prova o interessa',
  expression_03: 'provare attività o esperienze nuove anche senza sapere se si sarà capaci',
  wellbeing_01: 'prendersi cura di sé e delle proprie necessità quotidiane',
  wellbeing_02: 'accorgersi di quando si è stanchi, stressati o non si sta bene',
  wellbeing_03: 'quando non si sta bene, fare qualcosa che aiuta o rivolgersi a qualcuno',
};

export const TOTALE_INDICATORI = Object.keys(COSTRUTTI).length; // 18

// Le tre domande aperte di chiusura della Scheda A: risposte del ragazzo,
// quindi ammesse come fonti (a differenza delle areaNotes dell'educatore).
export const CLOSING_IDS = ['perceivedStrength', 'desiredImprovement', 'chosenGrowthArea'];

export function costrutto(indicatorId) {
  return COSTRUTTI[indicatorId] || null;
}

export function pilastroDiIndicatore(indicatorId) {
  const m = String(indicatorId || '').match(/^([a-z]+)_\d{2}$/);
  return m && PILASTRI_ID.includes(m[1]) ? m[1] : null;
}

export function elencaIndicatoriPilastro(pilastroId) {
  return Object.keys(COSTRUTTI).filter(id => pilastroDiIndicatore(id) === pilastroId);
}

// ── Momenti del percorso PPU (identici a Scheda A / B / C) ───────────────
export const MOMENTI_PPU = [
  { value: 'ingresso',            label: 'Ingresso' },
  { value: 'verifica_3_mesi',     label: 'Verifica 3 mesi' },
  { value: 'verifica_6_mesi',     label: 'Verifica 6 mesi' },
  { value: 'verifica_intermedia', label: 'Verifica intermedia' },
  { value: 'uscita',              label: 'Uscita' },
  { value: 'altro',               label: 'Altro' },
];

export function labelMomento(value) {
  const m = MOMENTI_PPU.find(x => x.value === value);
  return m ? m.label : (value ? String(value) : '');
}

// Ordine cronologico convenzionale usato per elencare i momenti; 'altro' e
// i valori sconosciuti vanno in fondo.
export function ordineMomento(value) {
  if (value === 'altro') return 100;
  const i = MOMENTI_PPU.findIndex(x => x.value === value && x.value !== 'altro');
  return i === -1 ? 99 : i;
}

export function descriviMomento(ppuMoment, ppuMomentNote = '') {
  if (ppuMoment === 'altro') return String(ppuMomentNote || '').trim() || 'Altro';
  return labelMomento(ppuMoment);
}

// ── Etichette leggibili delle tre schede fonte ──────────────────────────
export const LABEL_SCHEDE = {
  A: 'Scheda A — Come mi vedo',
  B: 'Scheda B — Come penso che mi vedano gli altri',
  C: 'Scheda C — Le persone intorno a me',
};

// ── Stati logici della Scheda D ────────────────────────────────────────
export const STATI_SCHEDA_D = [
  'NON_GENERABILE', // manca A, B oppure C completata per quel momento
  'DA_GENERARE',    // A, B e C completate presenti, nessuna D ancora generata
  'GENERATA',       // la sintesi AI esiste, non ancora validata dall'équipe
  'IN_RILETTURA',   // l'équipe sta integrando la sintesi
  'VALIDATA',       // rilettura conclusa: fotografia educativa del momento
];

// Stati che un documento `ppu_schede_d` può effettivamente avere salvato.
export const STATI_D_PERSISTITI = ['GENERATA', 'IN_RILETTURA', 'VALIDATA'];

// Transizioni ammesse fra stati persistiti (usate poi dall'interfaccia).
export const TRANSIZIONI_D = {
  GENERATA:     ['IN_RILETTURA', 'VALIDATA'],
  IN_RILETTURA: ['VALIDATA'],
  VALIDATA:     [],
};

export function statoSchedaDValido(stato) {
  return STATI_D_PERSISTITI.includes(stato);
}

export function puoTransire(da, a) {
  return Array.isArray(TRANSIZIONI_D[da]) && TRANSIZIONI_D[da].includes(a);
}

// ── Campi ammessi nel payload verso il modello AI (allowlist esplicita) ──
// Usata nel Passo 2 (costruzione del payload nella Cloud Function). Elencata
// qui perché è una regola di dominio, non un dettaglio di trasporto.
//   A: solo le risposte numeriche + le 3 domande aperte di chiusura
//   B: solo le risposte numeriche
//   C: solo i sociogrammi (nodi: name/distance/note; archi: direction/quality)
// In nessun caso: areaNotes (A/B), annotazioni libere dell'educatore,
// `note` generale della Scheda C, o qualsiasi dato fuori da A/B/C.
export const CAMPI_PAYLOAD_AMMESSI = {
  A: ['risposte', 'closing'],
  B: ['risposte'],
  C: ['sociogrammi'],
};

// Versione del prompt/di questo schema di output: da salvare in ogni D
// generata per poter confrontare in futuro sintesi prodotte con prompt
// diversi.
export const PROMPT_VERSION = 1;

// Nota metodologica: testo FISSO, aggiunto dal codice (non dal modello) in
// coda alla sintesi generale di ogni Scheda D.
export const NOTA_METODOLOGICA =
  'Questa sintesi è generata attraverso l’elaborazione delle risposte contenute ' +
  'nelle Schede A, B e C. Non costituisce una valutazione diagnostica né sostituisce ' +
  'l’osservazione professionale. Le ipotesi formulate devono essere confrontate con ' +
  'la storia educativa del ragazzo, con l’osservazione dell’équipe e con il dialogo ' +
  'con il ragazzo stesso.';

// ── Timestamp: normalizzazione a millisecondi ──────────────────────────
// Accetta numero (ms), Date, stringa ISO, Firestore Timestamp (SDK client
// con toMillis()/toDate(), oppure forma serializzata { seconds, nanoseconds }
// / { _seconds, _nanoseconds }). Restituisce Number oppure null.
export function tsMillis(v) {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (v instanceof Date) { const t = v.getTime(); return isNaN(t) ? null : t; }
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? null : t; }
  if (typeof v === 'object') {
    if (typeof v.toMillis === 'function') { try { const t = v.toMillis(); if (typeof t === 'number') return t; } catch (_) {} }
    if (typeof v.toDate === 'function') { try { const d = v.toDate(); if (d instanceof Date) return d.getTime(); } catch (_) {} }
    const secs = typeof v.seconds === 'number' ? v.seconds
      : typeof v._seconds === 'number' ? v._seconds : null;
    if (secs != null) {
      const ns = typeof v.nanoseconds === 'number' ? v.nanoseconds
        : typeof v._nanoseconds === 'number' ? v._nanoseconds : 0;
      return secs * 1000 + Math.floor(ns / 1e6);
    }
  }
  return null;
}

// Timestamp di riferimento per la "recenza" di una scheda A/B/C: si usa il
// criterio temporale già presente nell'architettura, con fallback in ordine
// di affidabilità decrescente.
export function tsRecenza(scheda) {
  return tsMillis(scheda?.completedAt)
    ?? tsMillis(scheda?.updatedAt)
    ?? tsMillis(scheda?.assessmentDate)
    ?? tsMillis(scheda?.createdAt)
    ?? 0;
}

// ── Selezione della compilazione `completata` più recente ───────────────
export function piuRecenteCompletata(schede) {
  const completate = (Array.isArray(schede) ? schede : [])
    .filter(s => s && s.status === 'completata');
  if (!completate.length) return null;
  // sort discendente per recenza; V8 usa un ordinamento stabile, quindi a
  // parità di timestamp resta la prima nell'ordine di partenza.
  return completate.slice().sort((x, y) => tsRecenza(y) - tsRecenza(x))[0];
}

// ── Chiave del momento (gestione speciale di 'altro') ───────────────────
export function chiaveMomento(scheda) {
  const m = scheda && scheda.ppuMoment ? String(scheda.ppuMoment) : '';
  if (!m) return null;
  if (m === 'altro') return 'altro:' + String(scheda.ppuMomentNote || '').trim();
  return m;
}

// ── Raggruppamento A/B/C per momento ───────────────────────────────────
// Restituisce un array di gruppi, uno per ciascun momento in cui esiste
// almeno una scheda `completata`. Per ogni gruppo indica la A/B/C più
// recente disponibile (o null), se è generabile e quali fonti mancano.
export function raggruppaFontiPerMomento(listaA = [], listaB = [], listaC = []) {
  const perChiave = new Map(); // chiave -> { A:[], B:[], C:[] }
  const raccogli = (lista, key) => {
    for (const s of (Array.isArray(lista) ? lista : [])) {
      if (!s || s.status !== 'completata') continue;
      const k = chiaveMomento(s);
      if (k === null) continue; // scheda completata senza momento: non attribuibile
      if (!perChiave.has(k)) perChiave.set(k, { A: [], B: [], C: [] });
      perChiave.get(k)[key].push(s);
    }
  };
  raccogli(listaA, 'A');
  raccogli(listaB, 'B');
  raccogli(listaC, 'C');

  const gruppi = [];
  for (const [chiave, bucket] of perChiave) {
    const a = piuRecenteCompletata(bucket.A);
    const b = piuRecenteCompletata(bucket.B);
    const c = piuRecenteCompletata(bucket.C);
    const rappr = a || b || c;
    const ppuMoment = rappr
      ? rappr.ppuMoment
      : (chiave.startsWith('altro:') ? 'altro' : chiave);
    const ppuMomentNote = ppuMoment === 'altro'
      ? (rappr && rappr.ppuMomentNote != null
          ? String(rappr.ppuMomentNote).trim()
          : chiave.slice('altro:'.length))
      : '';
    const mancanti = [];
    if (!a) mancanti.push('A');
    if (!b) mancanti.push('B');
    if (!c) mancanti.push('C');
    gruppi.push({
      chiave,
      ppuMoment,
      ppuMomentNote,
      label: descriviMomento(ppuMoment, ppuMomentNote),
      a, b, c,
      generabile: mancanti.length === 0,
      mancanti,
    });
  }

  gruppi.sort((g1, g2) => {
    const d = ordineMomento(g1.ppuMoment) - ordineMomento(g2.ppuMoment);
    return d !== 0 ? d : g1.chiave.localeCompare(g2.chiave, 'it');
  });
  return gruppi;
}

// Messaggio parlante per un gruppo non generabile (fonti mancanti).
export function descriviMancanti(gruppo) {
  if (!gruppo || !Array.isArray(gruppo.mancanti) || !gruppo.mancanti.length) return '';
  const nomi = gruppo.mancanti.map(k => LABEL_SCHEDE[k] || k);
  if (nomi.length === 1) {
    return `Scheda D non ancora generabile. Per il momento «${gruppo.label}» manca la ${nomi[0]}.`;
  }
  return `Scheda D non ancora generabile. Per il momento «${gruppo.label}» mancano: ${nomi.join('; ')}.`;
}

// ── Stato di un momento, dati i suoi eventuali documenti D già esistenti ──
export function filtraSchedeDPerMomento(schedeD, ppuMoment, ppuMomentNote = '') {
  const noteNorm = String(ppuMomentNote || '').trim();
  return (Array.isArray(schedeD) ? schedeD : []).filter(d => {
    if (!d) return false;
    if (d.ppuMoment !== ppuMoment) return false;
    if (ppuMoment === 'altro') return String(d.ppuMomentNote || '').trim() === noteNorm;
    return true;
  });
}

export function statoMomento(gruppo, schedeDMomento = []) {
  if (!gruppo || !gruppo.generabile) return 'NON_GENERABILE';
  const ds = (Array.isArray(schedeDMomento) ? schedeDMomento : []).filter(Boolean);
  if (!ds.length) return 'DA_GENERARE';
  const piuRecente = ds.slice().sort((x, y) =>
    (tsMillis(y.generatedAt) ?? tsMillis(y.createdAt) ?? 0) -
    (tsMillis(x.generatedAt) ?? tsMillis(x.createdAt) ?? 0)
  )[0];
  return statoSchedaDValido(piuRecente.stato) ? piuRecente.stato : 'GENERATA';
}

// ── Helper di tracciabilità ────────────────────────────────────────────
export const SCHEDE_FONTE = ['A', 'B', 'C'];

// Costruisce un riferimento di fonte normalizzato per un'osservazione AI.
// Per A/B: elementoId è tipicamente un indicator_id (o un CLOSING_ID);
// per C: elementoId è il nome di una persona o della coppia collegata.
export function rifFonte({ scheda, pilastro, elementoId, valore = null, testo = '' } = {}) {
  if (!SCHEDE_FONTE.includes(scheda)) throw new Error(`Scheda fonte non valida: ${scheda}`);
  if (!PILASTRI_ID.includes(pilastro)) throw new Error(`Pilastro non valido: ${pilastro}`);
  const id = String(elementoId == null ? '' : elementoId).trim();
  if (!id) throw new Error('elementoId mancante nel riferimento di fonte.');
  return { scheda, pilastro, elementoId: id, valore: valore ?? null, testo: String(testo || '') };
}

export function validaRiferimentoFonte(rif) {
  if (!rif || typeof rif !== 'object' || Array.isArray(rif)) return ['non è un oggetto.'];
  const errori = [];
  if (!SCHEDE_FONTE.includes(rif.scheda)) errori.push(`scheda "${rif.scheda}" non è A/B/C.`);
  if (!PILASTRI_ID.includes(rif.pilastro)) errori.push(`pilastro "${rif.pilastro}" non valido.`);
  if (typeof rif.elementoId !== 'string' || !rif.elementoId.trim()) errori.push('elementoId mancante o vuoto.');
  return errori;
}

// Snapshot "congelato" delle fonti effettivamente usate, da salvare nella D.
export function riepilogoFonti(a, b, c) {
  const uno = s => (s ? {
    schedaId: s.id || null,
    completedAt: s.completedAt ?? null,
    assessmentDate: s.assessmentDate ?? null,
  } : null);
  return { a: uno(a), b: uno(b), c: uno(c) };
}

// Id delle tre fonti di un gruppo generabile (sourceAId/BId/CId della D).
export function idFonti(gruppo) {
  if (!gruppo || !gruppo.generabile) throw new Error('Gruppo non generabile: fonti incomplete.');
  return {
    sourceAId: gruppo.a.id || null,
    sourceBId: gruppo.b.id || null,
    sourceCId: gruppo.c.id || null,
  };
}

// ── Validazione strutturale dell'output del modello AI ──────────────────
// Restituisce un array di messaggi di errore (vuoto = output valido).
// Verifica SOLO la struttura/lo schema, non il merito delle affermazioni.
// La `notaMetodologica` NON è richiesta qui: la aggiunge il codice.
function isNonEmptyStr(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validaListaFonti(fonti, path, minimo = 0) {
  const e = [];
  if (!Array.isArray(fonti)) { e.push(`${path} deve essere un array.`); return e; }
  if (fonti.length < minimo) e.push(`${path} deve contenere almeno ${minimo} riferimento/i alle fonti.`);
  fonti.forEach((rif, i) => {
    validaRiferimentoFonte(rif).forEach(msg => e.push(`${path}[${i}] ${msg}`));
  });
  return e;
}

export function validaOutputAI(json) {
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
      if (p.pilastro !== atteso) {
        e.push(`pilastri[${i}].pilastro = "${p.pilastro}", atteso "${atteso}" (ordine canonico).`);
      }
      for (const campo of ['comeMiVedo', 'comeMiVedonoGliAltri', 'elementiRete',
        'letturaEducativaPossibile', 'aspettoDaApprofondire']) {
        if (!isNonEmptyStr(p[campo])) e.push(`pilastri[${i}].${campo} mancante o vuoto.`);
      }
      const cd = p.convergenzeDiscrepanze;
      if (!cd || typeof cd !== 'object' || Array.isArray(cd)) {
        e.push(`pilastri[${i}].convergenzeDiscrepanze mancante.`);
      } else {
        for (const campo of ['convergenze', 'discrepanze', 'datiInsufficienti']) {
          if (typeof cd[campo] !== 'string') {
            e.push(`pilastri[${i}].convergenzeDiscrepanze.${campo} deve essere una stringa.`);
          }
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
      if (!Array.isArray(arr)) { e.push(`letturaTrasversale.${campo} deve essere un array.`); continue; }
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

  return e;
}

export function outputAIValido(json) {
  return validaOutputAI(json).length === 0;
}

// Controlli di coerenza NON bloccanti sui riferimenti di fonte (avvisi):
// un ref A/B che cita un id non riconoscibile come indicatore/chiusura, o un
// indicatore attribuito al pilastro sbagliato, è quasi sempre un errore del
// modello. Tenuto separato da validaOutputAI per non rifiutare output per
// sole imperfezioni di citazione.
export function analizzaCoerenzaFonti(json) {
  const w = [];
  const controlla = (rif, path) => {
    if (!rif || typeof rif !== 'object') return;
    if ((rif.scheda === 'A' || rif.scheda === 'B') && typeof rif.elementoId === 'string') {
      const id = rif.elementoId.trim();
      if (/^[a-z]+_\d{2}$/.test(id)) {
        if (!(id in COSTRUTTI)) {
          w.push(`${path}: elementoId "${id}" non è un indicatore PPU noto.`);
        } else if (pilastroDiIndicatore(id) !== rif.pilastro) {
          w.push(`${path}: indicatore "${id}" non appartiene al pilastro "${rif.pilastro}".`);
        }
      } else if (!CLOSING_IDS.includes(id)) {
        w.push(`${path}: riferimento ${rif.scheda} "${id}" non è né un indicatore né una domanda di chiusura.`);
      }
    }
  };
  const pil = Array.isArray(json?.pilastri) ? json.pilastri : [];
  pil.forEach((p, i) => {
    (Array.isArray(p?.fonti) ? p.fonti : []).forEach((r, j) => controlla(r, `pilastri[${i}].fonti[${j}]`));
  });
  const lt = json?.letturaTrasversale;
  if (lt && typeof lt === 'object') {
    for (const campo of ['risorse', 'aspettiAttenzione', 'elementiDaApprofondire']) {
      (Array.isArray(lt[campo]) ? lt[campo] : []).forEach((it, i) => {
        (Array.isArray(it?.fonti) ? it.fonti : []).forEach((r, j) =>
          controlla(r, `letturaTrasversale.${campo}[${i}].fonti[${j}]`));
      });
    }
  }
  return w;
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 4 — logica pura per l'interfaccia di consultazione
//  (raggruppamento momenti per la UI, versioni D, confronto con le fonti
//  congelate, ricostruzione degli "elementi di origine", messaggi d'errore
//  leggibili, rendering del documento). Tutto puro: nessun Firebase, nessun
//  DOM. js/ppu-scheda-d.js aggiunge solo caricamento dati + wiring eventi.
// ═══════════════════════════════════════════════════════════════════════

// ── Ordina un elenco di Schede D dalla più recente alla più vecchia ────
export function ordinaSchedeDPerGenerazione(list) {
  return (Array.isArray(list) ? list.slice() : []).sort((x, y) =>
    (tsMillis(y && (y.generatedAt ?? y.createdAt)) ?? 0) -
    (tsMillis(x && (x.generatedAt ?? x.createdAt)) ?? 0));
}

// ── Stato da mostrare sulla riga di un momento ────────────────────────
// Con almeno una D → stato della D più recente ('GENERATA'|'IN_RILETTURA'|
// 'VALIDATA'). Senza D → 'NON_GENERABILE' oppure 'DA_GENERARE' in base alla
// disponibilità della terna A+B+C.
export function statoRigaMomento(gruppo, schedeDMomento) {
  const ds = ordinaSchedeDPerGenerazione(schedeDMomento);
  if (ds.length) {
    const s = ds[0] && ds[0].stato;
    return statoSchedaDValido(s) ? s : 'GENERATA';
  }
  if (!gruppo || !gruppo.generabile) return 'NON_GENERABILE';
  return 'DA_GENERARE';
}

// ── Confronto tra le fonti CONGELATE in una D e la terna attuale ──────
// Restituisce le lettere (A/B/C) per cui esiste ORA una compilazione
// `completata` più recente di quella usata nella D (id diverso ∧ timestamp
// successivo). Serve al messaggio "Sono disponibili dati più recenti".
export function confrontaFontiConGruppo(schedaD, gruppo) {
  const piuRecenti = [];
  if (schedaD && gruppo) {
    for (const [k, tipo] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) {
      const corrente = gruppo[k];
      if (!corrente) continue;
      const frozenId = schedaD['source' + tipo + 'Id'];
      const frozenTs = tsMillis(schedaD.fonti && schedaD.fonti[k] && schedaD.fonti[k].completedAt);
      const currTs = tsRecenza(corrente);
      const idDiverso = corrente.id && frozenId && corrente.id !== frozenId;
      if (idDiverso && (frozenTs == null || currTs == null || currTs > frozenTs)) {
        piuRecenti.push(tipo);
      }
    }
  }
  return { piuRecenti, haNovita: piuRecenti.length > 0 };
}

// ── Righe della schermata "momenti PPU" per un ragazzo ────────────────
// Unione dei momenti che hanno almeno una A/B/C `completata` (dai `gruppi`
// di raggruppaFontiPerMomento) e dei momenti che hanno almeno una D salvata.
// Ogni riga: fonti disponibili, stato, versioni D ordinate, novità fonti.
export function elencaMomenti(gruppi = [], schedeD = []) {
  const map = new Map();
  for (const g of (Array.isArray(gruppi) ? gruppi : [])) {
    map.set(g.chiave, {
      chiave: g.chiave, ppuMoment: g.ppuMoment, ppuMomentNote: g.ppuMomentNote,
      label: g.label, gruppo: g, schedeD: [],
    });
  }
  for (const d of (Array.isArray(schedeD) ? schedeD : [])) {
    if (!d || !d.ppuMoment) continue;
    const k = chiaveMomento(d);
    if (k === null) continue;
    if (!map.has(k)) {
      map.set(k, {
        chiave: k, ppuMoment: d.ppuMoment,
        ppuMomentNote: d.ppuMoment === 'altro' ? String(d.ppuMomentNote || '').trim() : '',
        label: descriviMomento(d.ppuMoment, d.ppuMomentNote),
        gruppo: null, schedeD: [],
      });
    }
    map.get(k).schedeD.push(d);
  }
  const righe = [];
  for (const r of map.values()) {
    r.schedeD = ordinaSchedeDPerGenerazione(r.schedeD);
    r.stato = statoRigaMomento(r.gruppo, r.schedeD);
    r.generabile = !!(r.gruppo && r.gruppo.generabile);
    r.mancanti = r.gruppo ? r.gruppo.mancanti.slice() : ['A', 'B', 'C'];
    r.fonti = {
      A: r.gruppo && r.gruppo.a ? 'completata' : 'mancante',
      B: r.gruppo && r.gruppo.b ? 'completata' : 'mancante',
      C: r.gruppo && r.gruppo.c ? 'completata' : 'mancante',
    };
    r.latestD = r.schedeD[0] || null;
    r.novita = (r.gruppo && r.latestD)
      ? confrontaFontiConGruppo(r.latestD, r.gruppo)
      : { piuRecenti: [], haNovita: false };
    righe.push(r);
  }
  righe.sort((a, b) => {
    const d = ordineMomento(a.ppuMoment) - ordineMomento(b.ppuMoment);
    return d !== 0 ? d : String(a.chiave).localeCompare(String(b.chiave), 'it');
  });
  return righe;
}

// ── Messaggio d'errore leggibile per la generazione (da HttpsError) ──
// Nessuno stack trace, nessun codice interno, nessun dato tecnico.
export function messaggioErroreGenerazione(err) {
  const code = String((err && err.code) || '').replace(/^functions\//, '');
  const msg = err && err.message ? String(err.message) : '';
  switch (code) {
    case 'unauthenticated':
      return 'La sessione è scaduta. Ricarica la pagina ed effettua di nuovo l’accesso.';
    case 'permission-denied':
      return 'Non hai i permessi per generare la sintesi in questa comunità.';
    case 'failed-precondition':
      return msg || 'Per questo momento manca una o più schede tra A, B e C.';
    case 'aborted':
      return 'Una generazione per questo momento è già in corso. Attendi qualche istante e riprova.';
    case 'unavailable':
      return 'Il servizio di generazione non è al momento disponibile. Riprova più tardi.';
    case 'deadline-exceeded':
      return 'La generazione sta richiedendo più tempo del previsto e potrebbe essere ancora in corso. Ricarica la pagina tra un minuto per verificare se la sintesi è stata creata, prima di rigenerare.';
    case 'invalid-argument':
      return msg || 'I dati inviati non sono validi.';
    case 'internal':
      return /controlli di coerenza/i.test(msg)
        ? msg
        : 'Si è verificato un errore durante l’elaborazione. Nessun dato è stato salvato. Puoi riprovare.';
    default:
      return 'Si è verificato un errore imprevisto. Riprova più tardi.';
  }
}

// ── Ricostruzione di un "elemento di origine" ─────────────────────────
// `rif`  = { scheda:'A'|'B'|'C', pilastro, elementoId }  (da contenutoAI.*.fonti)
// `ctx`  = {
//   schedaA, schedaB, schedaC,   // i DOCUMENTI CONGELATI (sourceAId/BId/CId),
//                                 // NON la versione più recente. null se non
//                                 // più disponibili.
//   domandaA, opzioniA,          // mappe indicatorId -> testo (da AREE_PPU di A)
//   domandaB, opzioniB,          // idem per B
//   chiusuraA,                   // mappa closingId -> testo domanda (da A)
// }
// Restituisce un oggetto descrittivo pronto per la vista; in caso di fonte
// non ricostruibile, un oggetto con `errore` (stringa leggibile).
export function ricostruisciFonte(rif, ctx = {}) {
  const scheda = rif && rif.scheda;
  const base = { scheda, schedaLabel: LABEL_SCHEDE[scheda] || '', pilastro: rif && rif.pilastro };
  if (!rif || !SCHEDE_FONTE.includes(scheda) || typeof rif.elementoId !== 'string' || !rif.elementoId.trim()) {
    return { ...base, errore: 'Riferimento di origine non valido.' };
  }
  const id = rif.elementoId.trim();

  if (scheda === 'A' || scheda === 'B') {
    const docFonte = scheda === 'A' ? ctx.schedaA : ctx.schedaB;
    if (!docFonte) return { ...base, errore: `La Scheda ${scheda} di origine non è più disponibile.` };

    // Domanda aperta di chiusura (solo Scheda A)
    if (scheda === 'A' && CLOSING_IDS.includes(id)) {
      const raw = docFonte.closing && typeof docFonte.closing[id] === 'string' ? docFonte.closing[id].trim() : '';
      return {
        ...base, tipo: 'chiusura', chiusuraId: id,
        domanda: (ctx.chiusuraA && ctx.chiusuraA[id]) || id,
        risposta: raw || null,
      };
    }

    // Indicatore
    if (!/^[a-z]+_\d{2}$/.test(id) || !(id in COSTRUTTI)) {
      return { ...base, errore: `Indicatore di origine non riconosciuto (${id}).` };
    }
    const domanda = scheda === 'A' ? (ctx.domandaA || {})[id] : (ctx.domandaB || {})[id];
    const opz = scheda === 'A' ? (ctx.opzioniA || {})[id] : (ctx.opzioniB || {})[id];
    const v = docFonte.risposte ? docFonte.risposte[id] : undefined;
    let testoRisposta = null;
    if (v === 'NO') testoRisposta = opz ? (opz.NO ?? opz['NO'] ?? null) : null;
    else if (typeof v === 'number') testoRisposta = opz ? (opz[String(v)] ?? null) : null;
    return {
      ...base, tipo: 'indicatore', indicatorId: id, costrutto: COSTRUTTI[id],
      domanda: domanda || null,
      valore: v === undefined ? null : v,
      testoRisposta,
    };
  }

  // Scheda C — rete
  if (!ctx.schedaC) return { ...base, errore: 'La Scheda C di origine non è più disponibile.' };
  const m = id.match(/^(vicinanza|fatica):(persona|legame):(.+)$/);
  if (!m) return { ...base, errore: 'Riferimento alla rete di origine non riconosciuto.' };
  const rete = m[1], kind = m[2], elId = m[3];
  const socio = (ctx.schedaC.sociogrammi || {})[rete] || {};
  const nodi = Array.isArray(socio.nodes) ? socio.nodes : [];
  const nomeNodo = (nid) => {
    if (String(nid) === CENTER_ID) return 'IO';
    const n = nodi.find(x => x && String(x.id) === String(nid));
    return n ? (n.name || '—') : '—';
  };

  if (kind === 'persona') {
    const n = nodi.find(x => x && String(x.id) === elId);
    if (!n) return { ...base, tipo: 'rete', rete, kind, errore: 'La persona indicata non è più presente nella rete.' };
    const dist = (typeof n.distance === 'number' && isFinite(n.distance))
      ? Math.round(Math.min(1, Math.max(0, n.distance)) * 1000) / 1000
      : distanzaDalCentro(n);
    return {
      ...base, tipo: 'rete', rete, kind: 'persona',
      nome: (String(n.id) === CENTER_ID || n.isCenter) ? 'IO' : (n.name || '—'),
      distanza: dist,
      informazioneUsata: 'distanza dal centro',
    };
  }

  const e = Array.isArray(socio.edges) ? socio.edges.find(x => x && String(x.id) === elId) : null;
  if (!e) return { ...base, tipo: 'rete', rete, kind, errore: 'Il legame indicato non è più presente nella rete.' };
  return {
    ...base, tipo: 'rete', rete, kind: 'legame',
    da: nomeNodo(e.source), a: nomeNodo(e.target),
    simbolo: simboloDirezione(e.direction),
    direzione: labelDirezione(e.direction) || 'non specificata',
    qualita: labelQualita(e.quality) || 'non specificata',
    informazioneUsata: 'direzione e qualità del legame',
  };
}

// ── Rendering del documento Scheda D (stringa HTML, puro) ─────────────
// Titoli di sezione esposti come costanti per i test.
export const TITOLI_D = {
  documento: 'Sintesi educativa integrata',
  sintesi: 'SINTESI DEL PROFILO EMERSO',
  trasversale: 'ELEMENTI PER IL CONFRONTO DELL’ÉQUIPE EDUCATIVA',
  letturaAI: 'LETTURA EDUCATIVA POSSIBILE',
  rilettura: 'RILETTURA DELL’ÉQUIPE EDUCATIVA',
};
export const ETICHETTE_STATO_D = {
  GENERATA: 'Generata',
  IN_RILETTURA: 'In rilettura',
  VALIDATA: 'Validata',
};
const CAMPI_PILASTRO = [
  ['comeMiVedo', 'Ciò che emerge da «Come mi vedo»'],
  ['comeMiVedonoGliAltri', 'Come penso che mi vedano gli altri'],
  ['elementiRete', 'Elementi della rete collegati'],
];
const CAMPI_CONVERGENZE = [
  ['convergenze', 'Convergenze'],
  ['discrepanze', 'Discrepanze'],
  ['datiInsufficienti', 'Dati insufficienti / aspetti non leggibili'],
];
const SOTTOSEZIONI_TRASVERSALE = [
  ['risorse', 'Risorse sulle quali fare leva'],
  ['aspettiAttenzione', 'Aspetti che meritano attenzione'],
  ['elementiDaApprofondire', 'Elementi da approfondire'],
];

// ── PASSO 5 — Rilettura dell'équipe: costanti ─────────────────────────
export const VALUTAZIONI_RILETTURA = [
  { id: 'conferma',        label: 'Conferma',        ux: 'L’équipe ritrova questo elemento nell’osservazione educativa.' },
  { id: 'integra',         label: 'Integra',         ux: 'L’elemento è utile ma richiede precisazioni o informazioni aggiuntive.' },
  { id: 'non_riscontra',   label: 'Non riscontra',   ux: 'L’équipe non ritrova questo elemento nella propria osservazione.' },
  { id: 'da_approfondire', label: 'Da approfondire', ux: 'Non ci sono ancora elementi sufficienti per assumere una posizione.' },
];
export const VALUTAZIONI_RILETTURA_ID = VALUTAZIONI_RILETTURA.map(v => v.id);
export const LIMITI_RILETTURA = { osservazione: 2000, osservazioniGenerali: 5000 };
const ETICHETTE_CAMPO_RILETTURA = {
  letturaEducativaPossibile: 'Lettura educativa possibile',
  aspettoDaApprofondire: 'Aspetto da approfondire con l’équipe',
};
// Chiavi ammesse nell'oggetto `rilettura` (nessun campo parallelo).
const CHIAVI_RILETTURA_TOP = ['ipotesi', 'osservazioniGenerali', 'riletturaBy', 'riletturaAt'];

export function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

export function formatDataD(ts) {
  const ms = tsMillis(ts);
  if (ms == null) return '—';
  try {
    return new Date(ms).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (_) {
    return new Date(ms).toISOString().slice(0, 10);
  }
}
const fmtDataIT = formatDataD;

function paragrafo(txt) {
  const t = String(txt == null ? '' : txt).trim();
  if (!t) return '<p class="ppud-vuoto">—</p>';
  return t.split(/\n{2,}/).map(p => `<p>${escHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function bottoneFonti(chiave, fonti) {
  if (!Array.isArray(fonti) || !fonti.length) return '';
  return `<button type="button" class="ppud-fonti-btn" data-ppud-fonti="${escHtml(chiave)}" aria-expanded="false">Mostra elementi di origine</button>`
    + `<div class="ppud-fonti-pan" data-ppud-fonti-pan="${escHtml(chiave)}" hidden></div>`;
}

// ── Toggle "Mostra / Nascondi elementi di origine": vero toggle bidirezionale ──
// Stato derivato SOLO da aria-expanded del bottone. Nessun accesso a Firestore
// o all'AI: `giaCaricato` indica che il pannello ha già i dati in memoria, per
// cui alla riapertura si riusano senza rileggere nulla.
export const ETICHETTE_TOGGLE_FONTI = {
  chiuso: 'Mostra elementi di origine',
  aperto: 'Nascondi elementi di origine',
};

export function prossimoStatoToggleFonti({ apertoOra = false, giaCaricato = false } = {}) {
  const aperto = !apertoOra;
  return {
    aperto,
    hidden: !aperto,
    ariaExpanded: aperto ? 'true' : 'false',
    etichetta: aperto ? ETICHETTE_TOGGLE_FONTI.aperto : ETICHETTE_TOGGLE_FONTI.chiuso,
    deveCaricare: aperto && !giaCaricato,
  };
}

// Blocco HTML per un singolo elemento di origine ricostruito.
export function renderFonteHTML(f) {
  if (!f || typeof f !== 'object') return '';
  const cap = `<div class="ppud-fonte-cap">Fonte: ${escHtml(f.schedaLabel || (LABEL_SCHEDE[f.scheda] || f.scheda || ''))}</div>`;
  if (f.errore) {
    return `<div class="ppud-fonte">${cap}<div class="ppud-fonte-err">${escHtml(f.errore)}</div></div>`;
  }
  const righe = [];
  if (f.tipo === 'indicatore') {
    righe.push(`<div><span class="ppud-k">Indicatore</span><span class="ppud-v">${escHtml(f.indicatorId)}${f.costrutto ? ` — ${escHtml(f.costrutto)}` : ''}</span></div>`);
    righe.push(`<div><span class="ppud-k">Domanda</span><span class="ppud-v">${f.domanda ? escHtml(f.domanda) : '<em>testo non disponibile</em>'}</span></div>`);
    let r;
    if (f.valore === null || f.valore === undefined) r = 'nessuna risposta';
    else if (f.valore === 'NO') r = `N/O${f.testoRisposta ? ` — ${escHtml(f.testoRisposta)}` : ''}`;
    else r = `${escHtml(String(f.valore))}${f.testoRisposta ? ` — ${escHtml(f.testoRisposta)}` : ''}`;
    righe.push(`<div><span class="ppud-k">Risposta</span><span class="ppud-v">${r}</span></div>`);
  } else if (f.tipo === 'chiusura') {
    righe.push(`<div><span class="ppud-k">Domanda</span><span class="ppud-v">${escHtml(f.domanda || f.chiusuraId)}</span></div>`);
    righe.push(`<div><span class="ppud-k">Risposta</span><span class="ppud-v">${f.risposta ? escHtml(f.risposta) : 'nessuna risposta'}</span></div>`);
  } else if (f.tipo === 'rete') {
    righe.push(`<div><span class="ppud-k">Rete</span><span class="ppud-v">${f.rete === 'fatica' ? 'Fatica' : 'Vicinanza'}</span></div>`);
    if (f.kind === 'persona') {
      righe.push(`<div><span class="ppud-k">Persona</span><span class="ppud-v">${escHtml(f.nome || '—')}</span></div>`);
      righe.push(`<div><span class="ppud-k">Informazione utilizzata</span><span class="ppud-v">distanza dal centro${typeof f.distanza === 'number' ? ` (${f.distanza})` : ''}</span></div>`);
    } else {
      righe.push(`<div><span class="ppud-k">Legame</span><span class="ppud-v">${escHtml(f.da || '—')} ${escHtml(f.simbolo || '—')} ${escHtml(f.a || '—')}</span></div>`);
      righe.push(`<div><span class="ppud-k">Informazione utilizzata</span><span class="ppud-v">direzione (${escHtml(f.da || '—')} ${escHtml(f.simbolo || '—')} ${escHtml(f.a || '—')}) e qualità del legame (${escHtml(f.qualita)})</span></div>`);
    }
  }
  return `<div class="ppud-fonte">${cap}${righe.join('')}</div>`;
}

// HTML del pannello "elementi di origine" (lista di fonti già ricostruite).
export function renderFontiPannelloHTML(ricostruite) {
  const arr = Array.isArray(ricostruite) ? ricostruite : [];
  if (!arr.length) return '<div class="ppud-fonte-err">Nessun elemento di origine associato.</div>';
  return arr.map(renderFonteHTML).join('');
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 5 — Rilettura dell'équipe: logica pura + rendering
// ═══════════════════════════════════════════════════════════════════════

// Elenco DETERMINISTICO degli elementi interpretativi rileggibili: per ogni
// pilastro `letturaEducativaPossibile` e `aspettoDaApprofondire`, più ogni
// voce delle tre sottosezioni della lettura trasversale. Le discrepanze A/B
// NON sono incluse come elementi rileggibili a sé: restano descrizioni
// (scelta per una UI sostenibile in riunione — vedi report Passo 5).
export function elencaElementiRilettura(contenutoAI) {
  const c = contenutoAI && typeof contenutoAI === 'object' ? contenutoAI : {};
  const out = [];
  const pilArr = Array.isArray(c.pilastri) ? c.pilastri : [];
  for (const meta of PILASTRI) {
    const p = pilArr.find(x => x && x.pilastro === meta.id) || {};
    for (const campo of ['letturaEducativaPossibile', 'aspettoDaApprofondire']) {
      out.push({
        chiave: `pilastro.${meta.id}.${campo}`,
        gruppo: 'pilastro',
        pilastro: meta.id,
        pilastroNome: meta.nome,
        pilastroOrdine: meta.ordine,
        campo,
        etichetta: ETICHETTE_CAMPO_RILETTURA[campo],
        testoAI: typeof p[campo] === 'string' ? p[campo] : '',
      });
    }
  }
  const lt = c.letturaTrasversale && typeof c.letturaTrasversale === 'object' ? c.letturaTrasversale : {};
  for (const [sott, nome] of SOTTOSEZIONI_TRASVERSALE) {
    const arr = Array.isArray(lt[sott]) ? lt[sott] : [];
    arr.forEach((it, i) => {
      out.push({
        chiave: `trasversale.${sott}.${i}`,
        gruppo: 'trasversale',
        sottosezione: sott,
        sottosezioneNome: nome,
        indice: i,
        etichetta: `${nome} · elemento ${i + 1}`,
        testoAI: it && typeof it.testo === 'string' ? it.testo : '',
      });
    });
  }
  return out;
}

function chiaviRilettura(contenutoAI) {
  return new Set(elencaElementiRilettura(contenutoAI).map(e => e.chiave));
}

// true se la rilettura contiene almeno una valutazione, una osservazione per
// elemento, o osservazioni generali non vuote (vedi Passo 5, §12).
export function riletturaSignificativa(rilettura) {
  if (!rilettura || typeof rilettura !== 'object') return false;
  const ip = rilettura.ipotesi;
  if (ip && typeof ip === 'object' && !Array.isArray(ip)) {
    for (const v of Object.values(ip)) {
      if (v && (v.valutazione || (typeof v.osservazioni === 'string' && v.osservazioni.trim()))) return true;
    }
  }
  return typeof rilettura.osservazioniGenerali === 'string' && rilettura.osservazioniGenerali.trim().length > 0;
}

// Preserva gli UID già presenti, aggiunge quello corrente se assente.
// Non accetta UID arbitrari: il chiamante passa SOLO auth.uid.
export function mergeRiletturaBy(esistente, uid) {
  const base = Array.isArray(esistente) ? esistente.filter(u => typeof u === 'string' && u) : [];
  const set = base.slice();
  if (uid && typeof uid === 'string' && !set.includes(uid)) set.push(uid);
  return set;
}

// Validatore PURO della rilettura. Restituisce un array di messaggi di errore
// (vuoto = valida). `rilettura` null → valida (nessuna rilettura).
export function validaRiletturaEquipe(rilettura, contenutoAI) {
  const err = [];
  if (rilettura == null) return err;
  if (typeof rilettura !== 'object' || Array.isArray(rilettura)) return ['La rilettura non è un oggetto valido.'];
  for (const k of Object.keys(rilettura)) {
    if (!CHIAVI_RILETTURA_TOP.includes(k)) err.push(`Campo di rilettura non previsto: "${k}".`);
  }
  const ipotesi = rilettura.ipotesi;
  if (ipotesi != null) {
    if (typeof ipotesi !== 'object' || Array.isArray(ipotesi)) {
      err.push('"ipotesi" deve essere un oggetto.');
    } else {
      const ammesse = chiaviRilettura(contenutoAI);
      for (const [chiave, voce] of Object.entries(ipotesi)) {
        if (!ammesse.has(chiave)) { err.push(`Elemento di rilettura inesistente: "${chiave}".`); continue; }
        if (!voce || typeof voce !== 'object' || Array.isArray(voce)) {
          err.push(`"${chiave}" deve essere un oggetto { valutazione, osservazioni }.`);
          continue;
        }
        const extra = Object.keys(voce).filter(k => k !== 'valutazione' && k !== 'osservazioni');
        if (extra.length) err.push(`"${chiave}" contiene campi non previsti: ${extra.join(', ')}.`);
        if (voce.valutazione != null && !VALUTAZIONI_RILETTURA_ID.includes(voce.valutazione)) {
          err.push(`"${chiave}": valutazione "${voce.valutazione}" non ammessa.`);
        }
        if (voce.osservazioni != null) {
          if (typeof voce.osservazioni !== 'string') err.push(`"${chiave}": le osservazioni devono essere testo.`);
          else if (voce.osservazioni.length > LIMITI_RILETTURA.osservazione) {
            err.push(`"${chiave}": osservazioni oltre ${LIMITI_RILETTURA.osservazione} caratteri.`);
          }
        }
        if (voce.valutazione == null && !((voce.osservazioni || '').trim())) {
          err.push(`"${chiave}": voce vuota (né valutazione né osservazioni).`);
        }
      }
    }
  }
  const og = rilettura.osservazioniGenerali;
  if (og != null) {
    if (typeof og !== 'string') err.push('"osservazioniGenerali" deve essere testo.');
    else if (og.length > LIMITI_RILETTURA.osservazioniGenerali) {
      err.push(`"osservazioniGenerali" oltre ${LIMITI_RILETTURA.osservazioniGenerali} caratteri.`);
    }
  }
  const rb = rilettura.riletturaBy;
  if (rb != null && (!Array.isArray(rb) || rb.some(u => typeof u !== 'string'))) {
    err.push('"riletturaBy" deve essere un elenco di identificativi.');
  }
  return err;
}

// Costruisce il blocco `rilettura` (senza `riletturaAt`, aggiunto poi dalla UI
// con serverTimestamp) a partire dai valori grezzi raccolti dai controlli.
// Scarta le voci vuote e le chiavi non rileggibili.
export function costruisciRiletturaDaValori(
  { valori = {}, osservazioniGenerali = '', riletturaByEsistente = [], uid = null } = {},
  contenutoAI,
) {
  const ammesse = chiaviRilettura(contenutoAI);
  const ipotesi = {};
  for (const [chiave, v] of Object.entries(valori)) {
    if (!ammesse.has(chiave) || !v || typeof v !== 'object') continue;
    const valutazione = VALUTAZIONI_RILETTURA_ID.includes(v.valutazione) ? v.valutazione : null;
    const oss = typeof v.osservazioni === 'string' ? v.osservazioni.trim() : '';
    if (!valutazione && !oss) continue;
    const voce = {};
    if (valutazione) voce.valutazione = valutazione;
    if (oss) voce.osservazioni = oss;
    ipotesi[chiave] = voce;
  }
  return {
    ipotesi,
    osservazioniGenerali: typeof osservazioniGenerali === 'string' ? osservazioniGenerali.trim() : '',
    riletturaBy: mergeRiletturaBy(riletturaByEsistente, uid),
  };
}

// HTML della sezione "Rilettura dell'équipe". `opts`:
//   { modificabile: bool, validataInfo: { data, nome } | null }
// In sola lettura (modificabile=false) NON emette alcun controllo di form.
export function renderRiletturaHTML(schedaD, opts = {}) {
  const modificabile = !!opts.modificabile;
  const validataInfo = opts.validataInfo || null;
  const rilettura = (schedaD && schedaD.rilettura) || null;
  const ipotesi = (rilettura && rilettura.ipotesi && typeof rilettura.ipotesi === 'object' && !Array.isArray(rilettura.ipotesi))
    ? rilettura.ipotesi : {};
  const ogVal = (rilettura && typeof rilettura.osservazioniGenerali === 'string') ? rilettura.osservazioniGenerali : '';
  const elementi = elencaElementiRilettura(schedaD && schedaD.contenutoAI);

  const banner = validataInfo ? `
    <div class="ppud-ril-validata">
      <div class="ppud-ril-validata-tit">Scheda validata</div>
      <div>Validata il ${escHtml(validataInfo.data || '—')}</div>
      <div>Validata da ${escHtml(validataInfo.nome || 'un operatore dell’équipe')}</div>
    </div>` : '';

  const intro = `<p class="ppud-ril-intro">Questa sezione raccoglie il confronto professionale dell’équipe sulla sintesi generata dall’AI. Le valutazioni inserite non modificano il testo originario della sintesi.</p>`;

  const legenda = modificabile ? `
    <div class="ppud-ril-legenda">
      ${VALUTAZIONI_RILETTURA.map(v => `<div><strong>${escHtml(v.label)}</strong> — ${escHtml(v.ux)}</div>`).join('')}
    </div>` : '';

  const parti = [];
  let lastPil = null, trasvHeaderDone = false;
  for (const el of elementi) {
    if (el.gruppo === 'pilastro') {
      if (lastPil !== el.pilastro) {
        lastPil = el.pilastro;
        parti.push(`<h3 class="ppud-ril-grp">${el.pilastroOrdine}. ${escHtml(el.pilastroNome)}</h3>`);
      }
    } else if (el.gruppo === 'trasversale' && !trasvHeaderDone) {
      trasvHeaderDone = true;
      parti.push('<h3 class="ppud-ril-grp">Lettura trasversale</h3>');
    }
    parti.push(riletturaElementoHTML(el, ipotesi[el.chiave] || null, modificabile));
  }

  const og = modificabile
    ? `<label class="ppud-ril-obs-k" for="ril-og">Osservazioni generali dell’équipe</label>
       <textarea id="ril-og" class="ppud-ril-obs" rows="4" maxlength="${LIMITI_RILETTURA.osservazioniGenerali}" data-ril-og placeholder="Elementi trasversali che non riguardano una singola ipotesi.">${escHtml(ogVal)}</textarea>`
    : `<div class="ppud-ril-ro"><div><span class="ppud-k">Osservazioni generali</span><span class="ppud-v">${ogVal ? escHtml(ogVal) : '—'}</span></div></div>`;

  const azioni = modificabile ? `
    <div class="ppud-ril-azioni">
      <button type="button" class="ppud-btn-salva" data-ril-salva>Salva rilettura</button>
      <p class="ppud-ril-nota-valida">Con la validazione l’équipe conferma di aver preso visione della sintesi e della relativa rilettura. La Scheda D diventerà sola lettura e resterà come fotografia educativa di questo momento.</p>
      <button type="button" class="ppud-btn-valida" data-ril-valida>Valida scheda D</button>
      <div class="ppud-ril-status" data-ril-status hidden></div>
      <div class="ppud-ril-conferma" data-ril-conferma hidden>
        <p>Vuoi validare definitivamente questa Scheda D? Dopo la validazione non sarà più possibile modificarne la rilettura.</p>
        <div class="ppud-ril-conferma-btn">
          <button type="button" class="ppud-btn-ghost" data-ril-annulla>Annulla</button>
          <button type="button" class="ppud-btn-valida-def" data-ril-valida-def>Valida definitivamente</button>
        </div>
      </div>
    </div>` : '';

  return `
    <section class="ppud-sez ppud-rilettura" data-ril-modificabile="${modificabile ? '1' : '0'}">
      <h2>${escHtml(TITOLI_D.rilettura)}</h2>
      ${banner}
      ${intro}
      ${legenda}
      ${parti.join('')}
      <div class="ppud-ril-og">${og}</div>
      ${azioni}
    </section>`;
}

function riletturaElementoHTML(el, voce, modificabile) {
  const val = (voce && voce.valutazione) || '';
  const oss = (voce && typeof voce.osservazioni === 'string') ? voce.osservazioni : '';
  const etich = `<div class="ppud-ril-k">${escHtml(el.etichetta)}</div>`;
  const testoAI = `<div class="ppud-ril-ai">${paragrafo(el.testoAI)}</div>`;

  let controlli;
  if (modificabile) {
    const chips = VALUTAZIONI_RILETTURA.map(v => `
      <label class="ppud-ril-chip">
        <input type="radio" name="ril-${escHtml(el.chiave)}" value="${v.id}"${val === v.id ? ' checked' : ''}>
        <span>${escHtml(v.label)}</span>
      </label>`).join('');
    controlli = `
      <div class="ppud-ril-chips" role="radiogroup" aria-label="${escHtml(el.etichetta)}">${chips}</div>
      <label class="ppud-ril-obs-k">Osservazioni dell’équipe</label>
      <textarea class="ppud-ril-obs" rows="2" maxlength="${LIMITI_RILETTURA.osservazione}" data-ril-obs="${escHtml(el.chiave)}" placeholder="Facoltativo per «Conferma»; consigliato per le altre valutazioni.">${escHtml(oss)}</textarea>`;
  } else {
    const vlabel = VALUTAZIONI_RILETTURA.find(v => v.id === val);
    controlli = `
      <div class="ppud-ril-ro">
        <div><span class="ppud-k">Valutazione équipe</span><span class="ppud-v">${vlabel ? escHtml(vlabel.label) : '<em>non valutato</em>'}</span></div>
        <div><span class="ppud-k">Osservazioni</span><span class="ppud-v">${oss ? escHtml(oss) : '—'}</span></div>
      </div>`;
  }
  return `<div class="ppud-ril-el" data-ril-chiave="${escHtml(el.chiave)}">${etich}${testoAI}${controlli}</div>`;
}

// HTML dell'intero documento Scheda D. `opts`:
//   { nomeRagazzo, comunitaLabel, modificabile, validataInfo }
// (il nome NON proviene mai dall'AI). I pannelli "Mostra elementi di origine"
// sono renderizzati vuoti: li riempie js/ppu-scheda-d.js al click.
export function renderVistaHTML(schedaD, opts = {}) {
  const c = (schedaD && schedaD.contenutoAI) || {};
  const nome = opts.nomeRagazzo ? String(opts.nomeRagazzo) : '—';
  const comunita = opts.comunitaLabel ? String(opts.comunitaLabel) : '—';
  const stato = ETICHETTE_STATO_D[schedaD && schedaD.stato] || (schedaD && schedaD.stato) || '—';
  const momento = descriviMomento(schedaD && schedaD.ppuMoment, schedaD && schedaD.ppuMomentNote);

  const testa = `
    <header class="ppud-testa">
      <div class="ppud-kicker">SCHEDA D</div>
      <h1 class="ppud-titolo">${escHtml(TITOLI_D.documento)}</h1>
      <dl class="ppud-meta">
        <div><dt>Ragazzo</dt><dd>${escHtml(nome)}</dd></div>
        <div><dt>Comunità</dt><dd>${escHtml(comunita)}</dd></div>
        <div><dt>Momento PPU</dt><dd>${escHtml(momento || '—')}</dd></div>
        <div><dt>Generata il</dt><dd>${escHtml(fmtDataIT(schedaD && schedaD.generatedAt))}</dd></div>
        <div><dt>Stato</dt><dd><span class="ppud-stato" data-stato="${escHtml(schedaD && schedaD.stato || '')}">${escHtml(stato)}</span></dd></div>
      </dl>
    </header>`;

  const nota = `<div class="ppud-nota-metod">${paragrafo(schedaD && schedaD.notaMetodologica)}</div>`;

  const sintesi = `
    <section class="ppud-sez">
      <h2>${escHtml(TITOLI_D.sintesi)}</h2>
      <div class="ppud-dati">${paragrafo(c.sintesiGenerale)}</div>
    </section>`;

  const pilastriArr = Array.isArray(c.pilastri) ? c.pilastri : [];
  const pilastriHtml = PILASTRI.map((meta, i) => {
    const p = pilastriArr.find(x => x && x.pilastro === meta.id) || pilastriArr[i] || {};
    const cd = (p && p.convergenzeDiscrepanze) || {};
    const dati = CAMPI_PILASTRO.map(([k, label]) =>
      `<div class="ppud-campo"><div class="ppud-campo-k">${escHtml(label)}</div>${paragrafo(p[k])}</div>`
    ).join('') + CAMPI_CONVERGENZE.map(([k, label]) =>
      `<div class="ppud-campo"><div class="ppud-campo-k">${escHtml(label)}</div>${paragrafo(cd[k])}</div>`
    ).join('');
    const ai = `
      <div class="ppud-ai">
        <div class="ppud-ai-tag">Ipotesi elaborata dall’assistente AI — da confrontare con l’osservazione dell’équipe</div>
        <div class="ppud-campo"><div class="ppud-campo-k">${escHtml(TITOLI_D.letturaAI)}</div>${paragrafo(p.letturaEducativaPossibile)}</div>
        <div class="ppud-campo"><div class="ppud-campo-k">Aspetto da approfondire con l’équipe</div>${paragrafo(p.aspettoDaApprofondire)}</div>
      </div>`;
    return `
      <section class="ppud-sez ppud-pilastro">
        <h2>${meta.ordine}. ${escHtml(meta.nome)}</h2>
        <div class="ppud-dati">${dati}</div>
        ${ai}
        ${bottoneFonti(`pilastro:${i}`, p.fonti)}
      </section>`;
  }).join('');

  const lt = (c && c.letturaTrasversale) || {};
  const trasvHtml = `
    <section class="ppud-sez">
      <h2>${escHtml(TITOLI_D.trasversale)}</h2>
      ${SOTTOSEZIONI_TRASVERSALE.map(([k, label]) => {
        const items = Array.isArray(lt[k]) ? lt[k] : [];
        const body = items.length
          ? items.map((it, j) => `
              <li class="ppud-tr-item">
                ${paragrafo(it && it.testo)}
                ${bottoneFonti(`${k}:${j}`, it && it.fonti)}
              </li>`).join('')
          : '<li class="ppud-tr-item"><p class="ppud-vuoto">—</p></li>';
        return `<div class="ppud-tr-sub"><h3>${escHtml(label)}</h3><ul class="ppud-tr-list">${body}</ul></div>`;
      }).join('')}
    </section>`;

  const riletturaSez = renderRiletturaHTML(schedaD, {
    modificabile: !!opts.modificabile,
    validataInfo: opts.validataInfo || null,
  });

  return `<article class="ppud-doc">${testa}${nota}${sintesi}${pilastriHtml}${trasvHtml}${riletturaSez}</article>`;
}
