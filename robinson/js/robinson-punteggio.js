import { db } from './robinson-firebase.js';
import { doc, setDoc, getDoc, increment } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { SETTIMANA_KEY, MESE_KEY } from './robinson-utils.js';

const PUNTI = {
  post: 3,
  foto: 4,
  video: 5,
  audio: 4,
  commento: 2,
  reazione: 1,
  bottiglia: 3
};

const CAMPO_DETTAGLIO = {
  post: 'post',
  foto: 'foto',
  video: 'video',
  audio: 'audio',
  commento: 'commenti',
  reazione: 'reazioni',
  bottiglia: 'bottiglie'
};

function getSettimanaKey() {
  return SETTIMANA_KEY;
}

function getMeseKey() {
  return MESE_KEY;
}

export async function aggiungiPunteggio(uid, tipo) {
  if (!uid || !PUNTI[tipo]) return;
  const punti = PUNTI[tipo];
  const campo = CAMPO_DETTAGLIO[tipo];
  const sk = getSettimanaKey();
  const mk = getMeseKey();
  const ref = doc(db, 'robinson_punteggi', uid);

  try {
    // Legge nome utente se doc non esiste
    let nome = '';
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        nome = snap.data().nome || '';
      } else {
        const { getDoc: gd, doc: d } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        const [su, ss] = await Promise.all([
          gd(d(db, 'utenti', uid)),
          gd(d(db, 'staff', uid))
        ]);
        nome = (su.exists() ? su.data().nome : '') || (ss.exists() ? ss.data().nome : '') || '';
      }
    } catch (_) {}

    const update = {
      uid,
      totale: increment(punti),
      [`settimana.${sk}`]: increment(punti),
      [`mese.${mk}`]: increment(punti),
      [`dettaglio.${campo}`]: increment(1)
    };
    if (nome) update.nome = nome;

    await setDoc(ref, update, { merge: true });
  } catch (e) {
    console.error('aggiungiPunteggio error:', e);
  }
}
