// tests/ppu-scheda-d.model.test.mjs
// Test del nucleo dati puro della Scheda D PPU (js/ppu-scheda-d-model.js).
// Nessuna dipendenza esterna: `node --test tests/ppu-scheda-d.model.test.mjs`.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  PILASTRI, PILASTRI_ID, COSTRUTTI, TOTALE_INDICATORI, CLOSING_IDS,
  costrutto, pilastroDiIndicatore, elencaIndicatoriPilastro,
  MOMENTI_PPU, labelMomento, ordineMomento, descriviMomento, LABEL_SCHEDE,
  STATI_SCHEDA_D, STATI_D_PERSISTITI, TRANSIZIONI_D, statoSchedaDValido, puoTransire,
  CAMPI_PAYLOAD_AMMESSI, PROMPT_VERSION, NOTA_METODOLOGICA,
  MAX_CHIAVI_PP, AMBITI_CHIAVE, validaChiaviPsicoPedagogiche, renderChiavePPHTML,
  tsMillis, piuRecenteCompletata, chiaveMomento,
  raggruppaFontiPerMomento, descriviMancanti,
  filtraSchedeDPerMomento, statoMomento,
  SCHEDE_FONTE, rifFonte, validaRiferimentoFonte, riepilogoFonti, idFonti,
  validaOutputAI, outputAIValido, analizzaCoerenzaFonti,
  ordinaSchedeDPerGenerazione, statoRigaMomento, confrontaFontiConGruppo,
  elencaMomenti, messaggioErroreGenerazione, ricostruisciFonte,
  prossimoStatoToggleFonti, ETICHETTE_TOGGLE_FONTI,
  renderVistaHTML, renderFonteHTML, renderFontiPannelloHTML, formatDataD,
  TITOLI_D, ETICHETTE_STATO_D,
  VALUTAZIONI_RILETTURA, VALUTAZIONI_RILETTURA_ID, LIMITI_RILETTURA,
  elencaElementiRilettura, validaRiletturaEquipe, riletturaSignificativa,
  mergeRiletturaBy, costruisciRiletturaDaValori, renderRiletturaHTML,
} from '../js/ppu-scheda-d-model.js';

// ── Helper di test ─────────────────────────────────────────────────────
function schedaA({ id = 'a1', status = 'completata', ppuMoment = 'ingresso', ppuMomentNote = '', completedAt = 1000 } = {}) {
  return { id, status, ppuMoment, ppuMomentNote, completedAt };
}
function schedaB(o = {}) { return schedaA({ id: 'b1', ...o }); }
function schedaC(o = {}) { return schedaA({ id: 'c1', ...o }); }

function outputValido() {
  const pilastri = PILASTRI_ID.map(pid => ({
    pilastro: pid,
    comeMiVedo: 'sintesi A',
    comeMiVedonoGliAltri: 'sintesi B',
    elementiRete: 'La Scheda C non contiene elementi pertinenti per questo pilastro.',
    convergenzeDiscrepanze: { convergenze: '', discrepanze: 'descrizione', datiInsufficienti: '' },
    letturaEducativaPossibile: 'potrebbe essere utile esplorare…',
    aspettoDaApprofondire: 'Cosa osservare nella vita quotidiana?',
    fonti: [{ scheda: 'A', pilastro: pid, elementoId: elencaIndicatoriPilastro(pid)[0], valore: '3' }],
  }));
  return {
    sintesiGenerale: 'Testo di sintesi generale sufficientemente esteso.',
    pilastri,
    letturaTrasversale: {
      risorse: [{ testo: 'una risorsa', fonti: [{ scheda: 'C', pilastro: 'others', elementoId: 'Mamma' }] }],
      aspettiAttenzione: [{ testo: 'un aspetto', fonti: [{ scheda: 'A', pilastro: 'self', elementoId: 'self_02' }] }],
      elementiDaApprofondire: [{ testo: 'un elemento', fonti: [{ scheda: 'B', pilastro: 'future', elementoId: 'future_01' }] }],
    },
  };
}

// ── Pilastri e costrutti ──────────────────────────────────────────────
describe('PILASTRI e COSTRUTTI', () => {
  test('sei pilastri con gli id delle aree di Scheda A/B, in ordine', () => {
    assert.deepEqual(PILASTRI_ID, ['self', 'others', 'environment', 'future', 'expression', 'wellbeing']);
    assert.deepEqual(PILASTRI.map(p => p.ordine), [1, 2, 3, 4, 5, 6]);
  });

  test('18 costrutti, 3 per pilastro, id nel formato <pilastro>_NN', () => {
    assert.equal(TOTALE_INDICATORI, 18);
    assert.equal(Object.keys(COSTRUTTI).length, 18);
    for (const pid of PILASTRI_ID) {
      assert.deepEqual(elencaIndicatoriPilastro(pid), [`${pid}_01`, `${pid}_02`, `${pid}_03`]);
    }
    for (const id of Object.keys(COSTRUTTI)) {
      assert.match(id, /^[a-z]+_\d{2}$/);
      assert.ok(costrutto(id).length > 0);
    }
  });

  test('pilastroDiIndicatore riconosce gli id validi e rifiuta gli altri', () => {
    assert.equal(pilastroDiIndicatore('environment_02'), 'environment');
    assert.equal(pilastroDiIndicatore('self_01'), 'self');
    assert.equal(pilastroDiIndicatore('self_1'), null);       // NN non a due cifre
    assert.equal(pilastroDiIndicatore('bogus_01'), null);     // prefisso non è un pilastro
    assert.equal(pilastroDiIndicatore('Mamma'), null);        // nome persona (fonte C)
    assert.equal(pilastroDiIndicatore(''), null);
    assert.equal(pilastroDiIndicatore(undefined), null);
  });

  test('CLOSING_IDS sono le 3 domande aperte della Scheda A', () => {
    assert.deepEqual(CLOSING_IDS, ['perceivedStrength', 'desiredImprovement', 'chosenGrowthArea']);
  });
});

// ── Costanti di supporto ──────────────────────────────────────────────
describe('costanti di supporto', () => {
  test('stati e transizioni', () => {
    assert.deepEqual(STATI_SCHEDA_D, ['NON_GENERABILE', 'DA_GENERARE', 'GENERATA', 'IN_RILETTURA', 'VALIDATA']);
    assert.deepEqual(STATI_D_PERSISTITI, ['GENERATA', 'IN_RILETTURA', 'VALIDATA']);
    assert.ok(statoSchedaDValido('GENERATA'));
    assert.ok(!statoSchedaDValido('DA_GENERARE'));
    assert.ok(puoTransire('GENERATA', 'IN_RILETTURA'));
    assert.ok(puoTransire('GENERATA', 'VALIDATA'));
    assert.ok(puoTransire('IN_RILETTURA', 'VALIDATA'));
    assert.ok(!puoTransire('VALIDATA', 'IN_RILETTURA'));
    assert.ok(!puoTransire('IN_RILETTURA', 'GENERATA'));
    assert.deepEqual(TRANSIZIONI_D.VALIDATA, []);
  });

  test('allowlist payload: nessuna areaNotes / note generale C', () => {
    assert.deepEqual(CAMPI_PAYLOAD_AMMESSI.A, ['risposte', 'closing']);
    assert.deepEqual(CAMPI_PAYLOAD_AMMESSI.B, ['risposte']);
    assert.deepEqual(CAMPI_PAYLOAD_AMMESSI.C, ['sociogrammi']);
    for (const campi of Object.values(CAMPI_PAYLOAD_AMMESSI)) {
      assert.ok(!campi.includes('areaNotes'));
      assert.ok(!campi.includes('note'));
    }
  });

  test('PROMPT_VERSION e nota metodologica stabili', () => {
    assert.equal(PROMPT_VERSION, 4); // Passo 6C: versione psico-pedagogica concisa e max_tokens-aware
    assert.match(NOTA_METODOLOGICA, /non costituisce una valutazione diagnostica/i);
    assert.match(NOTA_METODOLOGICA, /Schede A, B e C/);
  });

  test('etichette schede fonte', () => {
    assert.equal(LABEL_SCHEDE.C, 'Scheda C — Le persone intorno a me');
    assert.deepEqual(SCHEDE_FONTE, ['A', 'B', 'C']);
  });
});

// ── tsMillis ──────────────────────────────────────────────────────────
describe('tsMillis', () => {
  test('formati accettati', () => {
    assert.equal(tsMillis(null), null);
    assert.equal(tsMillis(undefined), null);
    assert.equal(tsMillis(1234), 1234);
    assert.equal(tsMillis(new Date('2026-01-01T00:00:00Z')), Date.parse('2026-01-01T00:00:00Z'));
    assert.equal(tsMillis('2026-01-01T00:00:00Z'), Date.parse('2026-01-01T00:00:00Z'));
    assert.equal(tsMillis({ seconds: 2, nanoseconds: 500000000 }), 2500);
    assert.equal(tsMillis({ _seconds: 3, _nanoseconds: 0 }), 3000);
    assert.equal(tsMillis({ toMillis: () => 7777 }), 7777);
    assert.equal(tsMillis({ toDate: () => new Date(4000) }), 4000);
    assert.equal(tsMillis('non-una-data'), null);
    assert.equal(tsMillis({}), null);
  });
});

// ── piuRecenteCompletata ──────────────────────────────────────────────
describe('piuRecenteCompletata', () => {
  test('lista vuota / nessuna completata → null', () => {
    assert.equal(piuRecenteCompletata([]), null);
    assert.equal(piuRecenteCompletata(null), null);
    assert.equal(piuRecenteCompletata([{ status: 'bozza', completedAt: 9 }]), null);
  });

  test('sceglie la completata con completedAt maggiore', () => {
    const vecchia = schedaA({ id: 'vecchia', completedAt: 100 });
    const nuova = schedaA({ id: 'nuova', completedAt: 200 });
    assert.equal(piuRecenteCompletata([vecchia, nuova]).id, 'nuova');
    assert.equal(piuRecenteCompletata([nuova, vecchia]).id, 'nuova');
  });

  test('ignora le bozze anche se più recenti', () => {
    const completata = schedaA({ id: 'ok', completedAt: 100 });
    const bozzaRecente = { id: 'bozza', status: 'bozza', ppuMoment: 'ingresso', updatedAt: 999 };
    assert.equal(piuRecenteCompletata([completata, bozzaRecente]).id, 'ok');
  });

  test('fallback di recenza quando completedAt manca', () => {
    const soloUpdated = { id: 'u', status: 'completata', ppuMoment: 'ingresso', updatedAt: 500 };
    const soloAssessment = { id: 'a', status: 'completata', ppuMoment: 'ingresso', assessmentDate: 400 };
    assert.equal(piuRecenteCompletata([soloAssessment, soloUpdated]).id, 'u');
  });

  test('timestamp in forme miste sono confrontabili', () => {
    const x = { id: 'x', status: 'completata', ppuMoment: 'ingresso', completedAt: { seconds: 10, nanoseconds: 0 } }; // 10000
    const y = { id: 'y', status: 'completata', ppuMoment: 'ingresso', completedAt: new Date(20000) };
    assert.equal(piuRecenteCompletata([x, y]).id, 'y');
  });
});

// ── chiaveMomento / descriviMomento ───────────────────────────────────
describe('chiaveMomento e descrizioni', () => {
  test('momenti canonici', () => {
    assert.equal(chiaveMomento({ ppuMoment: 'ingresso' }), 'ingresso');
    assert.equal(chiaveMomento({ ppuMoment: 'verifica_3_mesi' }), 'verifica_3_mesi');
    assert.equal(chiaveMomento({ ppuMoment: '' }), null);
    assert.equal(chiaveMomento({}), null);
  });

  test('altro: chiave = "altro:" + note trimmata (soluzione transitoria)', () => {
    assert.equal(chiaveMomento({ ppuMoment: 'altro', ppuMomentNote: 'Rientro da esperienza' }), 'altro:Rientro da esperienza');
    assert.equal(chiaveMomento({ ppuMoment: 'altro', ppuMomentNote: '   Rientro da esperienza   ' }), 'altro:Rientro da esperienza');
    assert.equal(chiaveMomento({ ppuMoment: 'altro' }), 'altro:');
  });

  test('labelMomento / ordineMomento / descriviMomento', () => {
    assert.equal(labelMomento('uscita'), 'Uscita');
    assert.equal(labelMomento('sconosciuto'), 'sconosciuto');
    assert.ok(ordineMomento('ingresso') < ordineMomento('uscita'));
    assert.ok(ordineMomento('uscita') < ordineMomento('altro'));
    assert.equal(descriviMomento('ingresso'), 'Ingresso');
    assert.equal(descriviMomento('altro', '  Colloquio lampo '), 'Colloquio lampo');
    assert.equal(descriviMomento('altro', ''), 'Altro');
  });
});

// ── raggruppaFontiPerMomento ──────────────────────────────────────────
describe('raggruppaFontiPerMomento', () => {
  test('liste vuote → nessun gruppo', () => {
    assert.deepEqual(raggruppaFontiPerMomento([], [], []), []);
    assert.deepEqual(raggruppaFontiPerMomento(), []);
  });

  test('solo bozze → nessun gruppo', () => {
    const bozza = { id: 'x', status: 'bozza', ppuMoment: 'ingresso' };
    assert.deepEqual(raggruppaFontiPerMomento([bozza], [bozza], [bozza]), []);
  });

  test('A+B+C completate stesso momento → un gruppo generabile', () => {
    const g = raggruppaFontiPerMomento([schedaA()], [schedaB()], [schedaC()]);
    assert.equal(g.length, 1);
    assert.equal(g[0].chiave, 'ingresso');
    assert.equal(g[0].ppuMoment, 'ingresso');
    assert.equal(g[0].label, 'Ingresso');
    assert.equal(g[0].generabile, true);
    assert.deepEqual(g[0].mancanti, []);
    assert.equal(g[0].a.id, 'a1');
    assert.equal(g[0].b.id, 'b1');
    assert.equal(g[0].c.id, 'c1');
  });

  test('C in un momento diverso → due gruppi, entrambi non generabili', () => {
    const g = raggruppaFontiPerMomento(
      [schedaA({ ppuMoment: 'ingresso' })],
      [schedaB({ ppuMoment: 'ingresso' })],
      [schedaC({ ppuMoment: 'verifica_3_mesi' })],
    );
    assert.equal(g.length, 2);
    const ingresso = g.find(x => x.chiave === 'ingresso');
    const v3 = g.find(x => x.chiave === 'verifica_3_mesi');
    assert.equal(ingresso.generabile, false);
    assert.deepEqual(ingresso.mancanti, ['C']);
    assert.equal(v3.generabile, false);
    assert.deepEqual(v3.mancanti, ['A', 'B']);
    // ordinati cronologicamente
    assert.deepEqual(g.map(x => x.chiave), ['ingresso', 'verifica_3_mesi']);
  });

  test('più A completate nello stesso momento → si usa la più recente', () => {
    const a1 = schedaA({ id: 'a-vecchia', completedAt: 100 });
    const a2 = schedaA({ id: 'a-nuova', completedAt: 300 });
    const g = raggruppaFontiPerMomento([a1, a2], [schedaB()], [schedaC()]);
    assert.equal(g.length, 1);
    assert.equal(g[0].a.id, 'a-nuova');
    assert.equal(g[0].generabile, true);
  });

  test('una A completata + una A bozza più recente → si usa la completata', () => {
    const aOk = schedaA({ id: 'a-ok', completedAt: 100 });
    const aBozza = { id: 'a-bozza', status: 'bozza', ppuMoment: 'ingresso', updatedAt: 999 };
    const g = raggruppaFontiPerMomento([aOk, aBozza], [schedaB()], [schedaC()]);
    assert.equal(g[0].a.id, 'a-ok');
  });

  test('due occasioni "altro" con note diverse → momenti distinti', () => {
    const g = raggruppaFontiPerMomento(
      [schedaA({ ppuMoment: 'altro', ppuMomentNote: 'Rientro' }), schedaA({ id: 'a2', ppuMoment: 'altro', ppuMomentNote: 'Crisi' })],
      [schedaB({ ppuMoment: 'altro', ppuMomentNote: 'Rientro' })],
      [schedaC({ ppuMoment: 'altro', ppuMomentNote: 'Rientro' })],
    );
    assert.equal(g.length, 2);
    const rientro = g.find(x => x.chiave === 'altro:Rientro');
    const crisi = g.find(x => x.chiave === 'altro:Crisi');
    assert.equal(rientro.generabile, true);
    assert.equal(rientro.ppuMoment, 'altro');
    assert.equal(rientro.ppuMomentNote, 'Rientro');
    assert.equal(rientro.label, 'Rientro');
    assert.equal(crisi.generabile, false);
    assert.deepEqual(crisi.mancanti, ['B', 'C']);
  });

  test('due occasioni "altro" con la stessa note (a meno di spazi) → stesso momento', () => {
    const g = raggruppaFontiPerMomento(
      [schedaA({ ppuMoment: 'altro', ppuMomentNote: 'Rientro' })],
      [schedaB({ ppuMoment: 'altro', ppuMomentNote: '  Rientro  ' })],
      [schedaC({ ppuMoment: 'altro', ppuMomentNote: 'Rientro' })],
    );
    assert.equal(g.length, 1);
    assert.equal(g[0].generabile, true);
  });

  test('scheda completata senza ppuMoment → esclusa dal raggruppamento', () => {
    const senzaMomento = { id: 'x', status: 'completata', completedAt: 5 };
    const g = raggruppaFontiPerMomento([senzaMomento, schedaA()], [schedaB()], [schedaC()]);
    assert.equal(g.length, 1);
    assert.equal(g[0].chiave, 'ingresso');
  });
});

// ── descriviMancanti ──────────────────────────────────────────────────
describe('descriviMancanti', () => {
  test('una fonte mancante → messaggio singolare con il nome della scheda', () => {
    const [g] = raggruppaFontiPerMomento([schedaA()], [schedaB()], []);
    assert.equal(
      descriviMancanti(g),
      'Scheda D non ancora generabile. Per il momento «Ingresso» manca la Scheda C — Le persone intorno a me.',
    );
  });

  test('più fonti mancanti → messaggio plurale', () => {
    const [g] = raggruppaFontiPerMomento([], [], [schedaC()]);
    assert.match(descriviMancanti(g), /^Scheda D non ancora generabile\. Per il momento «Ingresso» mancano: /);
    assert.match(descriviMancanti(g), /Scheda A — Come mi vedo/);
    assert.match(descriviMancanti(g), /Scheda B — Come penso che mi vedano gli altri/);
  });

  test('gruppo generabile → nessun messaggio', () => {
    const [g] = raggruppaFontiPerMomento([schedaA()], [schedaB()], [schedaC()]);
    assert.equal(descriviMancanti(g), '');
  });
});

// ── filtraSchedeDPerMomento / statoMomento ────────────────────────────
describe('statoMomento e filtro D per momento', () => {
  const gruppoGenerabile = () => raggruppaFontiPerMomento([schedaA()], [schedaB()], [schedaC()])[0];

  test('gruppo non generabile → NON_GENERABILE', () => {
    const [g] = raggruppaFontiPerMomento([schedaA()], [schedaB()], []);
    assert.equal(statoMomento(g, []), 'NON_GENERABILE');
    assert.equal(statoMomento(null, []), 'NON_GENERABILE');
  });

  test('gruppo generabile senza D → DA_GENERARE', () => {
    assert.equal(statoMomento(gruppoGenerabile(), []), 'DA_GENERARE');
  });

  test('gruppo generabile con D → stato della D più recente', () => {
    const g = gruppoGenerabile();
    const d1 = { ppuMoment: 'ingresso', stato: 'GENERATA', generatedAt: 100 };
    const d2 = { ppuMoment: 'ingresso', stato: 'VALIDATA', generatedAt: 200 };
    assert.equal(statoMomento(g, [d1, d2]), 'VALIDATA');
    assert.equal(statoMomento(g, [d2, d1]), 'VALIDATA');
    assert.equal(statoMomento(g, [d1]), 'GENERATA');
  });

  test('stato D non valido → GENERATA di ripiego', () => {
    const g = gruppoGenerabile();
    assert.equal(statoMomento(g, [{ ppuMoment: 'ingresso', stato: 'boh', generatedAt: 1 }]), 'GENERATA');
  });

  test('filtraSchedeDPerMomento: canonico per ppuMoment, altro anche per note', () => {
    const ds = [
      { ppuMoment: 'ingresso' },
      { ppuMoment: 'uscita' },
      { ppuMoment: 'altro', ppuMomentNote: 'Rientro' },
      { ppuMoment: 'altro', ppuMomentNote: 'Crisi' },
    ];
    assert.equal(filtraSchedeDPerMomento(ds, 'ingresso').length, 1);
    assert.equal(filtraSchedeDPerMomento(ds, 'altro', 'Rientro').length, 1);
    assert.equal(filtraSchedeDPerMomento(ds, 'altro', '  Rientro ').length, 1);
    assert.equal(filtraSchedeDPerMomento(ds, 'altro', 'Assente').length, 0);
  });
});

// ── Tracciabilità ─────────────────────────────────────────────────────
describe('helper di tracciabilità', () => {
  test('rifFonte normalizza e valida', () => {
    const r = rifFonte({ scheda: 'A', pilastro: 'self', elementoId: '  self_02 ', valore: 3, testo: 'x' });
    assert.deepEqual(r, { scheda: 'A', pilastro: 'self', elementoId: 'self_02', valore: 3, testo: 'x' });
    assert.equal(rifFonte({ scheda: 'C', pilastro: 'others', elementoId: 'Mamma' }).valore, null);
    assert.throws(() => rifFonte({ scheda: 'D', pilastro: 'self', elementoId: 'self_01' }), /Scheda fonte non valida/);
    assert.throws(() => rifFonte({ scheda: 'A', pilastro: 'bogus', elementoId: 'self_01' }), /Pilastro non valido/);
    assert.throws(() => rifFonte({ scheda: 'A', pilastro: 'self', elementoId: '   ' }), /elementoId mancante/);
  });

  test('validaRiferimentoFonte elenca i problemi', () => {
    assert.deepEqual(validaRiferimentoFonte({ scheda: 'A', pilastro: 'self', elementoId: 'self_01' }), []);
    assert.equal(validaRiferimentoFonte(null).length, 1);
    assert.ok(validaRiferimentoFonte({ scheda: 'Z', pilastro: 'nope', elementoId: '' }).length >= 3);
  });

  test('riepilogoFonti congela id + timestamp delle 3 fonti', () => {
    const a = schedaA({ id: 'A1', completedAt: 10 });
    const b = schedaB({ id: 'B1', completedAt: 20 });
    const c = schedaC({ id: 'C1', completedAt: 30 });
    const snap = riepilogoFonti(a, b, c);
    assert.equal(snap.a.schedaId, 'A1');
    assert.equal(snap.b.completedAt, 20);
    assert.equal(snap.c.schedaId, 'C1');
    assert.equal(riepilogoFonti(null, null, null).a, null);
  });

  test('idFonti richiede un gruppo generabile', () => {
    const [gen] = raggruppaFontiPerMomento([schedaA()], [schedaB()], [schedaC()]);
    assert.deepEqual(idFonti(gen), { sourceAId: 'a1', sourceBId: 'b1', sourceCId: 'c1' });
    const [nonGen] = raggruppaFontiPerMomento([schedaA()], [schedaB()], []);
    assert.throws(() => idFonti(nonGen), /non generabile/);
  });
});

// ── validaOutputAI ────────────────────────────────────────────────────
describe('validaOutputAI', () => {
  test('output ben formato → nessun errore', () => {
    assert.deepEqual(validaOutputAI(outputValido()), []);
    assert.equal(outputAIValido(outputValido()), true);
  });

  test('non oggetto → errore singolo', () => {
    assert.equal(validaOutputAI(null).length, 1);
    assert.equal(validaOutputAI('x').length, 1);
    assert.equal(validaOutputAI([]).length, 1);
  });

  test('sintesiGenerale mancante', () => {
    const j = outputValido(); delete j.sintesiGenerale;
    assert.ok(validaOutputAI(j).some(m => /sintesiGenerale/.test(m)));
  });

  test('pilastri: numero errato', () => {
    const j = outputValido(); j.pilastri = j.pilastri.slice(0, 5);
    assert.ok(validaOutputAI(j).some(m => /esattamente 6/.test(m)));
  });

  test('pilastri: ordine canonico non rispettato', () => {
    const j = outputValido();
    [j.pilastri[0], j.pilastri[1]] = [j.pilastri[1], j.pilastri[0]];
    assert.ok(validaOutputAI(j).some(m => /ordine canonico/.test(m)));
  });

  test('pilastro: campo di testo mancante', () => {
    const j = outputValido(); delete j.pilastri[2].aspettoDaApprofondire;
    assert.ok(validaOutputAI(j).some(m => /pilastri\[2\]\.aspettoDaApprofondire/.test(m)));
  });

  test('pilastro: convergenzeDiscrepanze incompleto', () => {
    const j = outputValido(); delete j.pilastri[0].convergenzeDiscrepanze.discrepanze;
    assert.ok(validaOutputAI(j).some(m => /convergenzeDiscrepanze\.discrepanze/.test(m)));
  });

  test('pilastro: fonti vuote (serve almeno 1 riferimento)', () => {
    const j = outputValido(); j.pilastri[1].fonti = [];
    assert.ok(validaOutputAI(j).some(m => /pilastri\[1\]\.fonti deve contenere almeno 1/.test(m)));
  });

  test('fonte con scheda non A/B/C', () => {
    const j = outputValido(); j.pilastri[0].fonti[0].scheda = 'X';
    assert.ok(validaOutputAI(j).some(m => /non è A\/B\/C/.test(m)));
  });

  test('letturaTrasversale mancante o malformata', () => {
    const j1 = outputValido(); delete j1.letturaTrasversale;
    assert.ok(validaOutputAI(j1).some(m => /letturaTrasversale mancante/.test(m)));
    const j2 = outputValido(); j2.letturaTrasversale.risorse = 'niente';
    assert.ok(validaOutputAI(j2).some(m => /letturaTrasversale\.risorse deve essere un array/.test(m)));
  });

  test('letturaTrasversale: item senza testo / senza fonti', () => {
    const j = outputValido();
    j.letturaTrasversale.risorse = [{ fonti: [] }];
    const err = validaOutputAI(j);
    assert.ok(err.some(m => /risorse\[0\]\.testo/.test(m)));
    assert.ok(err.some(m => /risorse\[0\]\.fonti deve contenere almeno 1/.test(m)));
  });

  test('chiavi extra non note → tollerate', () => {
    const j = outputValido();
    j.notaMetodologica = 'ignorata qui';
    j.__extra = 123;
    assert.deepEqual(validaOutputAI(j), []);
  });
});

// ── analizzaCoerenzaFonti (avvisi non bloccanti) ──────────────────────
describe('analizzaCoerenzaFonti', () => {
  test('output valido → nessun avviso', () => {
    assert.deepEqual(analizzaCoerenzaFonti(outputValido()), []);
  });

  test('indicatore inesistente citato da A', () => {
    const j = outputValido();
    j.pilastri[0].fonti[0].elementoId = 'self_99';
    assert.ok(analizzaCoerenzaFonti(j).some(m => /non è un indicatore PPU noto/.test(m)));
  });

  test('indicatore attribuito al pilastro sbagliato', () => {
    const j = outputValido();
    j.pilastri[0].fonti.push({ scheda: 'B', pilastro: 'self', elementoId: 'future_01' });
    assert.ok(analizzaCoerenzaFonti(j).some(m => /non appartiene al pilastro "self"/.test(m)));
  });

  test('CLOSING_ID citato da A → nessun avviso', () => {
    const j = outputValido();
    j.pilastri[0].fonti.push({ scheda: 'A', pilastro: 'self', elementoId: 'chosenGrowthArea' });
    assert.deepEqual(analizzaCoerenzaFonti(j), []);
  });

  test('id libero non riconoscibile citato da A → avviso', () => {
    const j = outputValido();
    j.pilastri[0].fonti.push({ scheda: 'A', pilastro: 'self', elementoId: 'areaNotes.self' });
    assert.ok(analizzaCoerenzaFonti(j).some(m => /non è né un indicatore né una domanda di chiusura/.test(m)));
  });

  test('nome persona citato da C → nessun avviso (elementoId libero ammesso per C)', () => {
    const j = outputValido();
    j.pilastri[1].fonti.push({ scheda: 'C', pilastro: 'others', elementoId: 'Prof. Rossi' });
    assert.deepEqual(analizzaCoerenzaFonti(j), []);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 4 — logica pura per l'interfaccia di consultazione
// ═══════════════════════════════════════════════════════════════════════
function docD(over = {}) {
  return {
    id: 'd1', minorId: 'm1', comunitaId: 'itaca',
    stato: 'GENERATA',
    generatedAt: 3000,
    ppuMoment: 'ingresso', ppuMomentNote: '',
    sourceAId: 'a1', sourceBId: 'b1', sourceCId: 'c1',
    fonti: {
      a: { schedaId: 'a1', completedAt: 1000 },
      b: { schedaId: 'b1', completedAt: 1000 },
      c: { schedaId: 'c1', completedAt: 1000 },
    },
    modelloAI: 'claude-test', promptVersion: 1,
    notaMetodologica: NOTA_METODOLOGICA,
    contenutoAI: contenutoValido(),
    createdAt: 3000, updatedAt: 3000, validatedAt: null, validatedBy: null,
    ...over,
  };
}
function contenutoValido() {
  const pilastri = PILASTRI_ID.map((pid) => ({
    pilastro: pid,
    comeMiVedo: `A ${pid}`,
    comeMiVedonoGliAltri: `B ${pid}`,
    elementiRete: 'La Scheda C non contiene elementi pertinenti per questo pilastro.',
    convergenzeDiscrepanze: { convergenze: 'conv', discrepanze: 'discr', datiInsufficienti: '' },
    letturaEducativaPossibile: 'potrebbe essere utile esplorare…',
    aspettoDaApprofondire: 'Cosa osservare?',
    fonti: [{ scheda: 'A', pilastro: pid, elementoId: `${pid}_01` }],
  }));
  return {
    sintesiGenerale: 'Testo di sintesi generale.',
    pilastri,
    letturaTrasversale: {
      risorse: [{ testo: 'una risorsa', fonti: [{ scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:persona:n_mamma' }] }],
      aspettiAttenzione: [{ testo: 'un aspetto', fonti: [{ scheda: 'A', pilastro: 'self', elementoId: 'self_02' }] }],
      elementiDaApprofondire: [{ testo: 'un elemento', fonti: [] }],
    },
  };
}

describe('ordinaSchedeDPerGenerazione', () => {
  test('dalla piu recente alla piu vecchia (generatedAt, poi createdAt)', () => {
    const a = docD({ id: 'a', generatedAt: 100 });
    const b = docD({ id: 'b', generatedAt: 500 });
    const c = docD({ id: 'c', generatedAt: undefined, createdAt: 300 });
    assert.deepEqual(ordinaSchedeDPerGenerazione([a, b, c]).map((x) => x.id), ['b', 'c', 'a']);
    assert.deepEqual(ordinaSchedeDPerGenerazione(null), []);
  });
});

describe('statoRigaMomento', () => {
  const gruppoGen = () => raggruppaFontiPerMomento([schedaA()], [schedaB()], [schedaC()])[0];
  test('con D -> stato della D piu recente', () => {
    assert.equal(
      statoRigaMomento(gruppoGen(), [docD({ id: 'x', generatedAt: 1, stato: 'GENERATA' }), docD({ id: 'y', generatedAt: 9, stato: 'VALIDATA' })]),
      'VALIDATA',
    );
  });
  test('senza D, terna completa -> DA_GENERARE', () => {
    assert.equal(statoRigaMomento(gruppoGen(), []), 'DA_GENERARE');
  });
  test('senza D, terna incompleta -> NON_GENERABILE', () => {
    const [g] = raggruppaFontiPerMomento([schedaA()], [schedaB()], []);
    assert.equal(statoRigaMomento(g, []), 'NON_GENERABILE');
  });
});

describe('confrontaFontiConGruppo', () => {
  test('A completata piu recente (id diverso, ts maggiore) -> piuRecenti ["A"]', () => {
    const d = docD();
    const gruppo = raggruppaFontiPerMomento(
      [schedaA({ id: 'a1', completedAt: 1000 }), schedaA({ id: 'a2', completedAt: 5000 })],
      [schedaB({ id: 'b1', completedAt: 1000 })],
      [schedaC({ id: 'c1', completedAt: 1000 })],
    )[0];
    const r = confrontaFontiConGruppo(d, gruppo);
    assert.deepEqual(r.piuRecenti, ['A']);
    assert.equal(r.haNovita, true);
  });
  test('stesse fonti congelate -> nessuna novita', () => {
    const d = docD();
    const gruppo = raggruppaFontiPerMomento(
      [schedaA({ id: 'a1', completedAt: 1000 })],
      [schedaB({ id: 'b1', completedAt: 1000 })],
      [schedaC({ id: 'c1', completedAt: 1000 })],
    )[0];
    assert.deepEqual(confrontaFontiConGruppo(d, gruppo), { piuRecenti: [], haNovita: false });
  });
  test('id diverso ma piu vecchio -> non e novita', () => {
    const d = docD();
    const gruppo = raggruppaFontiPerMomento(
      [schedaA({ id: 'a0', completedAt: 200 })],
      [schedaB({ id: 'b1', completedAt: 1000 })],
      [schedaC({ id: 'c1', completedAt: 1000 })],
    )[0];
    assert.equal(confrontaFontiConGruppo(d, gruppo).haNovita, false);
  });
  test('senza gruppo -> nessuna novita', () => {
    assert.equal(confrontaFontiConGruppo(docD(), null).haNovita, false);
  });
});

describe('elencaMomenti', () => {
  test('un momento con terna completa e nessuna D -> DA_GENERARE, generabile', () => {
    const righe = elencaMomenti(raggruppaFontiPerMomento([schedaA()], [schedaB()], [schedaC()]), []);
    assert.equal(righe.length, 1);
    assert.equal(righe[0].label, 'Ingresso');
    assert.equal(righe[0].stato, 'DA_GENERARE');
    assert.equal(righe[0].generabile, true);
    assert.deepEqual(righe[0].fonti, { A: 'completata', B: 'completata', C: 'completata' });
  });

  test('momenti diversi restano separati, ordinati cronologicamente', () => {
    const listA = [schedaA({ id: 'ai', ppuMoment: 'ingresso' }), schedaA({ id: 'au', ppuMoment: 'uscita' })];
    const righe = elencaMomenti(
      raggruppaFontiPerMomento(listA, [schedaB({ ppuMoment: 'ingresso' })], [schedaC({ ppuMoment: 'ingresso' })]),
      [],
    );
    assert.deepEqual(righe.map((r) => r.chiave), ['ingresso', 'uscita']);
    assert.equal(righe.find((r) => r.chiave === 'uscita').stato, 'NON_GENERABILE');
  });

  test('momento con SOLO una D (fonti non piu presenti) resta elencato', () => {
    const righe = elencaMomenti([], [docD({ id: 'dd', ppuMoment: 'verifica_3_mesi', stato: 'VALIDATA' })]);
    assert.equal(righe.length, 1);
    assert.equal(righe[0].chiave, 'verifica_3_mesi');
    assert.equal(righe[0].stato, 'VALIDATA');
    assert.equal(righe[0].generabile, false);
    assert.equal(righe[0].schedeD.length, 1);
  });

  test('piu D nello stesso momento -> versioni ordinate (piu recente prima)', () => {
    const gruppi = raggruppaFontiPerMomento([schedaA()], [schedaB()], [schedaC()]);
    const righe = elencaMomenti(gruppi, [
      docD({ id: 'v1', generatedAt: 1000, stato: 'VALIDATA' }),
      docD({ id: 'v2', generatedAt: 2000, stato: 'GENERATA' }),
    ]);
    assert.deepEqual(righe[0].schedeD.map((d) => d.id), ['v2', 'v1']);
    assert.equal(righe[0].stato, 'GENERATA');
    assert.equal(righe[0].latestD.id, 'v2');
  });

  test('D esistente + A piu recente disponibile -> novita.haNovita true', () => {
    const gruppi = raggruppaFontiPerMomento(
      [schedaA({ id: 'a1', completedAt: 1000 }), schedaA({ id: 'a2', completedAt: 9000 })],
      [schedaB({ id: 'b1', completedAt: 1000 })],
      [schedaC({ id: 'c1', completedAt: 1000 })],
    );
    const righe = elencaMomenti(gruppi, [docD({ generatedAt: 3000 })]);
    assert.equal(righe[0].novita.haNovita, true);
    assert.deepEqual(righe[0].novita.piuRecenti, ['A']);
  });
});

describe('messaggioErroreGenerazione', () => {
  test('mappa i codici callable in testo per l educatore', () => {
    assert.match(messaggioErroreGenerazione({ code: 'functions/permission-denied' }), /permessi/);
    assert.match(messaggioErroreGenerazione({ code: 'functions/aborted' }), /gia in corso|già in corso/);
    assert.match(messaggioErroreGenerazione({ code: 'functions/unavailable' }), /non e al momento disponibile|non è al momento disponibile/);
    assert.match(messaggioErroreGenerazione({ code: 'unauthenticated' }), /sessione/i);
  });
  test('deadline-exceeded -> avvisa che la generazione puo essere ancora in corso, non "errore imprevisto"', () => {
    const m = messaggioErroreGenerazione({ code: 'functions/deadline-exceeded' });
    assert.match(m, /ancora in corso/i);
    assert.match(m, /Ricarica la pagina/i);
    assert.ok(!/errore imprevisto/i.test(m));
  });
  test('failed-precondition riporta il messaggio (gia leggibile) del server', () => {
    const m = messaggioErroreGenerazione({ code: 'functions/failed-precondition', message: 'Per il momento «Ingresso» manca la Scheda C — Le persone intorno a me.' });
    assert.match(m, /manca la Scheda C/);
  });
  test('internal di coerenza -> testo del server; internal generico -> messaggio prudente', () => {
    assert.match(
      messaggioErroreGenerazione({ code: 'functions/internal', message: 'La sintesi non ha superato i controlli di coerenza. Nessun dato e stato salvato.' }),
      /controlli di coerenza/,
    );
    assert.match(messaggioErroreGenerazione({ code: 'functions/internal', message: 'boom' }), /Nessun dato/);
  });
  test('nessun dato tecnico nei messaggi', () => {
    for (const c of ['permission-denied', 'aborted', 'unavailable', 'internal', 'boh']) {
      const m = messaggioErroreGenerazione({ code: 'functions/' + c, message: 'stack trace: Error at X:1' });
      assert.ok(!/stack trace/i.test(m) || /coerenza/i.test(m));
    }
  });
});

const CTX_RIC = {
  domandaA: { self_02: 'Ti provocano davanti agli altri. Cosa ti assomiglia di piu?' },
  opzioniA: { self_02: { NO: 'Non saprei.', 1: 'Reagisco d istinto.', 2: 'A volte ci casco.', 3: 'Decido io come reagire.' } },
  domandaB: { self_02: 'Cosa pensi direbbero di come reagisci?' },
  opzioniB: { self_02: { NO: 'Non saprei.', 1: '"Parti subito."', 2: '"A volte lasci correre."', 3: '"Decidi tu."' } },
  chiusuraA: { perceivedStrength: 'Quale di queste cose pensi di saper fare meglio?' },
  schedaA: {
    id: 'a1',
    risposte: { self_02: 3 },
    closing: { perceivedStrength: 'So ascoltare gli altri', desiredImprovement: '', chosenGrowthArea: '' },
  },
  schedaB: { id: 'b1', risposte: { self_02: 'NO' } },
  schedaC: {
    id: 'c1',
    sociogrammi: {
      vicinanza: {
        nodes: [
          { id: 'io', isCenter: true, name: 'IO', x: 0.5, y: 0.5 },
          { id: 'n_mamma', name: 'Mamma', x: 0.42, y: 0.44, distance: 0.2 },
        ],
        edges: [{ id: 'e_1', source: 'io', target: 'n_mamma', direction: 'both', quality: 'green' }],
      },
      fatica: { nodes: [{ id: 'io', isCenter: true, name: 'IO' }], edges: [] },
    },
  },
};

describe('ricostruisciFonte', () => {
  test('indicatore Scheda A: domanda + risposta effettiva dalla scheda congelata', () => {
    const f = ricostruisciFonte({ scheda: 'A', pilastro: 'self', elementoId: 'self_02' }, CTX_RIC);
    assert.equal(f.tipo, 'indicatore');
    assert.equal(f.schedaLabel, 'Scheda A — Come mi vedo');
    assert.equal(f.domanda, CTX_RIC.domandaA.self_02);
    assert.equal(f.valore, 3);
    assert.equal(f.testoRisposta, 'Decido io come reagire.');
  });
  test('indicatore Scheda B con risposta "NO" -> testo dell opzione NO', () => {
    const f = ricostruisciFonte({ scheda: 'B', pilastro: 'self', elementoId: 'self_02' }, CTX_RIC);
    assert.equal(f.valore, 'NO');
    assert.equal(f.testoRisposta, 'Non saprei.');
    assert.equal(f.schedaLabel, 'Scheda B — Come penso che mi vedano gli altri');
  });
  test('domanda di chiusura Scheda A', () => {
    const f = ricostruisciFonte({ scheda: 'A', pilastro: 'self', elementoId: 'perceivedStrength' }, CTX_RIC);
    assert.equal(f.tipo, 'chiusura');
    assert.equal(f.domanda, CTX_RIC.chiusuraA.perceivedStrength);
    assert.equal(f.risposta, 'So ascoltare gli altri');
  });
  test('chiusura senza risposta -> risposta null', () => {
    const f = ricostruisciFonte({ scheda: 'A', pilastro: 'future', elementoId: 'desiredImprovement' }, CTX_RIC);
    assert.equal(f.risposta, null);
  });
  test('rete C persona: nome + distanza', () => {
    const f = ricostruisciFonte({ scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:persona:n_mamma' }, CTX_RIC);
    assert.equal(f.tipo, 'rete');
    assert.equal(f.rete, 'vicinanza');
    assert.equal(f.kind, 'persona');
    assert.equal(f.nome, 'Mamma');
    assert.equal(f.distanza, 0.2);
  });
  test('rete C legame: da/a, direzione, qualita', () => {
    const f = ricostruisciFonte({ scheda: 'C', pilastro: 'others', elementoId: 'vicinanza:legame:e_1' }, CTX_RIC);
    assert.equal(f.kind, 'legame');
    assert.equal(f.da, 'IO');
    assert.equal(f.a, 'Mamma');
    assert.ok(f.direzione && f.direzione !== 'non specificata');
    assert.ok(f.qualita && f.qualita !== 'non specificata');
  });
  test('fonte congelata non piu disponibile (schedaA null) -> errore leggibile', () => {
    const f = ricostruisciFonte({ scheda: 'A', pilastro: 'self', elementoId: 'self_02' }, { ...CTX_RIC, schedaA: null });
    assert.match(f.errore, /non e piu disponibile|non è più disponibile/);
  });
  test('riferimento malformato -> errore leggibile', () => {
    assert.match(ricostruisciFonte({ scheda: 'A', pilastro: 'self', elementoId: '' }, CTX_RIC).errore, /non valido/);
    assert.match(ricostruisciFonte({ scheda: 'Z', pilastro: 'self', elementoId: 'x' }, CTX_RIC).errore, /non valido/);
    assert.match(ricostruisciFonte({ scheda: 'C', pilastro: 'self', elementoId: 'vicinanza:cosa:x' }, CTX_RIC).errore, /non riconosciuto/);
  });
  test('persona C non presente nella rete congelata -> errore', () => {
    const f = ricostruisciFonte({ scheda: 'C', pilastro: 'self', elementoId: 'vicinanza:persona:n_ghost' }, CTX_RIC);
    assert.equal(f.tipo, 'rete');
    assert.match(f.errore, /non e piu presente|non è più presente/);
  });
  test('indicatore inesistente -> errore', () => {
    assert.match(ricostruisciFonte({ scheda: 'A', pilastro: 'self', elementoId: 'self_99' }, CTX_RIC).errore, /non riconosciuto/);
  });
});

describe('renderFonteHTML / pannello', () => {
  test('indicatore', () => {
    const h = renderFonteHTML(ricostruisciFonte({ scheda: 'A', pilastro: 'self', elementoId: 'self_02' }, CTX_RIC));
    assert.match(h, /Fonte: Scheda A — Come mi vedo/);
    assert.match(h, /Decido io come reagire\./);
  });
  test('errore', () => {
    const h = renderFonteHTML({ scheda: 'C', schedaLabel: LABEL_SCHEDE.C, errore: 'La persona indicata non e piu presente nella rete.' });
    assert.match(h, /ppud-fonte-err/);
  });
  test('pannello vuoto', () => {
    assert.match(renderFontiPannelloHTML([]), /Nessun elemento di origine/);
  });
});

describe('toggle "Mostra / Nascondi elementi di origine"', () => {
  // DOM finto minimo: solo ciò che il toggle di wireFonti tocca.
  function fakeToggle() {
    const btn = {
      _attrs: { 'aria-expanded': 'false' },
      textContent: 'Mostra elementi di origine',
      getAttribute(n) { return this._attrs[n] ?? null; },
      setAttribute(n, v) { this._attrs[n] = String(v); },
    };
    const pan = { hidden: true, dataset: {}, caricamenti: 0 };
    // Replica esatta di ciò che fa il listener in js/ppu-scheda-d.js.
    function click() {
      const s = prossimoStatoToggleFonti({
        apertoOra: btn.getAttribute('aria-expanded') === 'true',
        giaCaricato: pan.dataset.caricato === '1',
      });
      btn.setAttribute('aria-expanded', s.ariaExpanded);
      btn.textContent = s.etichetta;
      pan.hidden = s.hidden;
      if (s.deveCaricare) { pan.caricamenti += 1; pan.dataset.caricato = '1'; }
      return s;
    }
    return { btn, pan, click };
  }

  test('mostra → visibile → nascondi → non visibile → mostra di nuovo → visibile', () => {
    const { btn, pan, click } = fakeToggle();
    assert.equal(pan.hidden, true);
    assert.equal(btn.textContent, 'Mostra elementi di origine');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');

    // 1° click → MOSTRA
    click();
    assert.equal(pan.hidden, false, 'dopo "Mostra" il pannello è visibile');
    assert.equal(btn.textContent, 'Nascondi elementi di origine');
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    assert.equal(pan.caricamenti, 1);

    // 2° click → NASCONDI
    click();
    assert.equal(pan.hidden, true, 'dopo "Nascondi" il pannello NON è visibile');
    assert.equal(btn.textContent, 'Mostra elementi di origine');
    assert.equal(btn.getAttribute('aria-expanded'), 'false');
    assert.equal(pan.caricamenti, 1, 'la chiusura non rilegge nulla');

    // 3° click → MOSTRA di nuovo
    click();
    assert.equal(pan.hidden, false, 'riapertura: pannello di nuovo visibile');
    assert.equal(btn.textContent, 'Nascondi elementi di origine');
    assert.equal(btn.getAttribute('aria-expanded'), 'true');
    assert.equal(pan.caricamenti, 1, 'riapertura: riusa i dati, nessuna nuova lettura Firestore/AI');
  });

  test('prossimoStatoToggleFonti: forma dello stato in apertura e chiusura', () => {
    assert.deepEqual(
      prossimoStatoToggleFonti({ apertoOra: false, giaCaricato: false }),
      { aperto: true, hidden: false, ariaExpanded: 'true', etichetta: ETICHETTE_TOGGLE_FONTI.aperto, deveCaricare: true },
    );
    assert.deepEqual(
      prossimoStatoToggleFonti({ apertoOra: true, giaCaricato: true }),
      { aperto: false, hidden: true, ariaExpanded: 'false', etichetta: ETICHETTE_TOGGLE_FONTI.chiuso, deveCaricare: false },
    );
    assert.equal(prossimoStatoToggleFonti({ apertoOra: false, giaCaricato: true }).deveCaricare, false,
      'riapertura con dati già in memoria: non ricarica');
    assert.equal(prossimoStatoToggleFonti().aperto, true, 'default: da chiuso ad aperto');
  });

  test('lo stylesheet rende "hidden" autoritativo sul pannello fonti (regressione CSS)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('../js/ppu-scheda-d.js', import.meta.url)), 'utf8');
    assert.match(src, /\.ppud-fonti-pan\[hidden\]\s*\{\s*display:\s*none\s*\}/,
      '.ppud-fonti-pan ha display:grid → serve .ppud-fonti-pan[hidden]{display:none}');
  });
});

describe('renderVistaHTML', () => {
  const html = renderVistaHTML(docD(), { nomeRagazzo: 'Marco B.', comunitaLabel: 'Itaca' });
  test('intestazione: nome locale, comunita, momento, stato', () => {
    assert.match(html, /SCHEDA D/);
    assert.match(html, /Sintesi educativa integrata/);
    assert.match(html, /Marco B\./);
    assert.match(html, /Itaca/);
    assert.match(html, /Ingresso/);
    assert.match(html, /data-stato="GENERATA"/);
    assert.match(html, />Generata</);
  });
  test('nota metodologica visibile nel corpo (non popup)', () => {
    assert.match(html, /ppud-nota-metod/);
    assert.match(html, /non costituisce una valutazione diagnostica/i);
  });
  test('sezione sintesi generale', () => {
    assert.ok(html.includes(TITOLI_D.sintesi));
    assert.match(html, /Testo di sintesi generale\./);
  });
  test('sei pilastri, in ordine, con i campi previsti', () => {
    for (const p of PILASTRI) assert.ok(html.includes(`>${p.ordine}. ${p.nome}<`), `pilastro ${p.ordine}`);
    assert.ok(html.includes('Ciò che emerge da «Come mi vedo»'));
    assert.ok(html.includes('Come penso che mi vedano gli altri'));
    assert.ok(html.includes('Elementi della rete collegati'));
    assert.ok(html.includes('Convergenze'));
    assert.ok(html.includes('Discrepanze'));
    assert.ok(html.includes('Dati insufficienti / aspetti non leggibili'));
  });
  test('la lettura educativa e marcata come ipotesi AI, distinta dai dati', () => {
    assert.match(html, /ppud-ai/);
    assert.match(html, /Ipotesi elaborata dall.{1,3}assistente AI/);
    assert.ok(html.includes(TITOLI_D.letturaAI));
  });
  test('lettura trasversale con le tre sottosezioni, senza badge di classificazione', () => {
    assert.ok(html.includes(TITOLI_D.trasversale));
    assert.ok(html.includes('Risorse sulle quali fare leva'));
    assert.ok(html.includes('Aspetti che meritano attenzione'));
    assert.ok(html.includes('Elementi da approfondire'));
    for (const vietato of ['POSITIVO', 'NEGATIVO', 'CRITICO', 'RISCHIO']) {
      assert.ok(!html.includes(vietato), `non deve contenere "${vietato}"`);
    }
  });
  test('rilettura equipe: in sola lettura (default) senza controlli di form', () => {
    assert.ok(html.includes(TITOLI_D.rilettura));
    assert.match(html, /non modificano il testo originario/);
    assert.ok(!/<input|<textarea|<select/.test(html), 'nessun controllo di form quando non modificabile');
  });
  test('rilettura equipe: modificabile → chip e textarea presenti', () => {
    const h = renderVistaHTML(docD(), { modificabile: true });
    assert.match(h, /<input type="radio" name="ril-pilastro\.self\.letturaEducativaPossibile"/);
    assert.match(h, /<textarea[^>]*data-ril-obs="pilastro\.self\.aspettoDaApprofondire"/);
    assert.match(h, /<textarea[^>]*data-ril-og/);
    assert.match(h, /data-ril-salva/);
    assert.match(h, /data-ril-valida/);
  });
  test('pulsanti "Mostra elementi di origine" solo dove ci sono fonti', () => {
    assert.match(html, /data-ppud-fonti="pilastro:0"/);
    assert.match(html, /data-ppud-fonti="risorse:0"/);
    assert.match(html, /data-ppud-fonti="aspettiAttenzione:0"/);
    assert.ok(!html.includes('data-ppud-fonti="elementiDaApprofondire:0"'));
  });
  test('stato VALIDATA / IN_RILETTURA mappati', () => {
    assert.match(renderVistaHTML(docD({ stato: 'VALIDATA' }), {}), />Validata</);
    assert.match(renderVistaHTML(docD({ stato: 'IN_RILETTURA' }), {}), />In rilettura</);
  });
});

describe('formatDataD', () => {
  test('formatta un timestamp, gestisce valori assenti', () => {
    assert.equal(formatDataD(null), '—');
    assert.match(formatDataD(Date.parse('2026-09-12T10:00:00Z')), /2026/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 5 — Rilettura e validazione dell'équipe
// ═══════════════════════════════════════════════════════════════════════

describe('elencaElementiRilettura', () => {
  const el = elencaElementiRilettura(contenutoValido());
  test('12 elementi di pilastro + 3 trasversali, chiavi stabili e deterministiche', () => {
    const pil = el.filter(e => e.gruppo === 'pilastro');
    const tr = el.filter(e => e.gruppo === 'trasversale');
    assert.equal(pil.length, 12);
    assert.equal(tr.length, 3); // risorse:0, aspettiAttenzione:0, elementiDaApprofondire:0
    assert.equal(el[0].chiave, 'pilastro.self.letturaEducativaPossibile');
    assert.equal(el[1].chiave, 'pilastro.self.aspettoDaApprofondire');
    assert.ok(el.some(e => e.chiave === 'pilastro.wellbeing.aspettoDaApprofondire'));
    assert.ok(el.some(e => e.chiave === 'trasversale.risorse.0'));
    assert.ok(el.some(e => e.chiave === 'trasversale.elementiDaApprofondire.0'));
    // ricostruibile: stesse chiavi a parità di contenutoAI
    assert.deepEqual(el.map(e => e.chiave), elencaElementiRilettura(contenutoValido()).map(e => e.chiave));
  });
  test('nessun testo AI usato come chiave', () => {
    for (const e of el) assert.match(e.chiave, /^(pilastro\.[a-z]+\.(letturaEducativaPossibile|aspettoDaApprofondire)|trasversale\.(risorse|aspettiAttenzione|elementiDaApprofondire)\.\d+|chiave\.\d+)$/);
  });
  test('porta con sé il testo AII dell\'elemento', () => {
    const x = el.find(e => e.chiave === 'trasversale.risorse.0');
    assert.equal(x.testoAI, 'una risorsa');
  });
});

describe('validaRiletturaEquipe', () => {
  const c = contenutoValido();
  test('rilettura null → valida', () => {
    assert.deepEqual(validaRiletturaEquipe(null, c), []);
  });
  test('tutti e 4 gli enum sono accettati', () => {
    for (const v of VALUTAZIONI_RILETTURA_ID) {
      const r = { ipotesi: { 'pilastro.self.letturaEducativaPossibile': { valutazione: v } } };
      assert.deepEqual(validaRiletturaEquipe(r, c), [], v);
    }
  });
  test('enum inventato → errore', () => {
    const r = { ipotesi: { 'pilastro.self.letturaEducativaPossibile': { valutazione: 'quasi' } } };
    assert.ok(validaRiletturaEquipe(r, c).some(m => /non ammessa/.test(m)));
  });
  test('chiave ipotesi inesistente → errore', () => {
    const r = { ipotesi: { 'pilastro.self.qualcosa': { valutazione: 'conferma' } } };
    assert.ok(validaRiletturaEquipe(r, c).some(m => /inesistente/.test(m)));
  });
  test('osservazioni non stringa → errore', () => {
    const r = { ipotesi: { 'pilastro.self.letturaEducativaPossibile': { valutazione: 'integra', osservazioni: 42 } } };
    assert.ok(validaRiletturaEquipe(r, c).some(m => /devono essere testo/.test(m)));
  });
  test('limite caratteri osservazione (2000)', () => {
    const r = { ipotesi: { 'pilastro.self.letturaEducativaPossibile': { valutazione: 'integra', osservazioni: 'x'.repeat(LIMITI_RILETTURA.osservazione + 1) } } };
    assert.ok(validaRiletturaEquipe(r, c).some(m => /oltre 2000/.test(m)));
    const ok = { ipotesi: { 'pilastro.self.letturaEducativaPossibile': { valutazione: 'integra', osservazioni: 'x'.repeat(LIMITI_RILETTURA.osservazione) } } };
    assert.deepEqual(validaRiletturaEquipe(ok, c), []);
  });
  test('osservazioniGenerali stringa e limite (5000)', () => {
    assert.deepEqual(validaRiletturaEquipe({ osservazioniGenerali: 'nota' }, c), []);
    assert.ok(validaRiletturaEquipe({ osservazioniGenerali: 5 }, c).some(m => /deve essere testo/.test(m)));
    assert.ok(validaRiletturaEquipe({ osservazioniGenerali: 'x'.repeat(5001) }, c).some(m => /oltre 5000/.test(m)));
  });
  test('chiave arbitraria a livello top → errore', () => {
    assert.ok(validaRiletturaEquipe({ hackField: 1 }, c).some(m => /non previsto/.test(m)));
  });
  test('ipotesi come array → errore', () => {
    assert.ok(validaRiletturaEquipe({ ipotesi: [] }, c).some(m => /deve essere un oggetto/.test(m)));
  });
  test('voce con campo extra → errore', () => {
    const r = { ipotesi: { 'pilastro.self.letturaEducativaPossibile': { valutazione: 'conferma', autore: 'x' } } };
    assert.ok(validaRiletturaEquipe(r, c).some(m => /campi non previsti/.test(m)));
  });
  test('riletturaBy non lista di stringhe → errore', () => {
    assert.ok(validaRiletturaEquipe({ riletturaBy: [1, 2] }, c).some(m => /elenco di identificativi/.test(m)));
  });
});

describe('riletturaSignificativa', () => {
  test('rilettura vuota / null / solo struttura → non significativa', () => {
    assert.equal(riletturaSignificativa(null), false);
    assert.equal(riletturaSignificativa({ ipotesi: {}, osservazioniGenerali: '' }), false);
    assert.equal(riletturaSignificativa({ ipotesi: { k: {} }, osservazioniGenerali: '   ' }), false);
  });
  test('una valutazione → significativa', () => {
    assert.equal(riletturaSignificativa({ ipotesi: { k: { valutazione: 'conferma' } } }), true);
  });
  test('una osservazione per elemento → significativa', () => {
    assert.equal(riletturaSignificativa({ ipotesi: { k: { osservazioni: 'qualcosa' } } }), true);
  });
  test('osservazioni generali non vuote → significativa', () => {
    assert.equal(riletturaSignificativa({ ipotesi: {}, osservazioniGenerali: 'nota trasversale' }), true);
  });
});

describe('mergeRiletturaBy', () => {
  test('preserva gli UID esistenti e aggiunge il corrente', () => {
    assert.deepEqual(mergeRiletturaBy(['u1'], 'u2'), ['u1', 'u2']);
    assert.deepEqual(mergeRiletturaBy(['u1', 'u2'], 'u2'), ['u1', 'u2']); // già presente
    assert.deepEqual(mergeRiletturaBy(null, 'u1'), ['u1']);
    assert.deepEqual(mergeRiletturaBy(['u1'], null), ['u1']);
    assert.deepEqual(mergeRiletturaBy([1, 'u1', ''], 'u2'), ['u1', 'u2']); // scarta non-stringhe
  });
});

describe('costruisciRiletturaDaValori', () => {
  const c = contenutoValido();
  test('scarta voci vuote e chiavi non rileggibili; trimma osservazioni', () => {
    const r = costruisciRiletturaDaValori({
      valori: {
        'pilastro.self.letturaEducativaPossibile': { valutazione: 'conferma', osservazioni: '' },
        'pilastro.self.aspettoDaApprofondire': { valutazione: null, osservazioni: '  visto in mensa  ' },
        'pilastro.others.letturaEducativaPossibile': { valutazione: null, osservazioni: '' }, // vuota → scartata
        'chiave.inventata': { valutazione: 'conferma' }, // non rileggibile → scartata
        'trasversale.risorse.0': { valutazione: 'integra', osservazioni: 'da chiarire' },
      },
      osservazioniGenerali: '  nota generale  ',
      riletturaByEsistente: ['u1'],
      uid: 'u2',
    }, c);
    assert.deepEqual(Object.keys(r.ipotesi).sort(), ['pilastro.self.aspettoDaApprofondire', 'pilastro.self.letturaEducativaPossibile', 'trasversale.risorse.0']);
    assert.deepEqual(r.ipotesi['pilastro.self.letturaEducativaPossibile'], { valutazione: 'conferma' });
    assert.deepEqual(r.ipotesi['pilastro.self.aspettoDaApprofondire'], { osservazioni: 'visto in mensa' });
    assert.equal(r.osservazioniGenerali, 'nota generale');
    assert.deepEqual(r.riletturaBy, ['u1', 'u2']);
  });
  test('output supera validaRiletturaEquipe', () => {
    const r = costruisciRiletturaDaValori({
      valori: { 'pilastro.future.letturaEducativaPossibile': { valutazione: 'da_approfondire', osservazioni: 'x' } },
      osservazioniGenerali: '', riletturaByEsistente: [], uid: 'u1',
    }, c);
    assert.deepEqual(validaRiletturaEquipe(r, c), []);
  });
});

describe('renderRiletturaHTML', () => {
  test('sola lettura: nessun input/textarea, mostra valutazioni salvate', () => {
    const d = docD({
      stato: 'VALIDATA',
      rilettura: { ipotesi: { 'pilastro.self.letturaEducativaPossibile': { valutazione: 'conferma', osservazioni: 'confermato' } }, osservazioniGenerali: 'ben fatto', riletturaBy: ['u1'] },
    });
    const h = renderRiletturaHTML(d, { modificabile: false, validataInfo: { data: '12 settembre 2026', nome: 'Anna R.' } });
    assert.ok(!/<input|<textarea/.test(h));
    assert.match(h, /Scheda validata/);
    assert.match(h, /Validata il 12 settembre 2026/);
    assert.match(h, /Validata da Anna R\./);
    assert.match(h, /Conferma/);
    assert.match(h, /confermato/);
    assert.match(h, /ben fatto/);
  });
  test('sola lettura senza nome operatore → formulazione neutra, nessun UID', () => {
    const h = renderRiletturaHTML(docD({ stato: 'VALIDATA' }), { modificabile: false, validataInfo: { data: 'x', nome: '' } });
    assert.match(h, /un operatore dell.{1,3}équipe/);
  });
  test('modificabile: 4 chip per ogni elemento + textarea + osservazioni generali + azioni', () => {
    const h = renderRiletturaHTML(docD(), { modificabile: true });
    for (const v of VALUTAZIONI_RILETTURA) assert.ok(h.includes(`value="${v.id}"`), v.id);
    assert.match(h, /data-ril-obs="pilastro\.self\.letturaEducativaPossibile"/);
    assert.match(h, /data-ril-og/);
    assert.match(h, /data-ril-salva/);
    assert.match(h, /data-ril-valida\b/);
    assert.match(h, /data-ril-valida-def/);
    assert.match(h, /Vuoi validare definitivamente/);
    assert.ok(h.includes('conferma di aver preso visione'));
  });
  test('modificabile: pre-compila valutazione e osservazioni salvate', () => {
    const d = docD({ stato: 'IN_RILETTURA', rilettura: { ipotesi: { 'pilastro.others.aspettoDaApprofondire': { valutazione: 'integra', osservazioni: 'nota salvata' } }, osservazioniGenerali: 'OG salvata', riletturaBy: ['u1'] } });
    const h = renderRiletturaHTML(d, { modificabile: true });
    assert.match(h, /name="ril-pilastro\.others\.aspettoDaApprofondire" value="integra" checked/);
    assert.match(h, />nota salvata<\/textarea>/);
    assert.match(h, />OG salvata<\/textarea>/);
  });
  test('nessun colore/semaforo/percentuale/score', () => {
    const h = renderRiletturaHTML(docD(), { modificabile: true });
    for (const bad of ['POSITIVO', 'NEGATIVO', 'CRITICO', 'semaforo', '%', 'score', 'punteggio']) {
      assert.ok(!h.includes(bad), bad);
    }
  });
});

describe('renderVistaHTML — integrazione rilettura', () => {
  test('GENERATA modificabile: sezione rilettura editabile presente, contenuto AI immutato', () => {
    const d = docD({ stato: 'GENERATA' });
    const h = renderVistaHTML(d, { nomeRagazzo: 'M.', modificabile: true });
    assert.ok(h.includes(TITOLI_D.rilettura));
    assert.match(h, /data-ril-modificabile="1"/);
    assert.match(h, /<textarea[^>]*data-ril-obs=/);
    // il testo AI resta quello del contenutoAI
    assert.match(h, /Testo di sintesi generale\./);
  });
  test('VALIDATA: sezione rilettura in sola lettura, nessun controllo, banner validata', () => {
    const d = docD({ stato: 'VALIDATA', validatedAt: Date.parse('2026-09-20'), validatedBy: 'u9' });
    const h = renderVistaHTML(d, { modificabile: false, validataInfo: { data: '20 settembre 2026', nome: 'B.' } });
    assert.match(h, /data-ril-modificabile="0"/);
    assert.ok(!/<input|<textarea/.test(h));
    assert.match(h, /Scheda validata/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 6 — Chiavi psico-pedagogiche (contenutoAI.chiaviPsicoPedagogiche)
// ═══════════════════════════════════════════════════════════════════════
import { readFileSync as _readFileSync } from 'node:fs';
import { fileURLToPath as _fileURLToPath } from 'node:url';
const readSorgente = (rel) => _readFileSync(_fileURLToPath(new URL('../' + rel, import.meta.url)), 'utf8');

function chiavePP(over = {}) {
  return {
    ambito: 'pilastro',
    pilastro: 'self',
    configurazioneOsservata: 'A alta sugli indicatori di self, B nettamente piu incerta sugli stessi.',
    questioneEducativa: 'Come va interrogata la distanza tra come si vede e come pensa di essere visto?',
    riferimentoTeorico: {
      autore: 'Autore Esempio',
      teoria: 'Teoria di esempio',
      concetto: 'Concetto specifico di esempio',
      spiegazione: 'Spiegazione breve, corretta e comprensibile a un educatore.',
    },
    pertinenzaNelCaso: 'Aiuta a interrogare proprio questa distanza A/B, senza spiegarla.',
    limitiDellaLettura: 'I dati non permettono di stabilire l origine della distanza.',
    lettureAlternative: ['Verificare se la distanza cambia tra contesti noti e nuovi.'],
    elementiDaOsservare: ['Come descrive a parole la differenza fra le due prospettive.'],
    domandeEquipe: ['In quali situazioni l equipe ritrova o non ritrova questa distanza?'],
    fonti: [{ scheda: 'A', pilastro: 'self', elementoId: 'self_01' }],
    ...over,
  };
}
const outV2 = (chiavi) => ({ ...outputValido(), chiaviPsicoPedagogiche: chiavi });
const contV2 = (chiavi) => ({ ...contenutoValido(), chiaviPsicoPedagogiche: chiavi });

describe('Passo 6 - validaChiaviPsicoPedagogiche (struttura)', () => {
  test('assente su output legacy -> nessun errore, retrocompatibile', () => {
    assert.deepEqual(validaChiaviPsicoPedagogiche(outputValido()), []);
    assert.deepEqual(validaOutputAI(outputValido()), []);
  });
  test('prompt v2 con [] -> valido', () => {
    assert.deepEqual(validaOutputAI(outV2([])), []);
  });
  test('1 chiave valida -> valido', () => {
    assert.deepEqual(validaOutputAI(outV2([chiavePP()])), []);
  });
  test('3 chiavi -> valido; 4 chiavi -> errore (Passo 6C: max 4 → 3)', () => {
    assert.deepEqual(validaOutputAI(outV2([chiavePP(), chiavePP(), chiavePP()])), []);
    assert.ok(validaOutputAI(outV2([chiavePP(), chiavePP(), chiavePP(), chiavePP()]))
      .some(m => /al massimo 3/.test(m)));
  });
  test('MAX_CHIAVI_PP=3, AMBITI_CHIAVE, LIMITI_ARRAY_CHIAVE esposti', () => {
    assert.equal(MAX_CHIAVI_PP, 3);
    assert.deepEqual(AMBITI_CHIAVE, ['pilastro', 'trasversale']);
  });
  test('tetti d\'array chiave: lettureAlternative ≤2, elementiDaOsservare ≤3, domandeEquipe ≤3', () => {
    assert.ok(validaChiaviPsicoPedagogiche(outV2([chiavePP({ lettureAlternative: ['a', 'b', 'c'] })])).some(m => /lettureAlternative: al massimo 2/.test(m)));
    assert.ok(validaChiaviPsicoPedagogiche(outV2([chiavePP({ elementiDaOsservare: ['a', 'b', 'c', 'd'] })])).some(m => /elementiDaOsservare: al massimo 3/.test(m)));
    assert.ok(validaChiaviPsicoPedagogiche(outV2([chiavePP({ domandeEquipe: ['a', 'b', 'c', 'd'] })])).some(m => /domandeEquipe: al massimo 3/.test(m)));
    assert.deepEqual(validaChiaviPsicoPedagogiche(outV2([chiavePP({ lettureAlternative: ['a', 'b'], elementiDaOsservare: ['x', 'y', 'z'], domandeEquipe: ['p', 'q', 'r'] })])), []);
  });
  test('ambito pilastro con pilastro valido -> OK', () => {
    assert.deepEqual(validaChiaviPsicoPedagogiche(outV2([chiavePP({ ambito: 'pilastro', pilastro: 'others' })])), []);
  });
  test('ambito trasversale con pilastro null -> OK', () => {
    assert.deepEqual(validaChiaviPsicoPedagogiche(outV2([chiavePP({ ambito: 'trasversale', pilastro: null })])), []);
  });
  test('combinazioni incoerenti ambito/pilastro -> errore', () => {
    assert.ok(validaChiaviPsicoPedagogiche(outV2([chiavePP({ ambito: 'pilastro', pilastro: null })]))
      .some(m => /non valido per ambito "pilastro"/.test(m)));
    assert.ok(validaChiaviPsicoPedagogiche(outV2([chiavePP({ ambito: 'trasversale', pilastro: 'self' })]))
      .some(m => /deve essere null per ambito "trasversale"/.test(m)));
    assert.ok(validaChiaviPsicoPedagogiche(outV2([chiavePP({ ambito: 'boh' })]))
      .some(m => /ambito .* non valido/.test(m)));
  });
  test('riferimentoTeorico: autore/teoria/concetto/spiegazione vuoti -> errore (ciascuno)', () => {
    for (const campo of ['autore', 'teoria', 'concetto', 'spiegazione']) {
      const k = chiavePP();
      k.riferimentoTeorico = { ...k.riferimentoTeorico, [campo]: '  ' };
      assert.ok(validaChiaviPsicoPedagogiche(outV2([k])).some(m => new RegExp(`riferimentoTeorico\\.${campo} mancante`).test(m)), campo);
    }
    const k2 = chiavePP();
    delete k2.riferimentoTeorico;
    assert.ok(validaChiaviPsicoPedagogiche(outV2([k2])).some(m => /riferimentoTeorico mancante/.test(m)));
  });
  test('campi testuali configurazione/questione/pertinenza/limiti vuoti -> errore', () => {
    for (const campo of ['configurazioneOsservata', 'questioneEducativa', 'pertinenzaNelCaso', 'limitiDellaLettura']) {
      assert.ok(validaChiaviPsicoPedagogiche(outV2([chiavePP({ [campo]: '' })])).some(m => new RegExp(`${campo} mancante`).test(m)), campo);
    }
  });
  test('lettureAlternative / elementiDaOsservare / domandeEquipe non array -> errore', () => {
    for (const campo of ['lettureAlternative', 'elementiDaOsservare', 'domandeEquipe']) {
      assert.ok(validaChiaviPsicoPedagogiche(outV2([chiavePP({ [campo]: 'no' })])).some(m => new RegExp(`${campo} deve essere un array`).test(m)), campo);
    }
  });
  test('elementiDaOsservare / domandeEquipe vuoti -> errore; lettureAlternative [] -> OK', () => {
    assert.ok(validaChiaviPsicoPedagogiche(outV2([chiavePP({ elementiDaOsservare: [] })])).some(m => /elementiDaOsservare deve contenere almeno 1/.test(m)));
    assert.ok(validaChiaviPsicoPedagogiche(outV2([chiavePP({ domandeEquipe: [] })])).some(m => /domandeEquipe deve contenere almeno 1/.test(m)));
    assert.deepEqual(validaChiaviPsicoPedagogiche(outV2([chiavePP({ lettureAlternative: [] })])), []);
  });
  test('fonti vuote -> errore', () => {
    assert.ok(validaChiaviPsicoPedagogiche(outV2([chiavePP({ fonti: [] })])).some(m => /fonti deve contenere almeno 1/.test(m)));
  });
  test('non valida la correttezza teorica: struttura ok = accettata', () => {
    const k = chiavePP({ riferimentoTeorico: { autore: 'Zzz', teoria: 'Teoria X', concetto: 'C', spiegazione: 'S' } });
    assert.deepEqual(validaChiaviPsicoPedagogiche(outV2([k])), []);
  });
});

describe('Passo 6 - elencaElementiRilettura + rilettura della chiave nel suo complesso', () => {
  const c1 = contV2([chiavePP()]);
  const c2 = contV2([chiavePP(), chiavePP({ ambito: 'trasversale', pilastro: null })]);
  test('legacy (nessuna chiave) -> 12 + 3, nessun elemento "chiave"', () => {
    const el = elencaElementiRilettura(contenutoValido());
    assert.equal(el.filter(e => e.gruppo === 'chiave').length, 0);
    assert.equal(el.length, 15);
  });
  test('v2: una voce rileggibile per chiave, chiave stabile "chiave.<i>"', () => {
    const el = elencaElementiRilettura(c2).filter(e => e.gruppo === 'chiave');
    assert.equal(el.length, 2);
    assert.deepEqual(el.map(e => e.chiave), ['chiave.0', 'chiave.1']);
    assert.deepEqual(elencaElementiRilettura(c2).map(e => e.chiave), elencaElementiRilettura(c2).map(e => e.chiave));
  });
  test('la chiave e rileggibile con le 4 valutazioni + una osservazione', () => {
    assert.deepEqual(validaRiletturaEquipe({ ipotesi: { 'chiave.0': { valutazione: 'conferma' } } }, c1), []);
    for (const v of VALUTAZIONI_RILETTURA_ID) {
      assert.deepEqual(validaRiletturaEquipe({ ipotesi: { 'chiave.0': { valutazione: v, osservazioni: 'nota' } } }, c1), [], v);
    }
    assert.ok(validaRiletturaEquipe({ ipotesi: { 'chiave.0.autore': { valutazione: 'conferma' } } }, c1).some(m => /inesistente/.test(m)));
  });
  test('costruisciRiletturaDaValori accetta la chiave e supera la validazione', () => {
    const r = costruisciRiletturaDaValori({
      valori: { 'chiave.0': { valutazione: 'integra', osservazioni: '  da discutere  ' } },
      osservazioniGenerali: '', riletturaByEsistente: [], uid: 'u1',
    }, c1);
    assert.deepEqual(r.ipotesi['chiave.0'], { valutazione: 'integra', osservazioni: 'da discutere' });
    assert.deepEqual(validaRiletturaEquipe(r, c1), []);
  });
});

describe('Passo 6 - rendering', () => {
  const CAPS = ['CONFIGURAZIONE EMERSA', 'QUESTIONE EDUCATIVA', 'LENTE TEORICA', 'IL CONCETTO IN BREVE',
    'PERCH', 'LIMITI DI QUESTA LETTURA', 'COSA OSSERVARE', 'DOMANDE PER L'];
  test('zero chiavi (legacy v1) -> nessuna sezione chiavi, documento comunque reso', () => {
    const h = renderVistaHTML(docD(), { nomeRagazzo: 'M.' });
    assert.ok(!h.includes('ppud-chiavi'));
    assert.ok(!h.includes(TITOLI_D.chiaviPP));
    assert.match(h, /Testo di sintesi generale\./);
  });
  test('v2 con [] -> nessuna sezione chiavi', () => {
    const h = renderVistaHTML(docD({ promptVersion: 2, contenutoAI: contV2([]) }), {});
    assert.ok(!h.includes('ppud-chiavi'));
  });
  test('una chiave -> sezione con gerarchia visiva + fonti tracciabili', () => {
    const h = renderVistaHTML(docD({ promptVersion: 2, contenutoAI: contV2([chiavePP()]) }), {});
    assert.ok(h.includes(TITOLI_D.chiaviPP));
    assert.match(h, /lenti di lettura da discutere e verificare/);
    for (const cap of CAPS) assert.ok(h.includes(cap), cap);
    assert.match(h, /Autore Esempio/);
    assert.match(h, /data-ppud-fonti="chiave:0"/);
  });
  test('"ALTRE LETTURE POSSIBILI" compare solo se presenti', () => {
    assert.match(renderChiavePPHTML(chiavePP({ lettureAlternative: ['una direzione da verificare'] }), 0), /ALTRE LETTURE POSSIBILI/);
    assert.ok(!renderChiavePPHTML(chiavePP({ lettureAlternative: [] }), 0).includes('ALTRE LETTURE POSSIBILI'));
  });
  test('piu chiavi -> un blocco per chiave', () => {
    const h = renderVistaHTML(docD({ promptVersion: 2, contenutoAI: contV2([chiavePP(), chiavePP(), chiavePP()]) }), {});
    assert.equal((h.match(/class="ppud-chiave"/g) || []).length, 3);
    assert.match(h, /data-ppud-fonti="chiave:2"/);
  });
  test('nessun linguaggio diagnostico / semaforo / punteggio aggiunto dall app', () => {
    const h = renderVistaHTML(docD({ promptVersion: 2, contenutoAI: contV2([chiavePP(), chiavePP({ ambito: 'trasversale', pilastro: null })]) }), {});
    for (const bad of ['semaforo', 'punteggio', 'score', 'livello di rischio', 'RISCHIO', 'diagnosi', 'DIAGNOSI', 'badge']) {
      assert.ok(!h.includes(bad), bad);
    }
  });
  test('D VALIDATA -> sezione chiavi in sola lettura (nessun controllo di form)', () => {
    const d = docD({ stato: 'VALIDATA', promptVersion: 2, contenutoAI: contV2([chiavePP()]),
      validatedAt: Date.parse('2026-09-20'), validatedBy: 'u9' });
    const h = renderVistaHTML(d, { modificabile: false, validataInfo: { data: 'x', nome: 'B.' } });
    assert.ok(h.includes(TITOLI_D.chiaviPP));
    const sez = h.slice(h.indexOf('ppud-chiavi'), h.indexOf('ppud-rilettura'));
    assert.ok(!/<input|<textarea|<select/.test(sez));
  });
  test('rilettura modificabile -> un solo gruppo "Chiavi psico-pedagogiche", chip per chiave', () => {
    const h = renderRiletturaHTML(docD({ promptVersion: 2, contenutoAI: contV2([chiavePP(), chiavePP()]) }), { modificabile: true });
    assert.equal((h.match(/Chiavi psico-pedagogiche/g) || []).length, 1);
    assert.match(h, /data-ril-chiave="chiave\.0"/);
    assert.match(h, /data-ril-chiave="chiave\.1"/);
    const blocco = h.slice(h.indexOf('data-ril-chiave="chiave.0"'));
    assert.equal((blocco.match(/type="radio" name="ril-chiave\.0"/g) || []).length, 4);
  });
});

describe('Passo 6 - anti-standardizzazione (nessuna mappa rigida pilastro -> autore)', () => {
  const AUTORI = ['Bandura', 'Vygotskij', 'Bronfenbrenner', 'Erikson', 'Marcia', 'Bowlby', 'Rogers',
    'Cooley', 'Dewey', 'Bruner', 'Freire', 'Kohlberg', 'Winnicott', 'Gardner', 'Antonovsky', 'Seligman'];
  test('model e wiring browser-side non nominano alcun autore', () => {
    for (const f of ['js/ppu-scheda-d-model.js', 'js/ppu-scheda-d.js']) {
      const s = readSorgente(f);
      for (const a of AUTORI) assert.ok(!new RegExp(`\\b${a}\\b`).test(s), `${f} non deve nominare ${a}`);
    }
  });
  test('nessuna struttura che associ un pilastro a teoria/autore nel model', () => {
    const s = readSorgente('js/ppu-scheda-d-model.js');
    for (const pid of PILASTRI_ID) {
      assert.ok(!new RegExp(`${pid}\\s*:\\s*['"\`][^'"\`]*(teoria|autore|${AUTORI.join('|')})`, 'i').test(s),
        `sospetta associazione ${pid} -> teoria/autore`);
    }
  });
});

describe('Passo 6C - promptVersion 4 e lettura retrocompatibile v1/v2/v3/v4', () => {
  test('PROMPT_VERSION === 4', () => {
    assert.equal(PROMPT_VERSION, 4);
  });
  test('D legacy promptVersion 1 (nessun blocco chiavi) si renderizza', () => {
    const d = docD({ promptVersion: 1, contenutoAI: contenutoValido() });
    const h = renderVistaHTML(d, { nomeRagazzo: 'M.' });
    assert.match(h, /SCHEDA D/);
    assert.match(h, /Testo di sintesi generale\./);
    assert.ok(!h.includes('ppud-chiavi'), 'nessuna sezione chiavi per una v1');
    assert.equal(elencaElementiRilettura(d.contenutoAI).filter(e => e.gruppo === 'chiave').length, 0);
  });
  test('D promptVersion 2 (con chiavi) si renderizza, sezione chiavi presente', () => {
    const d = docD({ promptVersion: 2, contenutoAI: contV2([chiavePP()]) });
    const h = renderVistaHTML(d, {});
    assert.match(h, /SCHEDA D/);
    assert.ok(h.includes(TITOLI_D.chiaviPP));
    assert.equal(elencaElementiRilettura(d.contenutoAI).filter(e => e.gruppo === 'chiave').length, 1);
  });
  test('D promptVersion 3 si renderizza come la v2 (stessa forma di contenutoAI)', () => {
    const d = docD({ promptVersion: 3, contenutoAI: contV2([chiavePP(), chiavePP({ ambito: 'trasversale', pilastro: null })]) });
    const h = renderVistaHTML(d, {});
    assert.ok(h.includes(TITOLI_D.chiaviPP));
    assert.equal((h.match(/class="ppud-chiave"/g) || []).length, 2);
  });
  test('il model non ha alcun ramo che dipende dal valore di promptVersion', () => {
    const s = readSorgente('js/ppu-scheda-d-model.js');
    assert.ok(!/promptVersion\s*(===?|!==?|>=?|<=?)\s*[0-9]/.test(s));
    assert.ok(!/PROMPT_VERSION\s*(===?|!==?|>=?|<=?)\s*[0-9]/.test(s));
  });
});
