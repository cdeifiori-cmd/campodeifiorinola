// ── Il Consiglio dell'Isola — motore di calcolo del sociogramma ────────────────
// Riutilizzato da consiglio.html (solo interpretazione della sintesi pubblica)
// e consiglio-admin.html (grafo completo + aggregati tecnici).

// Pesi dell'Indice di Coesione — facilmente modificabili
export const PESI_INDICE = {
  reciprocitaPositiva: 0.35,
  integrazione: 0.30,
  serenita: 0.20,
  aperturaPonti: 0.15,
};

const FRASI_POOL = {
  correntiCalano: [
    'Le correnti stanno avvicinando naufraghi che prima non si parlavano.',
    'Alcune correnti contrarie si stanno placando.',
  ],
  pontiNuovi: [
    'Sono comparsi nuovi ponti tra le diverse ciurme.',
    'La ciurma ha costruito nuovi ponti questa settimana.',
  ],
  isolamento: [
    'Alcuni naufraghi stanno ancora affrontando la tempesta da soli.',
    'C\'è ancora qualche naufrago che naviga in solitaria: la ciurma può fare di più.',
  ],
  crescita: [
    'L\'isola sta diventando sempre più una vera Repubblica.',
    'Questa settimana la vostra ciurma è cresciuta.',
  ],
  default: [
    'La ciurma sta scrivendo la sua storia, un legame alla volta.',
  ],
};

function scegli(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Costruzione mappa nomine per uid ────────────────────────────────────────
function buildNomineMap(risposte) {
  const map = {};
  risposte.forEach(r => {
    map[r.userId] = {
      ciurma: new Set(r.ciurma || []),
      ponti: new Set(r.ponti || []),
      correnti: new Set(r.correnti || []),
      scogli: new Set(r.scogli || []),
    };
  });
  return map;
}

function positivo(map, u, v) {
  const n = map[u];
  if (!n) return false;
  return n.ciurma.has(v) || n.ponti.has(v);
}
function positivoCiurma(map, u, v) {
  const n = map[u];
  return !!n && n.ciurma.has(v);
}
function positivoPonti(map, u, v) {
  const n = map[u];
  return !!n && n.ponti.has(v);
}
function negativo(map, u, v) {
  const n = map[u];
  if (!n) return false;
  return n.correnti.has(v) || n.scogli.has(v);
}

// ── Calcolo completo aggregati + indice per una rilevazione ─────────────────
// risposte: [{ userId, ciurma:[], ponti:[], correnti:[], scogli:[] }]
export function calcolaAggregati(risposte) {
  const uids = risposte.map(r => r.userId);
  const R = uids.length;
  const map = buildNomineMap(risposte);

  let reciprocalPositiviCount = 0;
  let anyPositiviCount = 0;
  let reciprocalConflittiCount = 0;
  let correntiPaiaCount = 0;
  let scogliPaiaCount = 0;
  let pontiDistintiCount = 0;

  const inDegreePositivo = {}; // uid -> numero di nomine positive ricevute (per isolati/leader)
  const inDegreeReciproco = {}; // uid -> numero di legami reciproci positivi (per leader)
  uids.forEach(u => { inDegreePositivo[u] = 0; inDegreeReciproco[u] = 0; });

  // Coppie (ciurma reciproca) per il calcolo dei cluster
  const edgesCiurmaReciproca = [];

  for (let i = 0; i < uids.length; i++) {
    for (let j = i + 1; j < uids.length; j++) {
      const a = uids[i], b = uids[j];
      const aToB = positivo(map, a, b);
      const bToA = positivo(map, b, a);
      if (aToB) inDegreePositivo[b]++;
      if (bToA) inDegreePositivo[a]++;

      const reciprocoPositivo = aToB && bToA;
      if (aToB || bToA) anyPositiviCount++;
      if (reciprocoPositivo) {
        reciprocalPositiviCount++;
        inDegreeReciproco[a]++;
        inDegreeReciproco[b]++;
      }

      const aCiurmaB = positivoCiurma(map, a, b);
      const bCiurmaA = positivoCiurma(map, b, a);
      if (aCiurmaB && bCiurmaA) edgesCiurmaReciproca.push([a, b]);

      const aPontiB = positivoPonti(map, a, b);
      const bPontiA = positivoPonti(map, b, a);
      if ((aPontiB || bPontiA) && !reciprocoPositivo) pontiDistintiCount++;

      const aNegB = negativo(map, a, b);
      const bNegA = negativo(map, b, a);
      if (aNegB && bNegA) reciprocalConflittiCount++;

      const aCorrB = map[a]?.correnti.has(b);
      const bCorrA = map[b]?.correnti.has(a);
      if (aCorrB || bCorrA) correntiPaiaCount++;

      const aScogB = map[a]?.scogli.has(b);
      const bScogA = map[b]?.scogli.has(a);
      if (aScogB || bScogA) scogliPaiaCount++;
    }
  }

  const isolati = uids.filter(u => inDegreePositivo[u] === 0);

  const reciprocitaPositiva = anyPositiviCount > 0 ? reciprocalPositiviCount / anyPositiviCount : 0;
  const integrazione = R > 0 ? (R - isolati.length) / R : 0;
  const serenita = R > 0 ? 1 - Math.min(1, reciprocalConflittiCount / R) : 1;
  const aperturaPonti = R > 0 ? Math.min(1, pontiDistintiCount / R) : 0;

  const indice = Math.round(100 * (
    PESI_INDICE.reciprocitaPositiva * reciprocitaPositiva +
    PESI_INDICE.integrazione * integrazione +
    PESI_INDICE.serenita * serenita +
    PESI_INDICE.aperturaPonti * aperturaPonti
  ));

  // Fuochi della ciurma: componenti connesse (>=2 membri) sui legami ciurma reciproci
  const cluster = calcolaCluster(uids, edgesCiurmaReciproca);
  const fuochiCiurma = cluster.filter(c => c.length >= 2).length;

  // Leader positivi: più alto in-degree reciproco
  const leader = uids
    .map(u => ({ uid: u, reciproci: inDegreeReciproco[u] }))
    .filter(x => x.reciproci > 0)
    .sort((a, b) => b.reciproci - a.reciproci);

  return {
    R,
    indice,
    componenti: { reciprocitaPositiva, integrazione, serenita, aperturaPonti },
    pontiCostruiti: reciprocalPositiviCount,
    nuoviPontiPossibili: pontiDistintiCount,
    correntiForti: correntiPaiaCount,
    scogliDaSuperare: scogliPaiaCount,
    fuochiCiurma,
    isolati,
    leader,
    cluster,
  };
}

// ── Ricerca componenti connesse (semplice BFS/union) ────────────────────────
function calcolaCluster(uids, edges) {
  const adj = {};
  uids.forEach(u => { adj[u] = new Set(); });
  edges.forEach(([a, b]) => { adj[a].add(b); adj[b].add(a); });

  const visitati = new Set();
  const componenti = [];
  for (const u of uids) {
    if (visitati.has(u) || adj[u].size === 0) continue;
    const coda = [u];
    const gruppo = [];
    visitati.add(u);
    while (coda.length) {
      const cur = coda.pop();
      gruppo.push(cur);
      adj[cur].forEach(v => {
        if (!visitati.has(v)) { visitati.add(v); coda.push(v); }
      });
    }
    componenti.push(gruppo);
  }
  return componenti;
}

// ── Mediatori: nodi con legami positivi verso più di un cluster distinto ────
export function trovaMediatori(risposte, cluster) {
  const map = buildNomineMap(risposte);
  const uidToCluster = {};
  cluster.forEach((gruppo, idx) => gruppo.forEach(u => { uidToCluster[u] = idx; }));

  const mediatori = [];
  const uids = risposte.map(r => r.userId);
  uids.forEach(u => {
    const clusterVicini = new Set();
    const n = map[u];
    if (!n) return;
    [...n.ciurma, ...n.ponti].forEach(v => {
      if (uidToCluster[v] !== undefined) clusterVicini.add(uidToCluster[v]);
    });
    // Considera anche chi nomina u
    uids.forEach(altro => {
      if (altro === u) return;
      const alt = map[altro];
      if (alt && (alt.ciurma.has(u) || alt.ponti.has(u)) && uidToCluster[altro] !== undefined) {
        clusterVicini.add(uidToCluster[altro]);
      }
    });
    if (clusterVicini.size >= 2) mediatori.push(u);
  });
  return mediatori;
}

// ── Delta tra due rilevazioni consecutive (per timeline educatore) ─────────
export function calcolaDelta(aggregatiPrec, aggregatiCorr) {
  if (!aggregatiPrec) return null;
  return {
    deltaIndice: aggregatiCorr.indice - aggregatiPrec.indice,
    nuoviPonti: aggregatiCorr.pontiCostruiti - aggregatiPrec.pontiCostruiti,
    nuoviIsolamenti: aggregatiCorr.isolati.length - aggregatiPrec.isolati.length,
    conflittiRisolti: aggregatiPrec.scogliDaSuperare - aggregatiCorr.scogliDaSuperare,
  };
}

// ── Genera una frase narrativa in base ai delta ─────────────────────────────
export function generaFrase(deltaIndice, aggregati, prec) {
  if (prec) {
    if ((aggregati.correntiForti < prec.correntiForti) || (aggregati.scogliDaSuperare < prec.scogliDaSuperare)) {
      return scegli(FRASI_POOL.correntiCalano);
    }
    if (aggregati.pontiCostruiti > prec.pontiCostruiti || aggregati.nuoviPontiPossibili > prec.nuoviPontiPossibili) {
      return scegli(FRASI_POOL.pontiNuovi);
    }
  }
  if (aggregati.isolati.length > 0) return scegli(FRASI_POOL.isolamento);
  if (deltaIndice > 0) return scegli(FRASI_POOL.crescita);
  return scegli(FRASI_POOL.default);
}
