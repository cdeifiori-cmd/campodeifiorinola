// js/console/console-crea-ragazzo.js
// Milestone E — creazione di un NUOVO ragazzo dalla Console.
// Nessun signUp dal browser: la creazione passa dalla callable server-side
// `creaRagazzoAdmin` (Admin SDK). Qui si fanno SOLO: la chiamata callable e,
// separatamente e in modo non bloccante, l'upload foto opzionale su Cloudinary.

// Da firebase-config.js importiamo SOLO `db` (sempre esportato). L'istanza
// dell'app la recuperiamo con getApp() per non rompere il modulo se un browser
// serve un firebase-config.js disallineato (cache) privo di `export { app }`.
import { db } from '../firebase-config.js';
import { getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFunctions, httpsCallable, connectFunctionsEmulator }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { doc, updateDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const FUNCTIONS_REGION = 'europe-west1';

// Cloudinary: STESSO preset unsigned del flusso legacy (js/ragazzi-pin.js).
// LIMITE NOTO: un preset unsigned è pubblicamente utilizzabile da chiunque
// conosca cloud_name + preset (entrambi nel sorgente). La validazione client
// qui sotto NON lo rende sicuro: riduce solo gli errori d'uso lecito.
const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/dxqyprtzh/image/upload';
const CLOUDINARY_PRESET = 'campo_dei_fiori';
export const FOTO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const functions = getFunctions(getApp(), FUNCTIONS_REGION);
// In ambiente di test locale l'host emulator viene passato via variabile globale.
try {
  const h = typeof window !== 'undefined' && window.__FUNCTIONS_EMULATOR_HOST__;
  if (h) {
    const [host, port] = String(h).split(':');
    connectFunctionsEmulator(functions, host, Number(port));
  }
} catch (_) { /* no-op */ }

/** Genera un PIN candidato a 6 cifre (l'unicità VERA è verificata server-side). */
export function generaPinCandidato() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function validaPin(pin) {
  return /^\d{4,6}$/.test(String(pin || '').trim());
}

export function validaFotoFile(file) {
  if (!file) return null; // opzionale
  if (!/^image\//.test(file.type || '')) throw new Error('Il file selezionato non è un\'immagine.');
  if (file.size > FOTO_MAX_BYTES) throw new Error('Immagine troppo grande (max 5 MB).');
  return file;
}

async function uploadFotoCloudinary(file) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_PRESET);
  const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: fd });
  const json = await res.json().catch(() => ({}));
  if (!json.secure_url) throw new Error(json.error?.message || 'Upload immagine fallito.');
  return json.secure_url;
}

/**
 * Crea un ragazzo. La foto è OPZIONALE e gestita DOPO la creazione: se l'upload
 * foto fallisce, il ragazzo resta creato correttamente.
 *
 * @param {{nome:string, comunitaId:string, pin:string, causale:string, fotoFile?:File}} input
 * @returns {Promise<{uid:string, comunitaId:string, fotoCaricata:boolean, fotoErrore:string|null}>}
 */
export async function creaRagazzo(input) {
  const nome = String(input?.nome || '').trim();
  const comunitaId = String(input?.comunitaId || '').trim();
  const pin = String(input?.pin || '').trim();
  const causale = String(input?.causale || '').trim();
  const fotoFile = input?.fotoFile || null;

  if (!nome) throw new Error('Il nome è obbligatorio.');
  if (!comunitaId) throw new Error('Seleziona una comunità.');
  if (!validaPin(pin)) throw new Error('Il PIN deve essere di 4-6 cifre.');
  if (!causale) throw new Error('La causale è obbligatoria.');
  if (fotoFile) validaFotoFile(fotoFile);

  // 1) creazione server-side (identità + account + PIN + appartenenza + audit)
  let uid, resComunita;
  try {
    const call = httpsCallable(functions, 'creaRagazzoAdmin');
    const res = await call({ nome, comunitaId, pin, causale });
    uid = res.data?.uid;
    resComunita = res.data?.comunitaId || comunitaId;
    if (!uid) throw new Error('Risposta del server incompleta.');
  } catch (e) {
    // Rilancia con messaggio leggibile (senza esporre dettagli sensibili).
    const code = e?.code || '';
    if (code === 'functions/already-exists') throw new Error('Questo PIN è già in uso. Genera o scegli un altro PIN.');
    if (code === 'functions/permission-denied') throw new Error('Operazione riservata agli amministratori.');
    if (code === 'functions/unauthenticated') throw new Error('Sessione non autenticata.');
    if (code === 'functions/invalid-argument') throw new Error(e.message || 'Dati non validi.');
    if (code === 'functions/failed-precondition') throw new Error(e.message || 'Comunità non valida.');
    throw new Error(e?.message || 'Creazione non riuscita.');
  }

  // 2) foto opzionale — NON blocca l'esito della creazione
  let fotoCaricata = false;
  let fotoErrore = null;
  if (fotoFile) {
    try {
      const url = await uploadFotoCloudinary(fotoFile);
      await updateDoc(doc(db, 'utenti', uid), { fotoProfilo: url }); // SOLO fotoProfilo
      fotoCaricata = true;
    } catch (e) {
      fotoErrore = e?.message || 'Upload foto non riuscito';
    }
  }

  return { uid, comunitaId: resComunita, fotoCaricata, fotoErrore };
}

/**
 * Assegna il PRIMO PIN a un ragazzo GIÀ esistente in utenti/{uid}.
 * Passa dalla callable server-side `assegnaPinRagazzoAdmin` (Admin SDK):
 * NON scrive Firestore dal client, NON usa Identity Toolkit, NON crea
 * utenti_pin_lookup, NON conosce/gestisce password Firebase.
 *
 * @param {string} uid  document id del ragazzo in `utenti`
 * @param {string} pin  4–6 cifre
 * @returns {Promise<{uid:string, comunitaId:(string|null), authCreated:boolean}>}
 */
export async function assegnaPin(uid, pin) {
  const u = String(uid || '').trim();
  const p = String(pin || '').trim();
  if (!u) throw new Error('uid mancante.');
  if (!validaPin(p)) throw new Error('Il PIN deve essere di 4–6 cifre.');

  try {
    const call = httpsCallable(functions, 'assegnaPinRagazzoAdmin');
    const res = await call({ uid: u, pin: p });
    return {
      uid: res.data?.uid || u,
      comunitaId: res.data?.comunitaId ?? null,
      authCreated: !!res.data?.authCreated,
    };
  } catch (e) {
    const code = e?.code || '';
    if (code === 'functions/already-exists') throw new Error('Questo PIN è già in uso. Genera o scegli un altro PIN.');
    if (code === 'functions/permission-denied') throw new Error('Operazione riservata agli amministratori.');
    if (code === 'functions/unauthenticated') throw new Error('Sessione non autenticata.');
    if (code === 'functions/invalid-argument') throw new Error(e.message || 'Dati non validi.');
    if (code === 'functions/failed-precondition') throw new Error(e.message || 'Operazione non consentita per questo ragazzo.');
    throw new Error(e?.message || 'Assegnazione PIN non riuscita.');
  }
}
