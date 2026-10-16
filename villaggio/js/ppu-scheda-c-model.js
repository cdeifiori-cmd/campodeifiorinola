// js/ppu-scheda-c-model.js — nucleo dati (puro, senza Firebase né DOM) della
// Scheda C PPU "Le persone intorno a me". Isolato in un modulo a parte
// rispetto a js/ppu-scheda-c.js così da poter essere testato in Node senza
// bundler né emulatore (js/ppu-scheda-c.js importa da qui e ci aggiunge la
// persistenza Firestore e l'interfaccia).
//
// La Scheda C NON è un questionario a scala 0-3 come A e B: è uno strumento
// sociometrico visuale. Ogni Scheda C compilata contiene DUE sociogrammi
// distinti e indipendenti:
//   - C1 "vicinanza"  → le persone che il ragazzo sente vicine
//                       (più vicino al centro = maggiore vicinanza percepita)
//   - C2 "fatica"     → le persone con cui il ragazzo fa più fatica
//                       (più vicino al centro = difficoltà/conflitto più intenso)
// La STESSA persona può comparire in entrambi i sociogrammi: è voluto.
//
// Il software conserva SOLO dati descrittivi (nodi, coordinate, collegamenti,
// note libere). Nessuna diagnosi, nessuna etichetta automatica, nessun
// punteggio: l'interpretazione appartiene al colloquio educativo.

// ── Nodo centrale "IO" ─────────────────────────────────────────────────────
// Non eliminabile, non rinominabile, sempre al centro (x=0.5, y=0.5).
export const CENTER_ID = 'io';
export const CENTER_LABEL = 'IO';

// ── Direzione della relazione ─────────────────────────────────────────────
// forward  = source → target   (unidirezionale nel verso indicato)
// backward = source ← target   (unidirezionale nel verso opposto)
// both     = source ↔ target   (reciproca)
// L'assenza di arco significa "nessun collegamento significativo percepito".
export const DIREZIONI = [
  { id: 'forward',  label: 'A → B', simbolo: '→', descr: 'Relazione percepita soprattutto in un verso' },
  { id: 'backward', label: 'A ← B', simbolo: '←', descr: 'Relazione percepita soprattutto nel verso opposto' },
  { id: 'both',     label: 'A ↔ B', simbolo: '↔', descr: 'Relazione percepita come reciproca' },
];
export const DIREZIONE_DEFAULT = 'both';

// ── Legenda dei colori/qualità della relazione ───────────────────────────
// Configurazione CENTRALIZZATA e volutamente semplice: per cambiare la
// legenda si modifica SOLO questo array (id stabile + etichetta + colore).
// Nessuna classificazione psicologica è "incisa" altrove nel codice.
export const QUALITA_RELAZIONE = [
  { id: 'green',  label: 'Positivo',     descr: 'Rapporto vissuto positivamente',      colore: '#3a8a4a' },
  { id: 'yellow', label: 'Altalenante',  descr: 'Rapporto altalenante o incerto',      colore: '#d9a72b' },
  { id: 'red',    label: 'Difficile',    descr: 'Rapporto difficile o conflittuale',   colore: '#c0392b' },
  { id: 'grey',   label: 'Neutro',       descr: 'Rapporto neutro o poco definito',     colore: '#8a8a8a' },
];
export const QUALITA_DEFAULT = 'grey';

// ── Momento del percorso PPU (identico a Scheda A / B) ────────────────────
export const MOMENTI_PPU = [
  { value: 'ingresso',            label: 'Ingresso' },
  { value: 'verifica_3_mesi',     label: 'Verifica 3 mesi' },
  { value: 'verifica_6_mesi',     label: 'Verifica 6 mesi' },
  { value: 'verifica_intermedia', label: 'Verifica intermedia' },
  { value: 'uscita',              label: 'Uscita' },
  { value: 'altro',               label: 'Altro' },
];

export const SOCIOGRAMMI = [
  {
    key: 'vicinanza',
    titolo: 'Le persone che sento vicine',
    accento: '#3a8a4a',
    consegna: 'Pensa alle persone che fanno parte della tua vita. Aggiungile una alla volta e mettile dove senti che dovrebbero stare. Più una persona la senti vicina a te, più portala verso il centro. Se la senti meno vicina, lasciala più lontano.',
    legendaDistanza: 'Più vicino al centro = la senti più vicina.',
  },
  {
    key: 'fatica',
    titolo: 'Le persone con cui faccio fatica',
    accento: '#c0392b',
    consegna: 'Pensa alle persone con cui in questo periodo fai più fatica. Metti più vicino a te quelle con cui la difficoltà, il contrasto o il problema è più forte. Metti più lontano quelle con cui la difficoltà è meno intensa.',
    legendaDistanza: 'Più vicino al centro = la difficoltà è più intensa.',
  },
];

export const INSTRUMENT = 'PPU_C';
export const INSTRUMENT_VERSION = 1;

// ── Helper di lettura legenda ────────────────────────────────────────────
export function coloreQualita(id) {
  return (QUALITA_RELAZIONE.find(q => q.id === id) || QUALITA_RELAZIONE.find(q => q.id === QUALITA_DEFAULT)).colore;
}
export function labelQualita(id) {
  return (QUALITA_RELAZIONE.find(q => q.id === id) || {}).label || '';
}
export function labelDirezione(id) {
  return (DIREZIONI.find(d => d.id === id) || {}).label || '';
}
export function simboloDirezione(id) {
  return (DIREZIONI.find(d => d.id === id) || {}).simbolo || '—';
}
export function labelMomento(value) {
  return (MOMENTI_PPU.find(m => m.value === value) || {}).label || '';
}

// ── Utilità geometriche ─────────────────────────────────────────────────
// Le coordinate dei nodi sono SEMPRE normalizzate in [0,1] rispetto alla
// superficie quadrata della mappa: così il sociogramma si ricostruisce
// identico su schermi di dimensioni diverse.
export function clamp01(n) {
  n = Number(n);
  if (!isFinite(n)) return 0.5;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// Distanza dal centro normalizzata in [0,1]: 0 = sul centro, 1 = sul bordo
// della mappa lungo un asse. Valore descrittivo salvato con ogni nodo.
export function distanzaDalCentro(node) {
  const dx = clamp01(node?.x) - 0.5;
  const dy = clamp01(node?.y) - 0.5;
  const d = Math.sqrt(dx * dx + dy * dy) / 0.5;
  return Math.round((d < 0 ? 0 : d > 1 ? 1 : d) * 1000) / 1000;
}

let _seq = 0;
function genId(prefix) {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}${_seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ── Sociogramma: costruzione ────────────────────────────────────────────
export function nodoCentro() {
  return { id: CENTER_ID, isCenter: true, name: CENTER_LABEL, x: 0.5, y: 0.5, distance: 0, note: '' };
}

export function sociogrammaVuoto() {
  return { nodes: [nodoCentro()], edges: [] };
}

// Normalizza un sociogramma "grezzo" letto da Firestore: garantisce il
// centro pinnato, nodi completi, archi validi (scarta quelli che puntano a
// nodi inesistenti o cappi su sé stessi).
export function normalizzaSociogramma(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const rawNodes = Array.isArray(src.nodes) ? src.nodes : [];
  const nodes = [];
  let hasCenter = false;
  for (const n of rawNodes) {
    if (!n || typeof n !== 'object') continue;
    if (n.id === CENTER_ID || n.isCenter) {
      hasCenter = true;
      nodes.unshift(nodoCentro());
      continue;
    }
    if (!n.id) continue;
    const x = clamp01(n.x);
    const y = clamp01(n.y);
    nodes.push({
      id: String(n.id),
      name: typeof n.name === 'string' ? n.name : '',
      x, y,
      distance: distanzaDalCentro({ x, y }),
      note: typeof n.note === 'string' ? n.note : '',
    });
  }
  if (!hasCenter) nodes.unshift(nodoCentro());

  const ids = new Set(nodes.map(n => n.id));
  const rawEdges = Array.isArray(src.edges) ? src.edges : [];
  const seenPairs = new Set();
  const edges = [];
  for (const e of rawEdges) {
    if (!e || typeof e !== 'object') continue;
    const source = String(e.source ?? '');
    const target = String(e.target ?? '');
    if (!ids.has(source) || !ids.has(target) || source === target) continue;
    const pairKey = [source, target].sort().join('::');
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    edges.push({
      id: e.id ? String(e.id) : genId('e'),
      source, target,
      direction: DIREZIONI.some(d => d.id === e.direction) ? e.direction : DIREZIONE_DEFAULT,
      quality: QUALITA_RELAZIONE.some(q => q.id === e.quality) ? e.quality : QUALITA_DEFAULT,
    });
  }
  return { nodes, edges };
}

// ── Nodi: operazioni (immutabili — restituiscono un nuovo sociogramma) ───

// Posizione di comparsa di un nuovo nodo: su un anello attorno al centro,
// distribuita in cerchio in base a quante persone ci sono già, così i nodi
// non si sovrappongono prima che il ragazzo li trascini dove vuole.
function posizioneIniziale(socio) {
  const n = socio.nodes.filter(x => !x.isCenter && x.id !== CENTER_ID).length;
  const ang = (-Math.PI / 2) + n * (Math.PI * 2 / 7);
  const r = 0.34;
  return { x: clamp01(0.5 + r * Math.cos(ang)), y: clamp01(0.5 + r * Math.sin(ang)) };
}

export function aggiungiNodo(socio, { id, name, x, y, note } = {}) {
  const nome = String(name ?? '').trim();
  if (!nome) throw new Error('Serve un nome per la persona.');
  const pos = (x == null || y == null) ? posizioneIniziale(socio) : { x: clamp01(x), y: clamp01(y) };
  const nodo = {
    id: id || genId('n'),
    name: nome,
    x: pos.x,
    y: pos.y,
    distance: distanzaDalCentro(pos),
    note: String(note ?? ''),
  };
  return { ...socio, nodes: [...socio.nodes, nodo], edges: [...socio.edges] };
}

export function rinominaNodo(socio, nodeId, name) {
  if (nodeId === CENTER_ID) throw new Error('Il centro «IO» non può essere rinominato.');
  const nome = String(name ?? '').trim();
  if (!nome) throw new Error('Il nome non può restare vuoto.');
  return {
    ...socio,
    nodes: socio.nodes.map(n => (n.id === nodeId ? { ...n, name: nome } : n)),
    edges: [...socio.edges],
  };
}

export function spostaNodo(socio, nodeId, x, y) {
  // Il centro resta pinnato: uno spostamento sul centro è ignorato, non è un errore.
  if (nodeId === CENTER_ID) return { ...socio, nodes: [...socio.nodes], edges: [...socio.edges] };
  const nx = clamp01(x);
  const ny = clamp01(y);
  return {
    ...socio,
    nodes: socio.nodes.map(n => (n.id === nodeId
      ? { ...n, x: nx, y: ny, distance: distanzaDalCentro({ x: nx, y: ny }) }
      : n)),
    edges: [...socio.edges],
  };
}

export function impostaNotaNodo(socio, nodeId, note) {
  return {
    ...socio,
    nodes: socio.nodes.map(n => (n.id === nodeId ? { ...n, note: String(note ?? '') } : n)),
    edges: [...socio.edges],
  };
}

// Elimina un nodo E tutti gli archi che lo toccano (in qualunque direzione).
export function eliminaNodo(socio, nodeId) {
  if (nodeId === CENTER_ID) throw new Error('Il centro «IO» non può essere eliminato.');
  return {
    ...socio,
    nodes: socio.nodes.filter(n => n.id !== nodeId),
    edges: socio.edges.filter(e => e.source !== nodeId && e.target !== nodeId),
  };
}

// ── Archi: operazioni ──────────────────────────────────────────────────
export function arcoTraCoppia(socio, a, b) {
  return socio.edges.find(e =>
    (e.source === a && e.target === b) || (e.source === b && e.target === a)) || null;
}

// Crea (o aggiorna, se la coppia è già collegata) l'arco fra due nodi.
// I collegamenti NON sono limitati a IO: qualsiasi coppia di nodi è ammessa.
export function creaArco(socio, sourceId, targetId, { direction, quality } = {}) {
  if (!sourceId || !targetId) throw new Error('Servono due persone da collegare.');
  if (sourceId === targetId) throw new Error('Scegli due persone diverse.');
  const nodeIds = new Set(socio.nodes.map(n => n.id));
  if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) throw new Error('Una delle due persone non è sulla mappa.');
  const dir = DIREZIONI.some(d => d.id === direction) ? direction : DIREZIONE_DEFAULT;
  const qual = QUALITA_RELAZIONE.some(q => q.id === quality) ? quality : QUALITA_DEFAULT;

  const esistente = arcoTraCoppia(socio, sourceId, targetId);
  if (esistente) {
    return {
      ...socio,
      nodes: [...socio.nodes],
      edges: socio.edges.map(e => (e.id === esistente.id
        ? { ...e, source: sourceId, target: targetId, direction: dir, quality: qual }
        : e)),
    };
  }
  return {
    ...socio,
    nodes: [...socio.nodes],
    edges: [...socio.edges, { id: genId('e'), source: sourceId, target: targetId, direction: dir, quality: qual }],
  };
}

export function impostaDirezioneArco(socio, edgeId, direction) {
  if (!DIREZIONI.some(d => d.id === direction)) throw new Error('Direzione non valida.');
  return {
    ...socio,
    nodes: [...socio.nodes],
    edges: socio.edges.map(e => (e.id === edgeId ? { ...e, direction } : e)),
  };
}

export function impostaQualitaArco(socio, edgeId, quality) {
  if (!QUALITA_RELAZIONE.some(q => q.id === quality)) throw new Error('Qualità non valida.');
  return {
    ...socio,
    nodes: [...socio.nodes],
    edges: socio.edges.map(e => (e.id === edgeId ? { ...e, quality } : e)),
  };
}

export function eliminaArco(socio, edgeId) {
  return {
    ...socio,
    nodes: [...socio.nodes],
    edges: socio.edges.filter(e => e.id !== edgeId),
  };
}

// ── Lettura / riepilogo (per la vista in sola lettura del colloquio) ────
export function contaPersone(socio) {
  return socio.nodes.filter(n => n.id !== CENTER_ID && !n.isCenter).length;
}

export function nomeNodo(socio, nodeId) {
  if (nodeId === CENTER_ID) return CENTER_LABEL;
  const n = socio.nodes.find(x => x.id === nodeId);
  return n ? (n.name || '—') : '—';
}

export function descriviArco(socio, edge) {
  return `${nomeNodo(socio, edge.source)} ${simboloDirezione(edge.direction)} ${nomeNodo(socio, edge.target)}`;
}

// Struttura di una Scheda C nuova (bozza). js/ppu-scheda-c.js vi aggiunge i
// campi di persistenza (timestamp Firestore, createdBy, ecc.).
export function schedaCVuota() {
  return {
    sociogrammi: {
      vicinanza: sociogrammaVuoto(),
      fatica: sociogrammaVuoto(),
    },
    note: '',
  };
}

// ── Rendering SVG del sociogramma (puro: nessun DOM, nessun Firebase) ───
// Restituisce una stringa <svg> completa. Usato sia dall'editor interattivo
// (js/ppu-scheda-c.js, che vi attacca i Pointer Events) sia dalla vista in
// sola lettura del colloquio. Tenuto qui per poter essere testato in Node.
// Solo parametri GRAFICI del disegno. Non hanno effetto sui dati: le
// coordinate salvate restano normalizzate in [0,1] e la geometria degli
// archi è ricavata da questi valori solo per il rendering.
//
// L'area del sociogramma ha proporzioni ~A4 orizzontale (VIEW_W/VIEW_H ≈
// 1,414): grande "bersaglio" circolare centrato, nodi persona a CAPSULA
// (pill) larghi abbastanza da contenere il nome su 1-2 righe. Il contenitore
// usa width:100% + max-width + aspect-ratio, quindi scala proporzionale su
// tablet/mobile senza scroll orizzontale.
export const GEOMETRIA = {
  VIEW_W: 1120, VIEW_H: 792,          // ~A4 landscape (1120/792 = 1,4141)
  CX: 560, CY: 396,                   // centro "IO" = (VIEW_W/2, VIEW_H/2)
  R_OUTER: 356,                       // raggio anello esterno (~0,9 · VIEW_H/2)
  RING_FRACS: [1, 0.64, 0.32],        // 3 anelli concentrici
  IO_R: 46,                           // raggio nodo "IO" (cerchio)
  NODE_H: 58,                         // altezza capsula persona
  NODE_PAD_X: 18,                     // padding interno orizzontale per lato
  NODE_MIN_HALF_W: 47,                // semilarghezza minima capsula (width 94)
  NODE_MAX_HALF_W: 86,                // semilarghezza massima capsula (width 172)
  FONT: 15, FONT_IO: 18, LINE_H: 18,  // testo
  EDGE_W: 4, ARROW: 12, GAP: 5,       // linee, punte frecce, stacco dal bordo
  RING_STROKE_W: 4,
};

function _esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
}
// Etichetta di un nodo: 1 riga per nomi corti, 2 righe bilanciate per nomi
// con più parole ("Maria Teresa" -> "Maria"/"Teresa", "Educatrice Anna" ->
// "Educatrice"/"Anna"). L'ellissi "…" è l'ULTIMA risorsa, solo per una
// singola parola più lunga della riga.
function _etichettaNodo(name) {
  const s = String(name ?? '').trim();
  if (!s) return ['?'];
  const MAXLINE = 15;
  const cut = t => (t.length > MAXLINE ? t.slice(0, MAXLINE - 1) + '…' : t);
  const words = s.split(/\s+/);
  if (words.length === 1) return s.length <= MAXLINE ? [s] : [cut(s)];
  // due righe: split che bilancia meglio le lunghezze
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const l1 = words.slice(0, i).join(' ');
    const l2 = words.slice(i).join(' ');
    const score = Math.max(l1.length, l2.length);
    if (!best || score < best.score) best = { l1, l2, score };
  }
  return [cut(best.l1), cut(best.l2)];
}

// Dimensioni (semilarghezza hw, semialtezza hh) del nodo per il rendering e
// per il calcolo del punto di aggancio delle frecce sul BORDO. Pura funzione
// del nome (stima della larghezza del testo, nessun DOM).
export function dimensioniNodo(node, geo = GEOMETRIA) {
  if (!node || node.id === CENTER_ID || node.isCenter) {
    return { hw: geo.IO_R, hh: geo.IO_R, circle: true, lines: [CENTER_LABEL] };
  }
  const lines = _etichettaNodo(node.name || '?');
  const longest = Math.max(1, ...lines.map(l => l.length));
  const textW = longest * geo.FONT * 0.60;                 // ~0,60em per carattere (Nunito 800)
  const hw = Math.max(geo.NODE_MIN_HALF_W, Math.min(geo.NODE_MAX_HALF_W, textW / 2 + geo.NODE_PAD_X));
  return { hw, hh: geo.NODE_H / 2, circle: false, lines };
}

// Geometria di un arco: dal BORDO del nodo origine al BORDO del nodo
// destinazione (le linee non attraversano mai il testo), in coordinate del
// viewBox. Il bordo è trattato come ellisse di semiassi (hw, hh) — coincide
// col cerchio quando hw == hh (nodo "IO"). null se un estremo non esiste.
export function geometriaArco(socio, edge, geo = GEOMETRIA) {
  const a = socio.nodes.find(n => n.id === edge.source);
  const b = socio.nodes.find(n => n.id === edge.target);
  if (!a || !b) return null;
  const { VIEW_W, VIEW_H, GAP } = geo;
  const ax = clamp01(a.x) * VIEW_W, ay = clamp01(a.y) * VIEW_H;
  const bx = clamp01(b.x) * VIEW_W, by = clamp01(b.y) * VIEW_H;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const da = dimensioniNodo(a, geo), db = dimensioniNodo(b, geo);
  // distanza centro→bordo lungo il raggio, per un'ellisse (hw, hh)
  const ta = 1 / Math.sqrt((ux / da.hw) ** 2 + (uy / da.hh) ** 2);
  const tb = 1 / Math.sqrt((ux / db.hw) ** 2 + (uy / db.hh) ** 2);
  // Nodi quasi a contatto: senza guardia la linea "sorpasserebbe" i due
  // bordi e comparirebbe rovesciata (frecce accavallate). Stub corto al
  // centro fra i due bordi, colore e direzione restano leggibili.
  if (len <= ta + tb + GAP * 2 + 6) {
    const mx = ax + ux * (len / 2), my = ay + uy * (len / 2);
    return { x1: mx - ux * 4, y1: my - uy * 4, x2: mx + ux * 4, y2: my + uy * 4 };
  }
  return {
    x1: ax + ux * (ta + GAP), y1: ay + uy * (ta + GAP),
    x2: bx - ux * (tb + GAP), y2: by - uy * (tb + GAP),
  };
}

export function disegnaSociogrammaSVG(socio, opts = {}) {
  const { interattivo = false, accento = '#3b6ea5', linkFrom = null, geo = GEOMETRIA } = opts;
  const { VIEW_W, VIEW_H, CX, CY, R_OUTER, RING_FRACS, IO_R, NODE_H, FONT, FONT_IO, LINE_H, EDGE_W, ARROW, RING_STROKE_W } = geo;
  const pxX = v => clamp01(v) * VIEW_W;
  const pxY = v => clamp01(v) * VIEW_H;
  const so = socio && Array.isArray(socio.nodes) ? socio : sociogrammaVuoto();

  // Anelli concentrici = la "distanza da IO": elemento centrale dello
  // strumento. Bande neutre che si scuriscono verso il centro + stroke
  // marcato e continuo. Disegnati dal più grande al più piccolo.
  const ringFills = ['#eef2f4', '#e3eaee', '#d6e0e6'];
  const rings = RING_FRACS.map((f, i) =>
    `<circle cx="${CX}" cy="${CY}" r="${(R_OUTER * f).toFixed(1)}" fill="${ringFills[i] || '#d6e0e6'}" stroke="#8496a2" stroke-width="${RING_STROKE_W}"/>`
  ).join('');

  const markers = QUALITA_RELAZIONE.map(q => `
    <marker id="ppuc-arw-${q.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${ARROW}" markerHeight="${ARROW}" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${q.colore}"/>
    </marker>`).join('');

  const archiHtml = (so.edges || []).map(e => {
    const g = geometriaArco(so, e, geo);
    if (!g) return '';
    const col = coloreQualita(e.quality);
    const markerEnd   = (e.direction === 'forward'  || e.direction === 'both') ? `url(#ppuc-arw-${e.quality})` : '';
    const markerStart = (e.direction === 'backward' || e.direction === 'both') ? `url(#ppuc-arw-${e.quality})` : '';
    return `
      <g class="ppuc-edge" data-edge="${_esc(e.id)}" style="cursor:${interattivo ? 'pointer' : 'default'};">
        <line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="${col}" stroke-width="${EDGE_W}" stroke-linecap="round"
              ${markerEnd ? `marker-end="${markerEnd}"` : ''} ${markerStart ? `marker-start="${markerStart}"` : ''}/>
        ${interattivo ? `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" stroke="transparent" stroke-width="28"/>` : ''}
      </g>`;
  }).join('');

  // Ogni nodo è un <g transform="translate(cx,cy)"> con figli in coordinate
  // locali: durante il drag basta aggiornare quel transform e nome +
  // capsula seguono insieme. IO = cerchio; persona = capsula (pill).
  const nodiHtml = so.nodes.map(n => {
    const isC = n.id === CENTER_ID;
    const cx = pxX(n.x), cy = pxY(n.y);
    const dim = dimensioniNodo(n, geo);
    const lines = isC ? [CENTER_LABEL] : dim.lines;
    const fs = isC ? FONT_IO : FONT;
    const textCol = isC ? '#fff' : '#243b53';
    const y0 = -(lines.length - 1) * LINE_H / 2 + fs / 3;
    const tspans = lines.map((ln, i) =>
      `<tspan x="0" y="${(y0 + i * LINE_H).toFixed(1)}">${_esc(ln)}</tspan>`).join('');
    const highlighted = linkFrom === n.id;

    let shape;
    if (isC) {
      shape =
        `<circle r="${IO_R + 7}" fill="none" stroke="#3b6ea5" stroke-opacity="0.16" stroke-width="6"/>` +
        `<circle r="${IO_R}" fill="#3b6ea5" stroke="#2f5980" stroke-width="4"/>`;
    } else {
      const w = dim.hw * 2, h = dim.hh * 2;
      const strokeCol = highlighted ? '#e07b39' : accento;
      shape = `<rect x="${(-dim.hw).toFixed(1)}" y="${(-dim.hh).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${dim.hh.toFixed(1)}" ry="${dim.hh.toFixed(1)}" fill="#ffffff" stroke="${strokeCol}" stroke-width="${highlighted ? 4 : 2.5}"/>`;
    }
    return `
      <g class="ppuc-node" data-node="${_esc(n.id)}" transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})" style="cursor:${interattivo ? (isC ? 'default' : 'grab') : 'default'};touch-action:none;">
        ${shape}
        <text text-anchor="middle" font-family="'Nunito',sans-serif" font-size="${fs}" font-weight="800" fill="${textCol}" style="pointer-events:none;">${tspans}</text>
      </g>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" width="100%" preserveAspectRatio="xMidYMid meet" style="width:100%;max-width:1150px;aspect-ratio:${VIEW_W} / ${VIEW_H};display:block;margin:0 auto;background:#fafafa;border:1px solid #dfe4e7;border-radius:16px;touch-action:none;">
      <defs>${markers}</defs>
      ${rings}
      ${archiHtml}
      ${nodiHtml}
    </svg>`;
}

// Validazione prima del completamento: coerente con Scheda A / B — servono
// il momento PPU e il conduttore. NON si impone un numero minimo di persone
// o collegamenti: una rete può legittimamente essere scarna.
export function validaCompletamento(scheda) {
  const problemi = [];
  if (!scheda.ppuMoment) {
    problemi.push({ tipo: 'momento', msg: 'Seleziona il momento del percorso PPU prima di completare la scheda.' });
  }
  if (!scheda.conductedBy) {
    problemi.push({ tipo: 'conduttore', msg: 'Indica chi ha condotto il colloquio prima di completare la scheda.' });
  }
  return problemi;
}
