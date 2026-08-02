// ── Gestione: Magazzino & Lista spesa ───────────────────────────────────────
// Helper condivisi tra gestione.html, magazzino.html, liste-spesa.html,
// lista-spesa-dettaglio.html e gestione-storico.html. Unica fonte di verità
// per il gate di accesso e per i calcoli usati in più pagine.
import { db, ADMIN_UID } from './robinson-firebase.js';
import { esc } from './robinson-utils.js';
import { getDoc, doc, setDoc, getDocs, collection, updateDoc, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

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

// ── Modalità di riordino ─────────────────────────────────────────────────────
// soglia: si riordina sotto la soglia minima (stabili). ricorrente: entra sempre
// in ogni nuova lista (freschi/giornalieri: pane, latte, frutta). manuale: mai
// automatico, entra solo se il flag `serve` è attivo (consumo sporadico).
export function modalitaProdotto(prodotto) {
  return prodotto.modalita_riordino || 'soglia';
}

export const ETICHETTA_MODALITA = { ricorrente: 'giornaliero', manuale: 'a richiesta' };

// Sotto soglia ha senso solo per la modalità `soglia`: punto di riordino
// prudente, sotto soglia già quando si tocca il minimo.
export function sottoSoglia(prodotto) {
  if (modalitaProdotto(prodotto) !== 'soglia') return false;
  return (prodotto.quantita_attuale ?? 0) <= (prodotto.soglia_minima ?? 0);
}

// Un prodotto è "da comprare" secondo la sua modalità, oppure se qualcuno lo ha
// forzato a mano col flag `serve` (utilizzabile su qualsiasi modalità).
export function daComprare(prodotto) {
  const m = modalitaProdotto(prodotto);
  if (m === 'ricorrente') return true;
  if (m === 'manuale') return !!prodotto.serve;
  return sottoSoglia(prodotto) || !!prodotto.serve;
}

export function quantitaSuggerita(prodotto) {
  if (modalitaProdotto(prodotto) === 'ricorrente') return prodotto.quantita_ricorrente ?? null;
  if (prodotto.scorta_obiettivo == null) return null;
  const q = prodotto.scorta_obiettivo - (prodotto.quantita_attuale ?? 0);
  return q > 0 ? q : 0;
}

// Prodotti attivi da inserire in una nuova lista (o da ritirare con "Aggiorna
// da magazzino"), secondo la logica a tre modalità (vedi §4 del brief).
export function prodottiDaComprare(prodotti) {
  return prodotti.filter(p => p.attivo !== false && daComprare(p));
}

// ── Riordino colonne (categorie) ────────────────────────────────────────────
// Il campo `ordine` è condiviso tra Magazzino e Lista spesa: spostare una
// colonna in una vista deve spostarla anche nell'altra. Unica implementazione
// usata da entrambe (vedi §5 del brief: "controlli di colonna identici").
export async function spostaCategoriaOrdine(categorie, indice, delta) {
  const j = indice + delta;
  if (j < 0 || j >= categorie.length) return false;
  const a = categorie[indice], b = categorie[j];
  [a.ordine, b.ordine] = [b.ordine, a.ordine];
  await Promise.all([
    updateDoc(doc(db, 'magazzino_categorie', a.id), { ordine: a.ordine }),
    updateDoc(doc(db, 'magazzino_categorie', b.id), { ordine: b.ordine })
  ]);
  return true;
}

// ── Ordinamento manuale prodotti (priorità di acquisto) ─────────────────────
// Il campo `ordine` vive sul prodotto in Magazzino ed è relativo alla sua
// categoria (non globale). Le voci della Lista spesa collegate a un prodotto
// (prodotto_id) leggono lo stesso campo — unica fonte di verità in entrambe
// le viste; le voci manuali (senza prodotto) portano un proprio `ordine`
// finché non vengono promosse a prodotto (vedi lista-spesa-dettaglio.html).
export function ordineDi(item) {
  const o = item.ordine;
  return (o == null) ? Infinity : o;
}

export function comparaPerOrdine(a, b) {
  const oa = ordineDi(a), ob = ordineDi(b);
  if (oa !== ob) return oa - ob;
  return (a.nome || '').localeCompare(b.nome || '', 'it');
}

// Prossimo valore libero per un nuovo item in coda alla categoria (append).
export function prossimoOrdine(itemsCat) {
  if (!itemsCat.length) return 0;
  const max = Math.max(...itemsCat.map(it => { const o = ordineDi(it); return o === Infinity ? -1 : o; }));
  return max + 1;
}

// Normalizzazione lazy: se qualche prodotto della categoria non ha ancora un
// `ordine`, assegna indici sequenziali (0,1,2…) secondo l'ordinamento
// corrente (comparaPerOrdine, che ricade sul nome finché manca) e persiste
// in un unico writeBatch. Va chiamata alla prima apertura di una categoria
// (magazzino.html e lista-spesa-dettaglio.html, così la normalizzazione
// riguarda sempre l'intera categoria del Magazzino, non solo i prodotti
// presenti nella lista corrente).
export async function normalizzaOrdineProdotti(prodottiCat) {
  if (!prodottiCat.length || prodottiCat.every(p => p.ordine != null)) return false;
  const ordinati = [...prodottiCat].sort(comparaPerOrdine);
  const batch = writeBatch(db);
  let scritto = false;
  ordinati.forEach((p, i) => {
    if (p.ordine === i) return;
    p.ordine = i;
    scritto = true;
    batch.update(doc(db, 'magazzino_prodotti', p.id), { ordine: i });
  });
  if (scritto) await batch.commit();
  return scritto;
}

// Ordine effettivo di una voce di Lista spesa: se collegata a un prodotto
// legge il campo dal prodotto (fonte di verità unica); le voci manuali
// portano un proprio `ordine`.
export function ordineVoce(voce, prodottiMap) {
  if (voce.prodotto_id) return prodottiMap.get(voce.prodotto_id)?.ordine ?? null;
  return voce.ordine ?? null;
}

// ── Cerca prodotto (typeahead condiviso tra Magazzino e Lista spesa) ────────
// Normalizza case e accenti per il match a sottostringa (es. "citta" trova "Città").
function normalizzaCerca(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Collega un input di ricerca + il suo dropdown risultati alla sorgente prodotti
// già in memoria (nessuna query aggiuntiva). Alla selezione scorre fino alla card
// nella sua colonna e la evidenzia — unico componente usato da magazzino.html e
// lista-spesa-dettaglio.html, così comportamento ed etichette restano identici.
//   input, risultatiEl: elementi DOM del campo di ricerca e del dropdown
//   items(): getter sull'array prodotti/voci già caricato ({ id, nome, categoria })
//   categorie(): getter sull'array categorie ({ id, nome }), per l'etichetta a fianco
//   grid: contenitore con scroll orizzontale (.mag-grid / #sd-grid); le colonne al
//     suo interno devono avere data-categoria-id e le card data-item-id
//   espandiCategoria(categoriaId): riespande una colonna collassata prima di
//     scorrere (la card è display:none finché la colonna resta chiusa)
export function attivaCercaProdotto({ input, risultatiEl, items, categorie, grid, espandiCategoria }) {
  function chiudiRisultati() {
    risultatiEl.innerHTML = '';
    risultatiEl.classList.remove('open');
  }

  function cerca() {
    const q = normalizzaCerca(input.value.trim());
    if (q.length < 2) { chiudiRisultati(); return; }

    const nomeCategoria = new Map(categorie().map(c => [c.id, c.nome]));
    const trovati = items().filter(it => normalizzaCerca(it.nome).includes(q));

    risultatiEl.innerHTML = trovati.length
      ? trovati.slice(0, 30).map(it => `
          <button type="button" class="cp-risultato" data-id="${esc(it.id)}">
            <span class="cp-nome">${esc(it.nome)}</span>
            <span class="cp-cat">${esc(nomeCategoria.get(it.categoria) || 'Senza categoria')}</span>
          </button>`).join('')
      : `<div class="cp-vuoto">Nessun prodotto trovato.</div>`;
    risultatiEl.classList.add('open');

    risultatiEl.querySelectorAll('.cp-risultato').forEach(btn => {
      btn.addEventListener('click', () => {
        portamiAlProdotto(btn.dataset.id);
        chiudiRisultati();
        input.value = '';
        input.blur();
      });
    });
  }

  function portamiAlProdotto(id, tentativi = 0) {
    const card = grid.querySelector(`[data-item-id="${CSS.escape(id)}"]`);
    if (!card) return;
    const col = card.closest('.mag-col');
    if (col?.classList.contains('collassata')) {
      if (tentativi > 3) return; // guardia: evita loop se il re-render non arriva mai
      espandiCategoria?.(col.dataset.categoriaId);
      requestAnimationFrame(() => portamiAlProdotto(id, tentativi + 1));
      return;
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    card.classList.add('cp-evidenziata');
    setTimeout(() => card.classList.remove('cp-evidenziata'), 2000);
  }

  input.addEventListener('input', cerca);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) cerca(); });
  document.addEventListener('click', e => {
    if (e.target !== input && !risultatiEl.contains(e.target)) chiudiRisultati();
  });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { chiudiRisultati(); input.blur(); } });
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
