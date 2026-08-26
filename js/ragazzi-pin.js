// js/ragazzi-pin.js — Gestione ragazzi: creazione/gestione account con PIN.
//
// Il login (loginConPin) NON passa più da email/password lato client: il
// browser invia solo il PIN alla Cloud Function callable loginRagazzoConPin
// (functions/pinLogin.js), che risolve il PIN, applica un rate limit,
// verifica che il ragazzo sia attivo e restituisce un Custom Token — mai
// credenziali. La password Firebase Auth dell'account resta un segreto
// casuale, generato una sola volta alla creazione e mai più riutilizzato:
// non esiste più nessuna formula "PIN → password" sufficiente ad accedere.
import { db, auth } from './firebase-config.js';
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { signInWithCustomToken } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js";

const API_KEY = 'AIzaSyC18lzwqhYcW29TsEO6Oy4Bqvb2PMBUmAg';
const EMAIL_SUFFIX = '.ragazzo@campodeifiori.org';
const FUNCTIONS_REGION = 'europe-west1';

export const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/dxqyprtzh/image/upload';
export const CLOUDINARY_PRESET = 'campo_dei_fiori';

export function nomeToEmail(nome) {
  return nome.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.|\.$/g, '')
    + EMAIL_SUFFIX;
}

// Password Firebase Auth casuale, indipendente dal PIN: serve solo a
// soddisfare il requisito di accounts:signUp alla creazione dell'account.
// Non viene mai salvata né riusata: dopo la creazione il login passa
// esclusivamente dal Custom Token, quindi questa password resta un segreto
// che nessuno (nemmeno l'admin) legge o conserva di nuovo.
function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// PIN a 6 cifre di default (1.000.000 di combinazioni): l'esperienza resta
// "inserisci PIN → entra", ma unito al rate limit server-side rende la forza
// bruta molto più costosa rispetto a 4 cifre. Il login continua ad accettare
// PIN da 4 a 6 cifre per compatibilità con eventuali PIN già esistenti.
export function generaPin(pinInUso) {
  let pin, tentativi = 0;
  do {
    pin = String(Math.floor(100000 + Math.random() * 900000));
    tentativi++;
  } while (pinInUso.has(pin) && tentativi < 200);
  return pin;
}

export async function uploadFotoCloudinary(file) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_PRESET);
  const res = await fetch(CLOUDINARY_URL, { method: 'POST', body: fd });
  const json = await res.json();
  if (!json.secure_url) throw new Error(json.error?.message || 'Caricamento foto fallito');
  return json.secure_url;
}

async function identitytoolkit(action, body) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

// ── Crea un nuovo ragazzo: account Auth + utenti/{uid} + PIN ──────────────
export async function creaRagazzo({ nome, comunitaId, fotoFile }, pinInUso) {
  const nomeTrim = nome.trim();
  if (!nomeTrim) throw new Error('Il nome è obbligatorio.');
  if (!comunitaId) throw new Error('Seleziona una comunità.');

  const pin = generaPin(pinInUso);
  const email = nomeToEmail(nomeTrim);

  const data = await identitytoolkit('signUp', { email, password: randomPassword(), returnSecureToken: true });
  const uid = data.localId;

  let fotoProfilo = '';
  if (fotoFile) {
    try { fotoProfilo = await uploadFotoCloudinary(fotoFile); } catch (_) {}
  }

  await setDoc(doc(db, 'utenti', uid), {
    nome: nomeTrim,
    comunitaId,
    fotoProfilo,
    email,
    admin: false,
    stato: 'attivo',
    createdAt: serverTimestamp()
  });

  await setDoc(doc(db, 'utenti_pin', uid), {
    uid, nome: nomeTrim, pin, email, comunitaId,
    createdAt: serverTimestamp(), lastLogin: null
  });
  await setDoc(doc(db, 'utenti_pin_lookup', pin), { uid });

  return { uid, pin, email, fotoProfilo };
}

// ── Cambia il PIN di un ragazzo esistente ──────────────────────────────────
// Nota: non tocca più la password Firebase Auth (il login non la usa più),
// quindi è una semplice riscrittura delle mappature PIN → uid.
export async function cambiaPinRagazzo(uid, nuovoPin, pinInUso) {
  if (!/^\d{4,6}$/.test(nuovoPin)) throw new Error('Il PIN deve essere di 4-6 cifre numeriche.');
  if (pinInUso.has(nuovoPin)) throw new Error('Questo PIN è già usato da un altro ragazzo.');

  const pinSnap = await getDoc(doc(db, 'utenti_pin', uid));
  if (!pinSnap.exists()) throw new Error('Nessun PIN esistente per questo ragazzo.');
  const esistente = pinSnap.data();
  const vecchioPin = esistente.pin;

  await setDoc(doc(db, 'utenti_pin', uid), { ...esistente, pin: nuovoPin }, { merge: true });
  await setDoc(doc(db, 'utenti_pin_lookup', nuovoPin), { uid });
  if (vecchioPin && vecchioPin !== nuovoPin) {
    try { await deleteDoc(doc(db, 'utenti_pin_lookup', vecchioPin)); } catch (_) {}
  }
  return nuovoPin;
}

// ── Cambia la foto profilo di un ragazzo ────────────────────────────────────
export async function cambiaFotoRagazzo(uid, file) {
  const fotoProfilo = await uploadFotoCloudinary(file);
  await updateDoc(doc(db, 'utenti', uid), { fotoProfilo });
  return fotoProfilo;
}

// ── Archivia / riattiva un ragazzo (mai cancellazione definitiva) ──────────
// Lo stato 'archiviato' nasconde il ragazzo dagli elenchi pubblici (Ragazzi,
// Comunità), blocca il login PIN (verificato server-side da
// loginRagazzoConPin) ma preserva intatti profilo, diario, messaggi e —
// soprattutto — il fascicolo personale/PPU in Firebase Storage, che nessun
// codice del sito cancella mai in automatico e che resta comunque
// consultabile da Area Documenti (vedi documenti.html).
export async function setStatoRagazzo(uid, stato) {
  await updateDoc(doc(db, 'utenti', uid), { stato });
}

// ── Login con PIN (usato da login.html) ────────────────────────────────────
// Il client invia solo il PIN alla Cloud Function; riceve un Custom Token e
// lo scambia con una sessione Firebase Auth vera e propria. Nessuna email,
// nessuna password, nessuna lettura diretta di utenti_pin_lookup dal browser.
export async function loginConPin(pin) {
  const functions = getFunctions(getApp(), FUNCTIONS_REGION);
  const chiamaLogin = httpsCallable(functions, 'loginRagazzoConPin');
  const result = await chiamaLogin({ pin });
  const { token } = result.data || {};
  if (!token) throw new Error('PIN non valido.');
  return signInWithCustomToken(auth, token);
}
