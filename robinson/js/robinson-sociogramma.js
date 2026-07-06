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

// ── Fonte di verità unica per "chi ha ricevuto cosa" (entrante) e "chi ha dato cosa"
// (uscente), campo per campo. Ogni metrica di POSIZIONE SOCIALE (isolati, popolarità,
// leader, pallino verde...) deve leggere solo insiemeEntrante: l'uscente descrive
// l'orientamento di chi sceglie, non come il gruppo vede la persona, e va usato solo per
// disegnare le frecce o analizzare chi sceglie — mai per isolamento/popolarità/leadership.
export function insiemeEntrante(risposte, uid, campo) {
  const set = new Set();
  risposte.forEach(r => {
    if (r.userId === uid) return; // niente autoscelte
    if ((r[campo] || []).includes(uid)) set.add(r.userId);
  });
  return set;
}
export function insiemeUscente(risposte, uid, campo) {
  const propria = risposte.find(r => r.userId === uid);
  const set = new Set(propria ? (propria[campo] || []) : []);
  set.delete(uid); // niente autoscelte
  return set;
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

  const inDegreeReciproco = {}; // uid -> numero di legami reciproci positivi (per leader)
  uids.forEach(u => { inDegreeReciproco[u] = 0; });

  // Coppie (ciurma reciproca) per il calcolo dei cluster
  const edgesCiurmaReciproca = [];

  for (let i = 0; i < uids.length; i++) {
    for (let j = i + 1; j < uids.length; j++) {
      const a = uids[i], b = uids[j];
      const aToB = positivo(map, a, b);
      const bToA = positivo(map, b, a);

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

  // Isolato = zero preferenze positive RICEVUTE in ciurma (D1), indipendentemente da quante
  // nomine ha DATO (uscente irrilevante) e da quante ne riceve su ponti/D2 (che non è più parte
  // di questa definizione). Coerente con SOGLIA_MARGINALE: l'isolato è il caso estremo (0) della
  // fascia dei marginali (<=2), non una condizione separata su un secondo campo.
  const isolati = uids.filter(u => insiemeEntrante(risposte, u, 'ciurma').size === 0);

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

// ── Fasce ad anelli su un conteggio (usata sia dal Bersaglio per il raggio sia dalla
// Leadership trasversale per individuare la periferia): [0, max] diviso in 4 fasce assolute
// che crescono verso il centro/ring0. Regola fissa: 0 → sempre l'anello più esterno (ring3).
export function calcolaFasceAnelli(maxImpatto) {
  if (maxImpatto <= 0) return [[0, -1], [0, -1], [0, -1], [0, 0]];
  if (maxImpatto <= 2) return [[1, maxImpatto], [0, -1], [0, -1], [0, 0]];
  const s1 = Math.ceil(maxImpatto / 3);
  const s2 = Math.ceil(maxImpatto * 2 / 3);
  return [
    [s2 + 1, maxImpatto], // ring0 — centro
    [s1 + 1, s2],         // ring1
    [1, s1],              // ring2
    [0, 0],                // ring3 — bordo
  ];
}
export function trovaAnelloPerValore(v, fasce) {
  for (let i = 0; i < fasce.length; i++) {
    const [mn, mx] = fasce[i];
    if (mn <= mx && v >= mn && v <= mx) return i;
  }
  return 3;
}

// Soglia del PONTE AI MARGINALI: marginale = riceve <= questa soglia di preferenze positive in
// ciurma (D1), indipendentemente da tutto il resto (appartenenza a un sottogruppo inclusa — un
// marginale può benissimo stare in un cluster, es. Mohamed nel cluster 2 con pochissime ricevute).
// Gli isolati (0 ricevute) sono il caso estremo di questa fascia, non una categoria a parte.
const SOGLIA_MARGINALE = 2;

// ── Leadership trasversale: distingue il leader "vero" (consenso trasversale a più
// sottogruppi + ponte anche verso chi resta ai margini) dal leader "di fazione" (molti consensi
// ma tutti dallo stesso sottogruppo). Sempre sulle preferenze RICEVUTE (D1/ciurma) — la
// reciprocità entra SOLO tramite `cluster` (già calcolato su legami reciproci di ciurma per
// definire chi sta con chi, e usato SOLO per l'AMPIEZZA DI CONSENSO), MAI per misurare la
// leadership in sé e MAI per definire chi è marginale.
//
// Per ogni votante che ha scelto il naufrago in ciurma, due controlli INDIPENDENTI (uno stesso
// votante può contribuire a entrambi gli indicatori, o a nessuno, o a uno solo):
//  - Membro di un sottogruppo (presente in uidToCluster) → conta per l'AMPIEZZA DI CONSENSO
//    (un cluster distinto raggiunto conta una volta sola, non per ogni votante al suo interno).
//  - Marginale (riceve <= SOGLIA_MARGINALE preferenze in ciurma, a prescindere dal cluster) →
//    conta per il PONTE AI MARGINALI.
export function calcolaLeadershipTrasversale(risposte, cluster) {
  const uids = risposte.map(r => r.userId);
  const uidToCluster = {};
  cluster.forEach((gruppo, idx) => gruppo.forEach(u => { uidToCluster[u] = idx; }));

  const ricevuteCiurma = {};
  uids.forEach(u => { ricevuteCiurma[u] = insiemeEntrante(risposte, u, 'ciurma').size; });
  const marginale = u => ricevuteCiurma[u] <= SOGLIA_MARGINALE;

  const risultato = {};
  uids.forEach(leaderUid => {
    const clusterRaggiunti = new Set();
    let ponteMarginali = 0;
    insiemeEntrante(risposte, leaderUid, 'ciurma').forEach(votante => {
      const clusterVotante = uidToCluster[votante];
      if (clusterVotante !== undefined) clusterRaggiunti.add(clusterVotante);
      if (marginale(votante)) ponteMarginali++;
    });
    risultato[leaderUid] = {
      ampiezzaConsenso: clusterRaggiunti.size,
      sottogruppiTotali: cluster.length,
      ponteMarginali,
      consensoGrezzo: ricevuteCiurma[leaderUid],
    };
  });
  return risultato;
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
