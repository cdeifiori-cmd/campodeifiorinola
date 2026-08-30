/**
 * functions/schedaD.js — Cloud Function callable `generaSchedaDPPU`.
 *
 * Wrapper sottile: si limita a
 *   1) costruire le dipendenze reali (Firestore Admin SDK, client Anthropic),
 *   2) invocare core.eseguiGenerazione (tutta la logica sta in schedaDCore.js),
 *   3) mappare AppError → HttpsError.
 *
 * Segreto: la API key del modello viene letta ESCLUSIVAMENTE da Firebase Secret
 * Manager (`ANTHROPIC_API_KEY`). Non compare nel codice, in .env versionati, nel
 * frontend, nei log o negli errori.
 *
 * Modello: un'unica costante server-side (override possibile via env
 * `PPU_MODELLO_AI`). Nel documento D viene salvato il nome effettivamente
 * restituito dalla chiamata (`response.model`).
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { defineSecret } = require('firebase-functions/params');
const { getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const core = require('./schedaDCore');

const REGION = 'europe-west1';
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

// Unico punto in cui è nominato il modello (override via env PPU_MODELLO_AI).
// `claude-sonnet-5` è un id API valido; nel documento D si salva comunque il
// `response.model` effettivamente restituito dal provider.
const MODELLO_AI = process.env.PPU_MODELLO_AI || 'claude-sonnet-5';
// Passo 6C: 8000 → 12000. NON è un target ma headroom: `max_tokens` su Sonnet 5
// è il tetto COMBINATO thinking+testo, e una Scheda D v2 completa non entrava in
// 8000 quando il thinking adattivo ne consumava una quota. La verbosità è
// ridotta dai limiti di lunghezza nel SYSTEM_PROMPT + `effort: 'medium'`.
const MAX_OUTPUT_TOKENS = Number(process.env.PPU_MAX_OUTPUT_TOKENS) || 12000;
// Passo 6C: effort di ragionamento. Default 'medium' — la Scheda D è una sintesi
// strutturata con schema esplicito, non un compito agentico: 'high' (default del
// modello) spende troppo thinking dentro lo stesso budget di max_tokens.
const EFFORT = process.env.PPU_EFFORT || 'medium';

// Corpo della request alla Messages API di Anthropic.
// NOTA (claude-sonnet-5): NON si inviano parametri di sampling
// (`temperature`, `top_p`, `top_k`). Sonnet 5 rifiuta con HTTP 400 valori di
// sampling non-default. `thinking` NON si invia: Sonnet 5 usa thinking adattivo
// di default e `budget_tokens` è rifiutato (400); il ragionamento si governa
// con `output_config.effort`.
function costruisciRequestAnthropic({ system, messages }) {
  return {
    model: MODELLO_AI,
    max_tokens: MAX_OUTPUT_TOKENS,
    output_config: { effort: EFFORT },
    system,
    messages,
  };
}

// Chiamata reale al modello. `@anthropic-ai/sdk` è richiesto in modo lazy così
// che i test unitari (che iniettano un finto `chiamaModello`) non ne dipendano.
async function chiamaModelloAnthropic({ system, messages }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  let resp;
  try {
    resp = await client.messages.create(costruisciRequestAnthropic({ system, messages }));
  } catch (err) {
    // Solo lo status HTTP nei log: mai corpo, prompt, dati o chiave.
    const status = (err && (err.status || err.statusCode || (err.response && err.response.status))) || 'unknown';
    logger.warn('ppu_d_provider_error', { status });
    const e = new Error('provider-error');
    e.providerError = true;
    throw e;
  }
  const text = (resp && Array.isArray(resp.content) ? resp.content : [])
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('');
  // `stopReason` serve al core per distinguere il troncamento (max_tokens) dagli
  // errori strutturali e scegliere la strategia di retry.
  return { text, model: (resp && resp.model) || MODELLO_AI, stopReason: resp && resp.stop_reason };
}

exports.generaSchedaDPPU = onCall(
  {
    region: REGION,
    secrets: [ANTHROPIC_API_KEY],
    // La generazione fa UNA chiamata a claude-sonnet-5 per un output JSON
    // strutturato di 6 pilastri + lettura trasversale: la latenza reale può
    // superare 2 minuti. 300s dà margine senza incoraggiare loop (il retry è
    // al massimo 1 e solo su output non valido).
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async (request) => {
    if (!getApps().length) initializeApp();
    const t0 = Date.now();
    try {
      return await core.eseguiGenerazione({
        db: getFirestore(),
        auth: request.auth || null,
        data: request.data || {},
        chiamaModello: chiamaModelloAnthropic,
        modelloAIdefault: MODELLO_AI,
        serverTimestamp: () => FieldValue.serverTimestamp(),
        now: () => Date.now(),
        logger,
      });
    } catch (err) {
      if (err instanceof core.AppError) {
        logger.warn('ppu_d_fail', { codice: err.code, durataMs: Date.now() - t0 });
        throw new HttpsError(err.code, err.message);
      }
      logger.error('ppu_d_unexpected', {
        message: err && err.message ? String(err.message).slice(0, 120) : 'n/d',
        durataMs: Date.now() - t0,
      });
      throw new HttpsError('internal', 'Errore imprevisto durante la generazione.');
    }
  },
);

// Esportati per i test (verifica della forma della request; nessuna chiamata reale).
exports._chiamaModelloAnthropic = chiamaModelloAnthropic;
exports._costruisciRequestAnthropic = costruisciRequestAnthropic;
exports._MODELLO_AI = MODELLO_AI;
exports._MAX_OUTPUT_TOKENS = MAX_OUTPUT_TOKENS;
exports._EFFORT = EFFORT;
