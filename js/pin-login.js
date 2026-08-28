// js/pin-login.js — Login ragazzo via PIN, CALLABLE-FIRST (Milestone E).
//
//   PIN  ->  callable loginRagazzoConPin  ->  custom token  ->  signInWithCustomToken
//
// Il client NON interroga più `utenti_pin_lookup` nel nuovo percorso.
//
// FALLBACK LEGACY (js/ragazzi-pin.js:loginConPin): usato SOLTANTO per una
// condizione tecnica di rollout esplicitamente riconosciuta — la callable non è
// deployata o non è raggiungibile. MAI per un verdetto applicativo della
// callable (PIN non valido, rate limit, argomento non valido): altrimenti un
// aggressore potrebbe bypassare il rate limiting forzando il fallback.
//
// Codici che fanno scattare il fallback:
//   functions/not-found      (callable non deployata -> 404)
//   functions/unavailable    (servizio non raggiungibile / rete)
//   functions/unimplemented
//   + qualunque errore il cui code NON inizia con "functions/" (errore di
//     trasporto: rete, CORS, DNS…)
// NON fanno fallback (verdetti applicativi):
//   functions/permission-denied   -> "PIN non valido." (inesistente | archiviato, uniforme)
//   functions/resource-exhausted  -> "Troppi tentativi…"
//   functions/invalid-argument    -> "PIN non valido."
// NON fanno fallback (errori tecnici non di rollout): functions/internal,
//   functions/deadline-exceeded, functions/cancelled, functions/aborted…

import { app, auth } from './firebase-config.js';
import { getFunctions, httpsCallable, connectFunctionsEmulator }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { signInWithCustomToken }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { loginConPin } from './ragazzi-pin.js';

const FUNCTIONS_REGION = 'europe-west1';
const functions = getFunctions(app, FUNCTIONS_REGION);

try {
  const h = typeof window !== 'undefined' && window.__FUNCTIONS_EMULATOR_HOST__;
  if (h) {
    const [host, port] = String(h).split(':');
    connectFunctionsEmulator(functions, host, Number(port));
  }
} catch (_) { /* no-op */ }

const FALLBACK_CODES = new Set([
  'functions/not-found',
  'functions/unavailable',
  'functions/unimplemented',
]);

export async function loginRagazzoPin(pin) {
  const p = String(pin || '').trim();
  if (!/^\d{4,6}$/.test(p)) throw new Error('Inserisci un PIN valido (4-6 cifre).');

  try {
    const call = httpsCallable(functions, 'loginRagazzoConPin');
    const res = await call({ pin: p });
    const token = res && res.data && res.data.token;
    if (!token) throw new Error('Risposta di login incompleta.');
    await signInWithCustomToken(auth, token);
    return { via: 'callable' };
  } catch (e) {
    const code = (e && e.code) || '';

    // Verdetti applicativi: nessun fallback.
    if (code === 'functions/resource-exhausted') {
      throw new Error('Troppi tentativi. Riprova tra qualche minuto.');
    }
    if (code === 'functions/permission-denied' || code === 'functions/invalid-argument') {
      throw new Error('PIN non valido.');
    }

    // Condizione tecnica di rollout: fallback al percorso legacy.
    const isTransport = FALLBACK_CODES.has(code) || !String(code).startsWith('functions/');
    if (isTransport) {
      await loginConPin(p); // può lanciare "Questo profilo non è più attivo."
      return { via: 'legacy-fallback' };
    }

    // functions/internal, deadline-exceeded, cancelled, aborted, … -> niente fallback
    throw new Error('Accesso non riuscito. Riprova.');
  }
}
