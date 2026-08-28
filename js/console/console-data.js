// js/console/console-data.js
// Livello dati READ-ONLY della Console (Milestone B).
//
// VINCOLO ASSOLUTO: nessuna scrittura. Nessun addDoc/setDoc/updateDoc/deleteDoc,
// nessuna chiamata a Functions che modificano dati, nessun Storage/Cloudinary.
//
// Fonti:
//   - comunita       (lettura pubblica)
//   - utenti         (lettura pubblica)
//   - staff          (lettura pubblica)
//   - utenti_pin     (admin-only per regole) — usata SOLO per derivare
//                    "PIN configurato" (booleano) e "ultimo accesso".
//                    Il valore del PIN NON viene mai letto nel DOM/log.
//   NON viene mai letta utenti_pin_lookup.

import { db } from '../firebase-config.js';
import { collection, getDocs, query, orderBy }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

export const COMUNITA_AFTER_US = 'after-us';

// ── Fetch grezzi ─────────────────────────────────────────────────────────

export async function fetchComunita() {
  // orderBy('ordine') se presente; fallback a lettura semplice se l'indice/campo manca.
  let docs = [];
  try {
    const snap = await getDocs(query(collection(db, 'comunita'), orderBy('ordine')));
    docs = snap.docs;
  } catch (_) {
    const snap = await getDocs(collection(db, 'comunita'));
    docs = snap.docs;
  }
  return docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchUtenti() {
  const snap = await getDocs(collection(db, 'utenti'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function fetchStaff() {
  const snap = await getDocs(collection(db, 'staff'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Ritorna una mappa uid -> { configurato: boolean, lastLogin: Timestamp|null }.
 * NON espone mai il PIN. Se le regole negano la lettura (utente non admin),
 * ritorna {} senza errori.
 */
export async function fetchPinStatus() {
  const out = {};
  try {
    const snap = await getDocs(collection(db, 'utenti_pin'));
    snap.forEach((d) => {
      const data = d.data() || {};
      out[d.id] = {
        configurato: typeof data.pin === 'string' && data.pin.length > 0,
        lastLogin: data.lastLogin || null,
      };
      // NB: `data.pin` NON viene copiato né ritornato.
    });
  } catch (_) {
    // lettura negata o non disponibile: nessun dato PIN, la UI mostra "n/d"
  }
  return out;
}

// ── Helpers legacy-safe (nessuna riscrittura dei dati) ───────────────────

/** comunitaId può essere stringa, array o assente. Ritorna sempre un array di stringhe. */
export function normalizeComunitaIds(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((v) => String(v));
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

/** Ruolo free-form: accesso "legacy" se contiene coordinat/responsabil (case-insensitive). */
export function isRuoloAccessoLegacy(ruolo) {
  const r = String(ruolo || '').toLowerCase();
  return r.includes('coordinat') || r.includes('responsabil');
}

/**
 * Classifica il permesso Documenti di un doc staff, in modo tri-state-ready
 * per la Milestone C. NON modifica nulla.
 *
 * state:
 *   'ADMIN'            -> admin === true
 *   'ESPLICITO'        -> accessoDocumenti === true
 *   'NEGATO_ESPLICITO' -> accessoDocumenti === false MA il ruolo darebbe accesso legacy
 *                         (oggi le regole live IGNORANO il false e concedono via ruolo;
 *                          in Milestone C il false negherà esplicitamente)
 *   'LEGACY_RUOLO'     -> accessoDocumenti assente, ruolo coordinat/responsabil
 *   'NESSUNO'          -> nessuna delle precedenti
 *
 * accessoDocumentiRaw: true | false | undefined (undefined = campo assente)
 * effettivoOggi: bool — accesso concesso dalle regole ATTUALMENTE in produzione
 *                (admin OR accessoDocumenti===true OR ruolo legacy)
 */
export function classifyDocumenti(staffData) {
  const d = staffData || {};
  const admin = d.admin === true;
  const has = Object.prototype.hasOwnProperty.call(d, 'accessoDocumenti');
  const raw = has ? d.accessoDocumenti : undefined;
  const ruoloLegacy = isRuoloAccessoLegacy(d.ruolo);

  let state;
  if (admin) state = 'ADMIN';
  else if (raw === true) state = 'ESPLICITO';
  else if (raw === false) state = ruoloLegacy ? 'NEGATO_ESPLICITO' : 'NESSUNO';
  else state = ruoloLegacy ? 'LEGACY_RUOLO' : 'NESSUNO';

  const effettivoOggi = admin || raw === true || ruoloLegacy;

  return { state, accessoDocumentiRaw: raw, ruoloLegacy, effettivoOggi };
}
