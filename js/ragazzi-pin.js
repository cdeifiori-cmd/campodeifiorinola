// js/ragazzi-pin.js — Gestione ragazzi: creazione/gestione account con PIN,
// sullo stesso modello del sistema PIN di Robinson (robinson/admin-pin.html),
// adattato al progetto campo-dei-fiori: un ragazzo ottiene un vero account
// Firebase Auth (email sintetica + password derivata dal PIN), ma il PIN
// stesso non viene mai salvato in campi leggibili pubblicamente (vedi
// utenti_pin / utenti_pin_lookup in firestore.rules, a differenza di
// robinson_pin_lookup che salva anche la password in chiaro).
import { db, auth } from './firebase-config.js';
import {
  doc, getDoc, setDoc, deleteDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

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

export function generaPin(pinInUso) {
  let pin, tentativi = 0;
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000));
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
export async function cambiaPinRagazzo(uid, nuovoPin, pinInUso) {
  if (!/^\d{4,6}$/.test(nuovoPin)) throw new Error('Il PIN deve essere di 4-6 cifre numeriche.');
  if (pinInUso.has(nuovoPin)) throw new Error('Questo PIN è già usato da un altro ragazzo.');

  const pinSnap = await getDoc(doc(db, 'utenti_pin', uid));
  if (!pinSnap.exists()) throw new Error('Nessun PIN esistente per questo ragazzo.');
  const esistente = pinSnap.data();
  const vecchioPin = esistente.pin;
  const email = esistente.email;

  // Accedi come il ragazzo per ottenere un idToken valido, poi aggiorna la password
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
// Comunità) ma preserva intatti profilo, diario, messaggi e — soprattutto —
// il fascicolo personale/PPU in Firebase Storage, che nessun codice del sito
// cancella mai in automatico e che resta comunque consultabile da Area
// Documenti (vedi documenti.html).
export async function setStatoRagazzo(uid, stato) {
  await updateDoc(doc(db, 'utenti', uid), { stato });
}

// ── Login con PIN (usato da login.html) ────────────────────────────────────
export async function loginConPin(pin) {
  const lookupSnap = await getDoc(doc(db, 'utenti_pin_lookup', pin));
  if (!lookupSnap.exists()) throw new Error('PIN non valido.');
  const { email } = lookupSnap.data();
  const cred = await signInWithEmailAndPassword(auth, email, pinToPassword(pin));
  try {
    await updateDoc(doc(db, 'utenti_pin', cred.user.uid), { lastLogin: serverTimestamp() });
  } catch (_) {}
  return cred;
}
