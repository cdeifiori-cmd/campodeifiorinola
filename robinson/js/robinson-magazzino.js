// ── Gestione: Magazzino & Lista spesa ───────────────────────────────────────
// Helper condivisi tra gestione.html, magazzino.html, liste-spesa.html,
// lista-spesa-dettaglio.html e gestione-storico.html. Unica fonte di verità
// per il gate di accesso e per i calcoli usati in più pagine.
import { db, ADMIN_UID } from './robinson-firebase.js';
import { getDoc, doc, setDoc, getDocs, collection } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── Gate di accesso alla cartella "Gestione" ────────────────────────────────
// Ammessi: admin, oppure chi ha un documento in magazzino_autorizzati (chiave =
// UID stabile risolto dal PIN Robinson dall'admin, vedi gestione.html). Questo
// è il controllo lato client (UX: nasconde il link, fa redirect); la sicurezza
// vera è nelle regole Firestore (stessa funzione puoAccedereGestione()).
export async function puoAccedereGestione(user) {
  if (!user) return false;
  if (user.uid === ADMIN_UID) return true;
  try {
    const snap = await getDoc(doc(db, 'magazzino_autorizzati', user.uid));
    return snap.exists();
  } catch (_) {
    return false;
  }
}

// ── Categorie iniziali (dal foglio cartaceo) ────────────────────────────────
export const CATEGORIE_INIZIALI = [
  'Ortofrutta',
  'Forno',
  'Carne / Pesce / Affettati',
  'Latticini e formaggi',
  'Bevande',
  'Snack, merendine, biscotti, latte',
  'Pasta',
  'Legumi, sughi, condimenti e spezie',
  'Forniture',
  'Varie'
];

function slug(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Seed idempotente: crea le categorie iniziali solo se la collezione è vuota.
// Doc id derivato dal nome (slug) così due chiamate concorrenti non duplicano.
export async function seedCategorieIniziali() {
  const snap = await getDocs(collection(db, 'magazzino_categorie'));
  if (!snap.empty) return;
  await Promise.all(CATEGORIE_INIZIALI.map((nome, i) =>
    setDoc(doc(db, 'magazzino_categorie', slug(nome)), { nome, ordine: i, attiva: true })
  ));
}

// ── Soglia minima ────────────────────────────────────────────────────────────
// Punto di riordino prudente: sotto soglia già quando si tocca il minimo.
export function sottoSoglia(prodotto) {
  return (prodotto.quantita_attuale ?? 0) <= (prodotto.soglia_minima ?? 0);
}

export function quantitaSuggerita(prodotto) {
  if (prodotto.scorta_obiettivo == null) return null;
  const q = prodotto.scorta_obiettivo - (prodotto.quantita_attuale ?? 0);
  return q > 0 ? q : 0;
}

// ── Formattazione ────────────────────────────────────────────────────────────
export function fmtEuro(n) {
  if (n == null || isNaN(n)) return '–';
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n);
}

export function fmtDataBreve(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
}
