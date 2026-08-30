// tests/ppu-scheda-c.model.test.mjs
// Test del nucleo dati puro della Scheda C PPU (js/ppu-scheda-c-model.js).
// Nessuna dipendenza esterna: `node --test tests/ppu-scheda-c.model.test.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CENTER_ID,
  DIREZIONI, QUALITA_RELAZIONE, QUALITA_DEFAULT, DIREZIONE_DEFAULT,
  coloreQualita,
  clamp01, distanzaDalCentro,
  sociogrammaVuoto, normalizzaSociogramma, schedaCVuota,
  aggiungiNodo, rinominaNodo, spostaNodo, impostaNotaNodo, eliminaNodo,
  arcoTraCoppia, creaArco, impostaDirezioneArco, impostaQualitaArco, eliminaArco,
  contaPersone, descriviArco, validaCompletamento,
  GEOMETRIA, geometriaArco, disegnaSociogrammaSVG, dimensioniNodo,
} from '../js/ppu-scheda-c-model.js';

// ── Struttura di una Scheda C nuova ─────────────────────────────────────
test('creazione Scheda C: due sociogrammi vuoti indipendenti, ognuno col solo centro IO', () => {
  const s = schedaCVuota();
  assert.deepEqual(Object.keys(s.sociogrammi).sort(), ['fatica', 'vicinanza']);
  for (const key of ['vicinanza', 'fatica']) {
    const so = s.sociogrammi[key];
    assert.equal(so.nodes.length, 1);
    assert.equal(so.nodes[0].id, CENTER_ID);
    assert.equal(so.nodes[0].isCenter, true);
    assert.equal(so.nodes[0].x, 0.5);
    assert.equal(so.nodes[0].y, 0.5);
    assert.deepEqual(so.edges, []);
  }
  // i due sociogrammi non condividono riferimenti
  assert.notEqual(s.sociogrammi.vicinanza, s.sociogrammi.fatica);
  assert.notEqual(s.sociogrammi.vicinanza.nodes, s.sociogrammi.fatica.nodes);
});

// ── Coordinate normalizzate ────────────────────────────────────────────
test('clamp01 vincola le coordinate a [0,1] e gestisce valori non numerici', () => {
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(0.42), 0.42);
  assert.equal(clamp01('abc'), 0.5);
});

test('distanzaDalCentro: 0 al centro, 1 sul bordo lungo un asse', () => {
  assert.equal(distanzaDalCentro({ x: 0.5, y: 0.5 }), 0);
  assert.equal(distanzaDalCentro({ x: 1, y: 0.5 }), 1);
  assert.equal(distanzaDalCentro({ x: 0, y: 0.5 }), 1);
  const d = distanzaDalCentro({ x: 0.75, y: 0.5 });
  assert.ok(d > 0.49 && d < 0.51);
});

test('aggiungiNodo salva coordinate normalizzate e distanza coerente', () => {
  let so = sociogrammaVuoto();
  so = aggiungiNodo(so, { name: 'Marco', x: 0.9, y: 0.5 });
  const n = so.nodes.find(x => x.name === 'Marco');
  assert.ok(n);
  assert.equal(n.x, 0.9);
  assert.equal(n.y, 0.5);
  assert.equal(n.distance, distanzaDalCentro({ x: 0.9, y: 0.5 }));
  assert.equal(n.note, '');
});

test('aggiungiNodo senza coordinate colloca su un anello dentro la mappa', () => {
  let so = sociogrammaVuoto();
  so = aggiungiNodo(so, { name: 'A' });
  so = aggiungiNodo(so, { name: 'B' });
  for (const n of so.nodes.filter(x => x.id !== CENTER_ID)) {
    assert.ok(n.x >= 0 && n.x <= 1);
    assert.ok(n.y >= 0 && n.y <= 1);
    assert.ok(n.distance > 0 && n.distance <= 1);
  }
});

test('aggiungiNodo rifiuta un nome vuoto', () => {
  const so = sociogrammaVuoto();
  assert.throws(() => aggiungiNodo(so, { name: '   ' }), /nome/i);
  assert.throws(() => aggiungiNodo(so, {}), /nome/i);
});

test('spostaNodo aggiorna x/y (clampati) e ricalcola la distanza', () => {
  let so = aggiungiNodo(sociogrammaVuoto(), { id: 'n1', name: 'Luca', x: 0.5, y: 0.5 });
  so = spostaNodo(so, 'n1', 1.4, -0.2);
  const n = so.nodes.find(x => x.id === 'n1');
  assert.equal(n.x, 1);
  assert.equal(n.y, 0);
  assert.equal(n.distance, distanzaDalCentro({ x: 1, y: 0 }));
});

// ── Il centro IO è protetto ────────────────────────────────────────────
test('IO non può essere eliminato', () => {
  const so = aggiungiNodo(sociogrammaVuoto(), { name: 'Mamma' });
  assert.throws(() => eliminaNodo(so, CENTER_ID), /IO/);
});

test('IO non può essere rinominato', () => {
  const so = sociogrammaVuoto();
  assert.throws(() => rinominaNodo(so, CENTER_ID, 'Altro'), /IO/);
});

test('IO non può essere spostato dal centro (spostamento ignorato, non è errore)', () => {
  let so = sociogrammaVuoto();
  so = spostaNodo(so, CENTER_ID, 0.1, 0.9);
  const io = so.nodes.find(n => n.id === CENTER_ID);
  assert.equal(io.x, 0.5);
  assert.equal(io.y, 0.5);
});

// ── Nodi: rinomina / nota / elimina ────────────────────────────────────
test('rinominaNodo cambia il nome; nome vuoto rifiutato', () => {
  let so = aggiungiNodo(sociogrammaVuoto(), { id: 'n1', name: 'Marco' });
  so = rinominaNodo(so, 'n1', 'Marco R.');
  assert.equal(so.nodes.find(n => n.id === 'n1').name, 'Marco R.');
  assert.throws(() => rinominaNodo(so, 'n1', '  '), /vuoto/i);
});

test('impostaNotaNodo memorizza una nota facoltativa', () => {
  let so = aggiungiNodo(sociogrammaVuoto(), { id: 'n1', name: 'Anna' });
  so = impostaNotaNodo(so, 'n1', 'Educatrice di riferimento');
  assert.equal(so.nodes.find(n => n.id === 'n1').note, 'Educatrice di riferimento');
});

test('eliminaNodo rimuove il nodo E tutti gli archi che lo toccano', () => {
  let so = sociogrammaVuoto();
  so = aggiungiNodo(so, { id: 'mamma', name: 'Mamma' });
  so = aggiungiNodo(so, { id: 'papa', name: 'Papà' });
  so = aggiungiNodo(so, { id: 'marco', name: 'Marco' });
  so = creaArco(so, CENTER_ID, 'mamma', {});
  so = creaArco(so, 'mamma', 'papa', {});
  so = creaArco(so, 'marco', 'papa', {});
  assert.equal(so.edges.length, 3);

  so = eliminaNodo(so, 'papa');
  assert.equal(so.nodes.find(n => n.id === 'papa'), undefined);
  assert.equal(so.edges.length, 1);
  assert.equal(so.edges[0].source, CENTER_ID);
  assert.equal(so.edges[0].target, 'mamma');
});

// ── Archi: direzione → ← ↔ ─────────────────────────────────────────────
function conDueNodi() {
  let so = sociogrammaVuoto();
  so = aggiungiNodo(so, { id: 'a', name: 'A' });
  so = aggiungiNodo(so, { id: 'b', name: 'B' });
  return so;
}

test('creaArco: edge → (forward)', () => {
  const so = creaArco(conDueNodi(), 'a', 'b', { direction: 'forward' });
  assert.equal(so.edges.length, 1);
  assert.equal(so.edges[0].direction, 'forward');
  assert.equal(so.edges[0].source, 'a');
  assert.equal(so.edges[0].target, 'b');
});

test('creaArco: edge ← (backward)', () => {
  const so = creaArco(conDueNodi(), 'a', 'b', { direction: 'backward' });
  assert.equal(so.edges[0].direction, 'backward');
});

test('creaArco: edge ↔ (both) è il default', () => {
  const so = creaArco(conDueNodi(), 'a', 'b', {});
  assert.equal(so.edges[0].direction, DIREZIONE_DEFAULT);
  assert.equal(so.edges[0].direction, 'both');
});

test('creaArco NON è limitato a IO: qualsiasi coppia di nodi', () => {
  const so = creaArco(conDueNodi(), 'a', 'b', {});
  assert.ok(arcoTraCoppia(so, 'a', 'b'));
});

test('creaArco rifiuta cappi su sé stessi e nodi inesistenti', () => {
  const so = conDueNodi();
  assert.throws(() => creaArco(so, 'a', 'a', {}), /divers/i);
  assert.throws(() => creaArco(so, 'a', 'zzz', {}), /mappa/i);
});

test('creaArco sulla stessa coppia già collegata aggiorna l’arco esistente (nessun doppione)', () => {
  let so = creaArco(conDueNodi(), 'a', 'b', { direction: 'forward', quality: 'green' });
  const id1 = so.edges[0].id;
  so = creaArco(so, 'b', 'a', { direction: 'both', quality: 'red' });
  assert.equal(so.edges.length, 1);
  assert.equal(so.edges[0].id, id1);
  assert.equal(so.edges[0].direction, 'both');
  assert.equal(so.edges[0].quality, 'red');
  assert.equal(so.edges[0].source, 'b');
  assert.equal(so.edges[0].target, 'a');
});

// ── Archi: colore / qualità ───────────────────────────────────────────
test('creaArco imposta la qualità richiesta; default = grigio/neutro', () => {
  assert.equal(creaArco(conDueNodi(), 'a', 'b', {}).edges[0].quality, QUALITA_DEFAULT);
  assert.equal(creaArco(conDueNodi(), 'a', 'b', { quality: 'green' }).edges[0].quality, 'green');
});

test('coloreQualita mappa ogni id di legenda su un colore; fallback su neutro', () => {
  for (const q of QUALITA_RELAZIONE) assert.match(coloreQualita(q.id), /^#[0-9a-f]{6}$/i);
  assert.equal(coloreQualita('non-esiste'), coloreQualita(QUALITA_DEFAULT));
});

test('la legenda colori espone almeno verde/giallo/rosso/grigio ed è configurabile in un solo punto', () => {
  const ids = QUALITA_RELAZIONE.map(q => q.id);
  for (const id of ['green', 'yellow', 'red', 'grey']) assert.ok(ids.includes(id));
});

// ── Archi: modifica / eliminazione ────────────────────────────────────
test('impostaDirezioneArco e impostaQualitaArco modificano l’arco; valori non validi rifiutati', () => {
  let so = creaArco(conDueNodi(), 'a', 'b', {});
  const id = so.edges[0].id;
  so = impostaDirezioneArco(so, id, 'forward');
  assert.equal(so.edges[0].direction, 'forward');
  so = impostaQualitaArco(so, id, 'yellow');
  assert.equal(so.edges[0].quality, 'yellow');
  assert.throws(() => impostaDirezioneArco(so, id, 'diagonale'), /valida/i);
  assert.throws(() => impostaQualitaArco(so, id, 'fucsia'), /valida/i);
});

test('eliminaArco rimuove solo l’arco indicato', () => {
  let so = sociogrammaVuoto();
  so = aggiungiNodo(so, { id: 'a', name: 'A' });
  so = aggiungiNodo(so, { id: 'b', name: 'B' });
  so = creaArco(so, CENTER_ID, 'a', {});
  so = creaArco(so, CENTER_ID, 'b', {});
  const id = so.edges[0].id;
  so = eliminaArco(so, id);
  assert.equal(so.edges.length, 1);
  assert.equal(so.edges.find(e => e.id === id), undefined);
});

// ── Stessa persona in C1 e C2 ─────────────────────────────────────────
test('la stessa persona è ammessa sia in C1 (vicinanza) sia in C2 (fatica), indipendentemente', () => {
  const s = schedaCVuota();
  s.sociogrammi.vicinanza = aggiungiNodo(s.sociogrammi.vicinanza, { id: 'v_mamma', name: 'Mamma', x: 0.5, y: 0.35 });
  s.sociogrammi.fatica    = aggiungiNodo(s.sociogrammi.fatica,    { id: 'f_mamma', name: 'Mamma', x: 0.5, y: 0.15 });

  assert.equal(contaPersone(s.sociogrammi.vicinanza), 1);
  assert.equal(contaPersone(s.sociogrammi.fatica), 1);
  // eliminare Mamma da C2 non tocca C1
  s.sociogrammi.fatica = eliminaNodo(s.sociogrammi.fatica, 'f_mamma');
  assert.equal(contaPersone(s.sociogrammi.fatica), 0);
  assert.equal(contaPersone(s.sociogrammi.vicinanza), 1);
});

// ── normalizzaSociogramma (lettura da Firestore) ──────────────────────
test('normalizzaSociogramma garantisce il centro e scarta gli archi verso nodi inesistenti', () => {
  const so = normalizzaSociogramma({
    nodes: [
      { id: 'x', name: 'X', x: 0.2, y: 0.2 },
    ],
    edges: [
      { id: 'e1', source: 'x', target: 'io', direction: 'both', quality: 'green' },
      { id: 'e2', source: 'x', target: 'ghost', direction: 'forward', quality: 'red' },
      { id: 'e3', source: 'x', target: 'x', direction: 'both', quality: 'grey' },
    ],
  });
  assert.ok(so.nodes.some(n => n.id === CENTER_ID && n.isCenter));
  assert.equal(so.edges.length, 1);
  assert.equal(so.edges[0].id, 'e1');
});

test('normalizzaSociogramma su input vuoto/rotto restituisce un sociogramma valido col solo centro', () => {
  for (const bad of [undefined, null, {}, { nodes: 'nope', edges: 42 }]) {
    const so = normalizzaSociogramma(bad);
    assert.equal(so.nodes.length, 1);
    assert.equal(so.nodes[0].id, CENTER_ID);
    assert.deepEqual(so.edges, []);
  }
});

// ── descrizione testuale (vista sola lettura del colloquio) ────────────
test('descriviArco produce una riga leggibile col simbolo di direzione', () => {
  let so = sociogrammaVuoto();
  so = aggiungiNodo(so, { id: 'mamma', name: 'Mamma' });
  so = creaArco(so, CENTER_ID, 'mamma', { direction: 'both' });
  assert.equal(descriviArco(so, so.edges[0]), 'IO ↔ Mamma');
});

// ── validazione al completamento ──────────────────────────────────────
test('validaCompletamento richiede momento PPU e conduttore, non un numero minimo di persone', () => {
  assert.equal(validaCompletamento({ ppuMoment: 'ingresso', conductedBy: 'uid1' }).length, 0);
  const p = validaCompletamento({ ppuMoment: null, conductedBy: null });
  assert.equal(p.length, 2);
  assert.ok(p.some(x => x.tipo === 'momento'));
  assert.ok(p.some(x => x.tipo === 'conduttore'));
});

test('le operazioni sui nodi/archi sono immutabili (non mutano il sociogramma in ingresso)', () => {
  const so0 = sociogrammaVuoto();
  const so1 = aggiungiNodo(so0, { name: 'A' });
  assert.equal(so0.nodes.length, 1);
  assert.equal(so1.nodes.length, 2);
  assert.notEqual(so0, so1);
});

// ── Rendering SVG (puro) ───────────────────────────────────────────────
test('geometriaArco parte/termina sul bordo dei nodi, non al loro centro', () => {
  let so = sociogrammaVuoto();
  so = aggiungiNodo(so, { id: 'a', name: 'A', x: 0.9, y: 0.5 });
  so = creaArco(so, CENTER_ID, 'a', {});
  const g = geometriaArco(so, so.edges[0]);
  const { VIEW_W, VIEW_H, CX, CY, IO_R, NODE_MIN_HALF_W } = GEOMETRIA;
  const ax = 0.9 * VIEW_W;
  // segmento orizzontale (y = centro), staccato dal bordo di IO e del nodo A
  assert.ok(Math.abs(g.y1 - CY) < 0.5);
  assert.ok(Math.abs(g.y2 - CY) < 0.5);
  assert.ok(g.x1 > CX + IO_R);                       // fuori dal cerchio IO
  assert.ok(g.x1 < CX + IO_R + 20);                  // ma vicino al bordo
  assert.ok(g.x2 < ax - NODE_MIN_HALF_W + 1);        // fuori dalla capsula di A
  assert.ok(g.x2 > g.x1);                            // orientamento corretto
});

test('geometriaArco restituisce null se un estremo non esiste', () => {
  const so = sociogrammaVuoto();
  assert.equal(geometriaArco(so, { source: CENTER_ID, target: 'ghost' }), null);
});

test('geometriaArco: nodi quasi sovrapposti -> stub corto, mai linea rovesciata', () => {
  let so = sociogrammaVuoto();                       // centro in 0.5,0.5
  so = aggiungiNodo(so, { id: 'a', name: 'A', x: 0.51, y: 0.5 });
  so = creaArco(so, CENTER_ID, 'a', {});
  const g = geometriaArco(so, so.edges[0]);
  const seg = Math.hypot(g.x2 - g.x1, g.y2 - g.y1);
  assert.ok(seg > 0 && seg < 30);                    // stub breve
  assert.ok(g.x2 >= g.x1);                           // orientamento non invertito
});

test('dimensioniNodo: capsula si allarga col nome ma resta nei limiti; IO è un cerchio', () => {
  const { NODE_MIN_HALF_W, NODE_MAX_HALF_W, IO_R } = GEOMETRIA;
  const io = dimensioniNodo({ id: CENTER_ID });
  assert.equal(io.circle, true);
  assert.equal(io.hw, IO_R);
  assert.equal(io.hh, IO_R);
  const corto = dimensioniNodo({ id: 'x', name: 'Ada' });
  const lungo = dimensioniNodo({ id: 'y', name: 'Massimiliano' });
  assert.ok(corto.hw >= NODE_MIN_HALF_W && corto.hw <= NODE_MAX_HALF_W);
  assert.ok(lungo.hw >= NODE_MIN_HALF_W && lungo.hw <= NODE_MAX_HALF_W);
  assert.ok(lungo.hw > corto.hw);                    // il nome più lungo -> capsula più larga
});

test('etichetta: nomi con più parole vanno su 2 righe senza ellissi', () => {
  const svg = disegnaSociogrammaSVG(
    aggiungiNodo(aggiungiNodo(sociogrammaVuoto(), { id:'a', name:'Maria Teresa' }), { id:'b', name:'Educatrice Anna' }), {});
  assert.ok(svg.includes('<tspan') );
  assert.ok(svg.includes('>Maria<') && svg.includes('>Teresa<'));
  assert.ok(svg.includes('>Educatrice<') && svg.includes('>Anna<'));
  assert.ok(!svg.includes('…'));                     // nessuna ellissi su nomi normali
});

test('disegnaSociogrammaSVG produce un <svg> con centro, nodi, archi e marker per ogni qualità', () => {
  let so = sociogrammaVuoto();
  so = aggiungiNodo(so, { id: 'a', name: 'Mamma', x: 0.5, y: 0.3 });
  so = aggiungiNodo(so, { id: 'b', name: 'Papà', x: 0.7, y: 0.7 });
  so = creaArco(so, 'a', 'b', { direction: 'forward', quality: 'green' });
  const svg = disegnaSociogrammaSVG(so, { interattivo: true });
  assert.match(svg, /^\s*<svg/);
  assert.match(svg, /data-node="io"/);
  assert.match(svg, /data-node="a"/);
  assert.match(svg, /data-edge=/);
  assert.match(svg, /marker-end="url\(#ppuc-arw-green\)"/);
  for (const q of QUALITA_RELAZIONE) assert.ok(svg.includes(`id="ppuc-arw-${q.id}"`));
  // il nome è HTML-escaped (nessuna iniezione)
  const inj = disegnaSociogrammaSVG(aggiungiNodo(sociogrammaVuoto(), { name: '<b>x</b>' }), {});
  assert.ok(!inj.includes('<b>x</b>'));
});

test('disegnaSociogrammaSVG: direzione ↔ mette una freccia a ciascuna estremità', () => {
  let so = sociogrammaVuoto();
  so = aggiungiNodo(so, { id: 'a', name: 'A', x: 0.3, y: 0.3 });
  so = creaArco(so, CENTER_ID, 'a', { direction: 'both', quality: 'red' });
  const svg = disegnaSociogrammaSVG(so, {});
  assert.match(svg, /marker-start="url\(#ppuc-arw-red\)"/);
  assert.match(svg, /marker-end="url\(#ppuc-arw-red\)"/);
});

test('disegnaSociogrammaSVG su input non valido non lancia e disegna comunque il centro', () => {
  const svg = disegnaSociogrammaSVG(null, {});
  assert.match(svg, /data-node="io"/);
});
