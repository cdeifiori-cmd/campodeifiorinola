// tests/fixtures/ppu-scheda-d.6b-cases.mjs
// DEV-ONLY. Sei casi sintetici A+B+C per il collaudo QUALITATIVO delle
// `chiaviPsicoPedagogiche` (Passo 6B). Nessun dato reale, nessuna PII, nessun
// nome/persona reale, nessuna diagnosi o etichetta clinica, NESSUN nome di
// autore o teoria scritto nei dati. I casi sono deliberatamente molto diversi
// fra loro per verificare se il modello produce letture differenziate.
//
// Struttura identica alle schede reali:
//   A → risposte (18 indicatori, scala 'NO'|1|2|3) + closing (3 domande aperte)
//   B → risposte (18 indicatori) ; instrumentVersion
//   C → sociogrammi { vicinanza, fatica } con nodi (name/distance) e archi
//       (direction: forward|backward|both ; quality: green|yellow|red|grey)
// 'NO' = il ragazzo non sa collocarsi su quell'aspetto (NON è uno zero).

export const INDICATORI = [
  'self_01', 'self_02', 'self_03',
  'others_01', 'others_02', 'others_03',
  'environment_01', 'environment_02', 'environment_03',
  'future_01', 'future_02', 'future_03',
  'expression_01', 'expression_02', 'expression_03',
  'wellbeing_01', 'wellbeing_02', 'wellbeing_03',
];

const COM = 'com-collaudo';
const MOM = { ppuMoment: 'ingresso', ppuMomentNote: '' };

function A(minorId, risposte, closing) {
  return {
    id: `${minorId}_a`, minorId, comunitaId: COM, status: 'completata', ...MOM,
    completedAt: 1000, instrumentVersion: 1, risposte, closing,
  };
}
function B(minorId, risposte) {
  return {
    id: `${minorId}_b`, minorId, comunitaId: COM, status: 'completata', ...MOM,
    completedAt: 1000, instrumentVersion: 1, risposte,
  };
}
const io = () => ({ id: 'io', isCenter: true, name: 'IO', x: 0.5, y: 0.5 });
function C(minorId, vicinanza, fatica) {
  return {
    id: `${minorId}_c`, minorId, comunitaId: COM, status: 'completata', ...MOM,
    completedAt: 1000, instrumentVersion: 1,
    sociogrammi: {
      vicinanza: { nodes: [io(), ...(vicinanza.nodes || [])], edges: vicinanza.edges || [] },
      fatica: { nodes: [io(), ...(fatica.nodes || [])], edges: fatica.edges || [] },
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// CASO 1 — Discrepanza fra autorappresentazione e immagine riflessa
// A: rappresentazione positiva dello stare nelle relazioni.
// B: pensa di essere visto più impulsivo / incerto proprio lì.
// C: figure significative con qualità relazionali differenti.
// Nessun elemento che spieghi CAUSALMENTE la discrepanza.
const caso1 = {
  id: 'caso1_discrepanza_ab',
  titolo: 'Discrepanza A/B sullo stare nelle relazioni',
  note: 'A si vede capace nelle relazioni; B: gli altri lo vedrebbero più impulsivo/incerto. Nessuna causa nei dati.',
  a: A('c1', {
    self_01: 2, self_02: 2, self_03: 2,
    others_01: 3, others_02: 3, others_03: 2,
    environment_01: 2, environment_02: 2, environment_03: 2,
    future_01: 2, future_02: 2, future_03: 2,
    expression_01: 2, expression_02: 2, expression_03: 2,
    wellbeing_01: 2, wellbeing_02: 2, wellbeing_03: 2,
  }, {
    perceivedStrength: 'Stare con gli altri e ascoltare quando qualcuno ha un problema.',
    desiredImprovement: 'Non partire subito quando qualcuno mi prende in giro davanti agli altri.',
    chosenGrowthArea: 'Tenere la calma nei momenti di tensione dentro il gruppo.',
  }),
  b: B('c1', {
    self_01: 2, self_02: 1, self_03: 2,
    others_01: 1, others_02: 1, others_03: 1,
    environment_01: 2, environment_02: 2, environment_03: 2,
    future_01: 2, future_02: 2, future_03: 2,
    expression_01: 2, expression_02: 2, expression_03: 2,
    wellbeing_01: 2, wellbeing_02: 1, wellbeing_03: 2,
  }),
  c: C('c1',
    {
      nodes: [
        { id: 'n_fra', name: 'Fra. R.', x: 0.42, y: 0.46, distance: 0.15 },
        { id: 'n_gio', name: 'Gio.', x: 0.62, y: 0.40, distance: 0.35 },
        { id: 'n_sam', name: 'Sam.', x: 0.55, y: 0.62, distance: 0.28 },
      ],
      edges: [
        { id: 'e_io_fra', source: 'io', target: 'n_fra', direction: 'both', quality: 'green' },
        { id: 'e_io_gio', source: 'io', target: 'n_gio', direction: 'both', quality: 'yellow' },
      ],
    },
    {
      nodes: [{ id: 'n_ale', name: 'Ale.', x: 0.60, y: 0.35, distance: 0.40 }],
      edges: [{ id: 'e_io_ale', source: 'io', target: 'n_ale', direction: 'both', quality: 'red' }],
    }),
};

// ──────────────────────────────────────────────────────────────────────
// CASO 2 — Autoefficacia / iniziativa
// Si sente capace sul noto, esita sul nuovo. B: visto come uno che rinuncia
// facilmente in alcuni contesti. C: una figura competente/affidabile + legame
// positivo. (Nessun nome di autore nei dati.)
const caso2 = {
  id: 'caso2_autoefficacia_iniziativa',
  titolo: 'Sicuro sul noto, esitante sul nuovo',
  note: 'environment_02 (incarico noto) A=3 / B=2 ; expression_03 (cose nuove) A=B=1 ; future_03 A=2 / B=1.',
  a: A('c2', {
    self_01: 2, self_02: 2, self_03: 2,
    others_01: 2, others_02: 2, others_03: 2,
    environment_01: 2, environment_02: 3, environment_03: 2,
    future_01: 2, future_02: 2, future_03: 2,
    expression_01: 2, expression_02: 2, expression_03: 1,
    wellbeing_01: 2, wellbeing_02: 2, wellbeing_03: 2,
  }, {
    perceivedStrength: 'Le cose che conosco già le porto a termine senza problemi.',
    desiredImprovement: 'Buttarmi nelle cose nuove anche se non so se ci riesco.',
    chosenGrowthArea: 'Provare attività nuove senza rinunciare prima di iniziare.',
  }),
  b: B('c2', {
    self_01: 2, self_02: 2, self_03: 2,
    others_01: 2, others_02: 2, others_03: 2,
    environment_01: 2, environment_02: 2, environment_03: 2,
    future_01: 2, future_02: 2, future_03: 1,
    expression_01: 2, expression_02: 2, expression_03: 1,
    wellbeing_01: 2, wellbeing_02: 2, wellbeing_03: 2,
  }),
  c: C('c2',
    {
      nodes: [
        { id: 'n_lu', name: 'Lu.', x: 0.40, y: 0.50, distance: 0.18 },
        { id: 'n_marco', name: 'Marco', x: 0.44, y: 0.40, distance: 0.22 },
      ],
      edges: [{ id: 'e_io_lu', source: 'io', target: 'n_lu', direction: 'both', quality: 'green' }],
    },
    {
      nodes: [{ id: 'n_cc', name: 'Comp. classe', x: 0.65, y: 0.60, distance: 0.42 }],
      edges: [],
    }),
};

// ──────────────────────────────────────────────────────────────────────
// CASO 3 — Supporto / mediazione / autonomia
// Riesce meglio confrontandosi con un adulto o un pari competente; NON dipendenza
// generalizzata; in alcune situazioni autonome funziona bene, in altre serve
// mediazione. C: una o due figure di riferimento.
const caso3 = {
  id: 'caso3_scaffolding_autonomia',
  titolo: 'Autonomia sì, ma con un confronto disponibile',
  note: 'A/B molto convergenti; sfumatura environment_02 A=3/B=2; wellbeing_01 A=3 (cura di sé autonoma); future_02=2 (decisioni con mediazione).',
  a: A('c3', {
    self_01: 2, self_02: 2, self_03: 3,
    others_01: 2, others_02: 3, others_03: 2,
    environment_01: 2, environment_02: 3, environment_03: 2,
    future_01: 2, future_02: 2, future_03: 2,
    expression_01: 2, expression_02: 2, expression_03: 2,
    wellbeing_01: 3, wellbeing_02: 2, wellbeing_03: 2,
  }, {
    perceivedStrength: 'Quando non capisco qualcosa chiedo aiuto senza vergognarmi.',
    desiredImprovement: 'Decidere da solo senza farmi confermare ogni scelta.',
    chosenGrowthArea: 'Prendere decisioni in autonomia quando ho già tutte le informazioni.',
  }),
  b: B('c3', {
    self_01: 2, self_02: 2, self_03: 3,
    others_01: 2, others_02: 3, others_03: 2,
    environment_01: 2, environment_02: 2, environment_03: 2,
    future_01: 2, future_02: 2, future_03: 2,
    expression_01: 2, expression_02: 2, expression_03: 2,
    wellbeing_01: 2, wellbeing_02: 2, wellbeing_03: 2,
  }),
  c: C('c3',
    {
      nodes: [
        { id: 'n_edu', name: 'Edu. C', x: 0.40, y: 0.48, distance: 0.16 },
        { id: 'n_ste', name: 'Ste.', x: 0.46, y: 0.40, distance: 0.24 },
      ],
      edges: [
        { id: 'e_io_edu', source: 'io', target: 'n_edu', direction: 'both', quality: 'green' },
        { id: 'e_io_ste', source: 'io', target: 'n_ste', direction: 'forward', quality: 'green' },
      ],
    },
    { nodes: [], edges: [] }),
};

// ──────────────────────────────────────────────────────────────────────
// CASO 4 — Identità / progettualità / differenza fra contesti
// A: interessi e aspirazioni abbastanza chiari. B: visto come incostante /
// ancora indeciso. Le risposte cambiano fra scuola-lavoro, gruppo dei pari e
// vita comunitaria. C: figure appartenenti a contesti diversi.
const caso4 = {
  id: 'caso4_identita_contesti',
  titolo: 'Idee chiare sul futuro, lettura di incostanza, forte effetto-contesto',
  note: 'expression_01/future_01 A=3 ; future_03 B=1 (incostante) ; environment_02 (comunità) A=3 vs others_02 (pari) A=1.',
  a: A('c4', {
    self_01: 2, self_02: 2, self_03: 2,
    others_01: 2, others_02: 1, others_03: 2,
    environment_01: 2, environment_02: 3, environment_03: 2,
    future_01: 3, future_02: 2, future_03: 2,
    expression_01: 3, expression_02: 2, expression_03: 2,
    wellbeing_01: 2, wellbeing_02: 2, wellbeing_03: 2,
  }, {
    perceivedStrength: 'So cosa mi piace e ho un’idea di cosa vorrei fare da grande.',
    desiredImprovement: 'Essere più costante e non cambiare idea a seconda di chi ho intorno.',
    chosenGrowthArea: 'Portare avanti i miei progetti anche quando cambio ambiente.',
  }),
  b: B('c4', {
    self_01: 2, self_02: 2, self_03: 2,
    others_01: 2, others_02: 2, others_03: 2,
    environment_01: 2, environment_02: 2, environment_03: 2,
    future_01: 2, future_02: 2, future_03: 1,
    expression_01: 2, expression_02: 2, expression_03: 2,
    wellbeing_01: 2, wellbeing_02: 2, wellbeing_03: 2,
  }),
  c: C('c4',
    {
      nodes: [
        { id: 'n_prof', name: 'Prof. M', x: 0.40, y: 0.52, distance: 0.30 },
        { id: 'n_tutor', name: 'Tutor L', x: 0.42, y: 0.42, distance: 0.20 },
        { id: 'n_vale', name: 'Vale', x: 0.66, y: 0.50, distance: 0.34 },
        { id: 'n_dani', name: 'Dani', x: 0.55, y: 0.62, distance: 0.26 },
      ],
      edges: [
        { id: 'e_io_tutor', source: 'io', target: 'n_tutor', direction: 'both', quality: 'green' },
        { id: 'e_io_vale', source: 'io', target: 'n_vale', direction: 'both', quality: 'yellow' },
      ],
    },
    {
      nodes: [{ id: 'n_grp', name: 'Gruppo amici', x: 0.64, y: 0.40, distance: 0.38 }],
      edges: [{ id: 'e_io_grp', source: 'io', target: 'n_grp', direction: 'backward', quality: 'yellow' }],
    }),
};

// ──────────────────────────────────────────────────────────────────────
// CASO 5 — Dati poveri / nessuna teoria (test fondamentale)
// Molti 'NO' o risposte mancanti, poche convergenze, C molto scarna, nessuna
// configurazione solida. Risultato atteso: chiaviPsicoPedagogiche: [].
const caso5 = {
  id: 'caso5_dati_poveri',
  titolo: 'Dati insufficienti a qualunque lettura fondata',
  note: 'Prevalenza di NO e risposte mancanti in A e B; C con una sola figura lontana e nessun legame; closing vuote.',
  a: A('c5', {
    self_01: 'NO', self_02: 'NO',
    others_01: 'NO', others_02: 1,
    environment_01: 'NO', environment_03: 'NO',
    future_01: 'NO', future_02: 'NO',
    expression_01: 'NO', expression_03: 'NO',
    wellbeing_01: 2, wellbeing_02: 'NO',
    // self_03, others_03, environment_02, future_03, expression_02, wellbeing_03 → non risposti
  }, {
    perceivedStrength: '',
    desiredImprovement: '',
    chosenGrowthArea: '',
  }),
  b: B('c5', {
    self_01: 'NO', self_02: 'NO',
    others_01: 'NO', others_02: 'NO',
    environment_01: 'NO',
    future_01: 'NO',
    expression_01: 'NO',
    wellbeing_01: 2, wellbeing_02: 'NO',
  }),
  c: C('c5',
    { nodes: [{ id: 'n_zia', name: 'Zia', x: 0.78, y: 0.70, distance: 0.62 }], edges: [] },
    { nodes: [], edges: [] }),
};

// ──────────────────────────────────────────────────────────────────────
// CASO 6 — Configurazione trasversale (≥ 3 pilastri)
// Il fenomeno interessante attraversa iniziativa personale, relazione col
// gruppo, progettualità, capacità di chiedere aiuto e differenze fra contesti.
// Non è leggibile correttamente dentro un solo pilastro.
const caso6 = {
  id: 'caso6_trasversale',
  titolo: 'Funziona nel gruppo di sempre, si blocca da solo o in gruppi nuovi',
  note: 'others_02=3 (gruppo noto) vs others_01=1 (gruppo nuovo) ; expression_03=1 ; future_03=1 ; self_03=1. Attraversa self/others/future/expression/environment.',
  a: A('c6', {
    self_01: 2, self_02: 2, self_03: 1,
    others_01: 1, others_02: 3, others_03: 2,
    environment_01: 2, environment_02: 2, environment_03: 2,
    future_01: 2, future_02: 2, future_03: 1,
    expression_01: 2, expression_02: 2, expression_03: 1,
    wellbeing_01: 2, wellbeing_02: 2, wellbeing_03: 2,
  }, {
    perceivedStrength: 'Quando sono nella mia squadra do il massimo e mi fido dei compagni.',
    desiredImprovement: 'Riuscire a fare le cose anche fuori dalla squadra, da solo o in gruppi nuovi.',
    chosenGrowthArea: 'Portare avanti gli impegni anche quando non c’è il gruppo di sempre e chiedere aiuto se serve.',
  }),
  b: B('c6', {
    self_01: 2, self_02: 2, self_03: 1,
    others_01: 1, others_02: 3, others_03: 2,
    environment_01: 2, environment_02: 2, environment_03: 2,
    future_01: 2, future_02: 2, future_03: 1,
    expression_01: 2, expression_02: 2, expression_03: 2,
    wellbeing_01: 2, wellbeing_02: 2, wellbeing_03: 2,
  }),
  c: C('c6',
    {
      nodes: [
        { id: 'n_alle', name: 'Alle.', x: 0.44, y: 0.44, distance: 0.16 },
        { id: 'n_mister', name: 'Mister', x: 0.40, y: 0.52, distance: 0.20 },
      ],
      edges: [
        { id: 'e_io_alle', source: 'io', target: 'n_alle', direction: 'both', quality: 'green' },
        { id: 'e_io_mister', source: 'io', target: 'n_mister', direction: 'both', quality: 'green' },
      ],
    },
    {
      nodes: [
        { id: 'n_comp', name: 'Comp. classe', x: 0.68, y: 0.60, distance: 0.44 },
        { id: 'n_profn', name: 'Prof. nuovo', x: 0.62, y: 0.38, distance: 0.50 },
      ],
      edges: [{ id: 'e_io_comp', source: 'io', target: 'n_comp', direction: 'backward', quality: 'yellow' }],
    }),
};

export const CASI = [caso1, caso2, caso3, caso4, caso5, caso6];
export const COMUNITA_COLLAUDO = COM;
