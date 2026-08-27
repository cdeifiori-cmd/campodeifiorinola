// js/ragazzi-pin.js — Gestione ragazzi: creazione/gestione account con PIN,
// sullo stesso modello del sistema PIN di Robinson (robinson/admin-pin.html,
// robinson/login.html): account Firebase Auth reale, email sintetica,
// password derivata dal PIN, login diretto con signInWithEmailAndPassword.
// Nessuna Cloud Function, nessun Custom Token, nessun permesso IAM richiesti
// per il login — esattamente come in Robinson.
//
// Unica differenza deliberata rispetto a Robinson: utenti_pin_lookup salva
// solo { uid, email }, MAI la password — a differenza di robinson_pin_lookup
// che la salva anche in chiaro. La password (CF + pin) si ricostruisce lato
// client con la stessa formula nota sia in creazione che in login, quindi
// non serve persisterla da nessuna parte.
import { db, auth } from './firebase-config.js';
import {
  doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const API_KEY = 'AIzaSyC18lzwqhYcW29TsEO6Oy4Bqvb2PMBUmAg';
const EMAIL_SUFFIX = '.ragazzo@campodeifiori.org';
const PASSWORD_PREFIX = 'CF';

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

function pinToPassword(pin) {
  return PASSWORD_PREFIX + pin;
}

// PIN a 6 cifre di default (1.000.000 di combinazioni, contro le 4 cifre di
// Robinson): l'esperienza resta "inserisci PIN → entra", ma lo spazio delle
// combinazioni è molto più ampio a costo zero per il ragazzo. Il login
// continua ad accettare PIN da 4 a 6 cifre per compatibilità.
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
  const password = pinToPassword(pin);

  const data = await identitytoolkit('signUp', { email, password, returnSecureToken: true });
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
  await setDoc(doc(db, 'utenti_pin_lookup', pin), { uid, email });

  return { uid, pin, email, fotoProfilo };
}

// ── Cambia il PIN di un ragazzo esistente ──────────────────────────────────
// Stesso meccanismo di admin-pin.html: accedi come il ragazzo con la vecchia
// password per ottenere un idToken, poi usa quell'idToken per impostare la
// nuova password — l'unico modo per cambiare una password Firebase Auth
// senza privilegi di Admin SDK (qui operiamo solo lato client/browser).
export async function cambiaPinRagazzo(uid, nuovoPin, pinInUso) {
  if (!/^\d{4,6}$/.test(nuovoPin)) throw new Error('Il PIN deve essere di 4-6 cifre numeriche.');
  if (pinInUso.has(nuovoPin)) throw new Error('Questo PIN è già usato da un altro ragazzo.');

  const pinSnap = await getDoc(doc(db, 'utenti_pin', uid));
  if (!pinSnap.exists()) throw new Error('Nessun PIN esistente per questo ragazzo.');
  const esistente = pinSnap.data();
  const vecchioPin = esistente.pin;
  const email = esistente.email;

  const signInData = await identitytoolkit('signInWithPassword', {
    email, password: pinToPassword(vecchioPin), returnSecureToken: true
  });
  await identitytoolkit('update', {
    idToken: signInData.idToken, password: pinToPassword(nuovoPin), returnSecureToken: false
  });

  await setDoc(doc(db, 'utenti_pin', uid), { ...esistente, pin: nuovoPin }, { merge: true });
  await setDoc(doc(db, 'utenti_pin_lookup', nuovoPin), { uid, email });
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
// Comunità), blocca il login PIN (verificato lato client in loginConPin) ma
// preserva intatti profilo, diario, messaggi e — soprattutto — il fascicolo
// personale/PPU in Firebase Storage, che nessun codice del sito cancella mai
// in automatico e che resta comunque consultabile da Area Documenti.
export async function setStatoRagazzo(uid, stato) {
  await updateDoc(doc(db, 'utenti', uid), { stato });
}

// ── Login con PIN (usato da login.html) ────────────────────────────────────
// Stesso flusso di robinson/login.html: legge il lookup pubblico (solo
// {uid, email}, mai la password), ricostruisce la password con la stessa
// formula nota, fa signInWithEmailAndPassword diretto. In più, a differenza
// di Robinson, verifica lo stato 'archiviato' del ragazzo (requisito esplicito
// del sito principale) e, se archiviato, disconnette subito e rifiuta.
export async function loginConPin(pin) {
  const lookupSnap = await getDoc(doc(db, 'utenti_pin_lookup', pin));
  if (!lookupSnap.exists()) throw new Error('PIN non valido.');
  const { uid, email } = lookupSnap.data();

  const cred = await signInWithEmailAndPassword(auth, email, pinToPassword(pin));

  try {
    const utenteSnap = await getDoc(doc(db, 'utenti', uid));
    if (utenteSnap.exists() && utenteSnap.data().stato === 'archiviato') {
      await signOut(auth);
      throw new Error('Questo profilo non è più attivo.');
    }
  } catch (e) {
    if (e.message === 'Questo profilo non è più attivo.') throw e;
    // Un errore di lettura imprevisto non deve bloccare un login altrimenti
    // valido: si prosegue, coerente con lo spirito "best effort" di Robinson.
  }

  try {
    await updateDoc(doc(db, 'utenti_pin', uid), { lastLogin: serverTimestamp() });
  } catch (_) {
    // Best effort, come robinson_pin: utenti_pin è leggibile/scrivibile solo
    // dall'admin, quindi questo aggiornamento normalmente fallisce in
    // silenzio — non è un dato critico per il login.
  }

  return cred;
}
