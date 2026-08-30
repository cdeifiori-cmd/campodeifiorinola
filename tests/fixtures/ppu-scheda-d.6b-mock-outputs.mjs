// tests/fixtures/ppu-scheda-d.6b-mock-outputs.mjs
// DEV-ONLY. Output FINTI, deterministici, per esercitare la pipeline reale
// (costruisciPayload → SYSTEM_PROMPT v2 → validaOutputAI → verificaFontiSemantica
// → retry → assemblaggio docData) SENZA chiamare il modello e SENZA scrivere su
// Firestore. NON sono letture qualitative: autore/teoria sono segnaposto
// espliciti "(mock)" e NON vanno usati per la valutazione di FASE 4–7, che
// richiede la chiamata reale (FASE 3).
//
// Per ogni caso il valore è un array di 1 o 2 risposte grezze (stringa JSON):
// 2 elementi = si esercita anche il retry (1ª risposta non valida, 2ª valida).

function pilastri(idFonte) {
  const IDS = ['self', 'others', 'environment', 'future', 'expression', 'wellbeing'];
  return IDS.map((pid) => ({
    pilastro: pid,
    comeMiVedo: `(mock) Dalla Scheda A, per ${pid}, emergono elementi da leggere insieme.`,
    comeMiVedonoGliAltri: `(mock) Dalla Scheda B, per ${pid}, il ragazzo ipotizza una lettura corrispondente.`,
    elementiRete: 'La Scheda C non contiene elementi pertinenti per questo pilastro.',
    convergenzeDiscrepanze: {
      convergenze: '(mock) alcuni punti in comune.',
      discrepanze: '(mock) una differenza descritta senza spiegarla.',
      datiInsufficienti: '',
    },
    letturaEducativaPossibile: '(mock) potrebbe essere utile esplorare questo aspetto con il ragazzo.',
    aspettoDaApprofondire: `(mock) Cosa si osserva nella vita quotidiana rispetto a ${pid}?`,
    fonti: [{ scheda: 'A', pilastro: pid, elementoId: `${pid}_01` }],
  }));
}

function base() {
  return {
    sintesiGenerale: '(mock) Sintesi generale segnaposto, senza giudizi globali sulla persona.',
    pilastri: pilastri(),
    letturaTrasversale: {
      risorse: [{ testo: '(mock) una risorsa trasversale', fonti: [{ scheda: 'A', pilastro: 'self', elementoId: 'self_01' }] }],
      aspettiAttenzione: [{ testo: '(mock) un aspetto trasversale', fonti: [{ scheda: 'B', pilastro: 'others', elementoId: 'others_01' }] }],
      elementiDaApprofondire: [{ testo: '(mock) un elemento da approfondire', fonti: [{ scheda: 'A', pilastro: 'future', elementoId: 'future_01' }] }],
    },
    chiaviPsicoPedagogiche: [],
  };
}

function chiave(over) {
  return {
    ambito: 'pilastro',
    pilastro: 'self',
    configurazioneOsservata: '(mock) configurazione ricavata dalle fonti citate.',
    questioneEducativa: '(mock) qual è la domanda educativa qui?',
    riferimentoTeorico: {
      autore: 'Autore (mock)',
      teoria: 'Teoria (mock)',
      concetto: 'Concetto (mock)',
      spiegazione: '(mock) spiegazione breve del concetto per un educatore.',
    },
    pertinenzaNelCaso: '(mock) perché questo concetto aiuta a interrogare questa configurazione.',
    limitiDellaLettura: '(mock) cosa non può essere concluso con questi dati.',
    lettureAlternative: [],
    elementiDaOsservare: ['(mock) un comportamento osservabile nella vita quotidiana.'],
    domandeEquipe: ['(mock) una domanda che aiuta a verificare o confutare la lettura.'],
    fonti: [{ scheda: 'A', pilastro: 'self', elementoId: 'self_01' }],
    ...over,
  };
}

const withChiavi = (chiavi) => JSON.stringify({ ...base(), chiaviPsicoPedagogiche: chiavi });

export const MOCK_OUTPUTS = {
  caso1_discrepanza_ab: [withChiavi([
    chiave({
      ambito: 'pilastro', pilastro: 'others',
      fonti: [
        { scheda: 'A', pilastro: 'others', elementoId: 'others_01' },
        { scheda: 'B', pilastro: 'others', elementoId: 'others_02' },
        { scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:persona:n_fra' },
      ],
    }),
  ])],

  caso2_autoefficacia_iniziativa: [withChiavi([
    chiave({
      ambito: 'pilastro', pilastro: 'expression',
      fonti: [
        { scheda: 'A', pilastro: 'expression', elementoId: 'expression_03' },
        { scheda: 'A', pilastro: 'environment', elementoId: 'environment_02' },
        { scheda: 'C', pilastro: 'expression', elementoId: 'vicinanza:legame:e_io_lu' },
      ],
    }),
  ])],

  // Caso 3 → 2 risposte: la 1ª NON valida (questioneEducativa vuota) per
  // esercitare il retry, la 2ª valida.
  caso3_scaffolding_autonomia: [
    withChiavi([chiave({ ambito: 'pilastro', pilastro: 'future', questioneEducativa: '' })]),
    withChiavi([
      chiave({
        ambito: 'pilastro', pilastro: 'future',
        fonti: [
          { scheda: 'A', pilastro: 'future', elementoId: 'future_02' },
          { scheda: 'C', pilastro: 'future', elementoId: 'vicinanza:legame:e_io_edu' },
        ],
      }),
    ]),
  ],

  caso4_identita_contesti: [withChiavi([
    chiave({
      ambito: 'pilastro', pilastro: 'future',
      fonti: [
        { scheda: 'A', pilastro: 'future', elementoId: 'future_01' },
        { scheda: 'B', pilastro: 'future', elementoId: 'future_03' },
        { scheda: 'C', pilastro: 'future', elementoId: 'vicinanza:persona:n_tutor' },
      ],
    }),
    chiave({
      ambito: 'trasversale', pilastro: null,
      fonti: [
        { scheda: 'A', pilastro: 'others', elementoId: 'others_02' },
        { scheda: 'A', pilastro: 'environment', elementoId: 'environment_02' },
        { scheda: 'C', pilastro: 'others', elementoId: 'fatica:legame:e_io_grp' },
      ],
    }),
  ])],

  // Caso 5 → nessuna chiave (dati poveri).
  caso5_dati_poveri: [withChiavi([])],

  caso6_trasversale: [withChiavi([
    chiave({
      ambito: 'trasversale', pilastro: null,
      fonti: [
        { scheda: 'A', pilastro: 'others', elementoId: 'others_01' },
        { scheda: 'A', pilastro: 'others', elementoId: 'others_02' },
        { scheda: 'A', pilastro: 'expression', elementoId: 'expression_03' },
        { scheda: 'A', pilastro: 'self', elementoId: 'self_03' },
        { scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:legame:e_io_mister' },
      ],
    }),
  ])],
};
