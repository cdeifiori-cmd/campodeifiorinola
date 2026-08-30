// js/ppu-scheda-d.js — "Sintesi educativa integrata" (Scheda D PPU): interfaccia
// di CONSULTAZIONE e GENERAZIONE. Non un test, non un punteggio, non una
// diagnosi: è una sintesi generata dall'AI incrociando le Schede A, B e C,
// destinata alla rilettura dell'équipe educativa.
//
// La D non si compila e non si crea dal client: la crea la Cloud Function
// `generaSchedaDPPU` (Admin SDK). Qui si può solo:
//   - vedere, per un ragazzo, i momenti PPU e lo stato della loro Scheda D;
//   - lanciare la generazione (callable) quando A+B+C sono disponibili;
//   - aprire una D come documento educativo e consultarne le fonti di origine.
//
// La RILETTURA e la VALIDAZIONE dell'équipe sono implementate qui (Passo 5):
// valutazioni/osservazioni per elemento + osservazioni generali + validazione,
// senza mai toccare `contenutoAI` (solo i campi `rilettura`/`stato`/`validated*`).
//
// Architettura 1:1 con A/B/C: riceve `ctx` da documenti.html/showPPUHome
//   ctx = { db, ragazzo, community, canWrite, currentUid, go }
// La logica pura (raggruppamento, versioni, ricostruzione fonti, rendering,
// validatore della rilettura) sta in js/ppu-scheda-d-model.js.

import { getApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  collection, doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getFunctions, httpsCallable,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

import { AREE_PPU as AREE_A, DOMANDE_CHIUSURA, elencaSchede as elencaSchedeA } from './ppu-scheda-a.js';
import { AREE_PPU as AREE_B, elencaSchede as elencaSchedeB } from './ppu-scheda-b.js';
import { elencaSchede as elencaSchedeC } from './ppu-scheda-c.js';

import {
  raggruppaFontiPerMomento, elencaMomenti, descriviMancanti,
  ricostruisciFonte, messaggioErroreGenerazione,
  renderVistaHTML, renderFontiPannelloHTML, formatDataD,
  escHtml, ETICHETTE_STATO_D, prossimoStatoToggleFonti,
  costruisciRiletturaDaValori, validaRiletturaEquipe, riletturaSignificativa,
} from './ppu-scheda-d-model.js';

const FUNCTIONS_REGION = 'europe-west1';

// ── Tabelle di lookup per la ricostruzione delle fonti A/B ──────────────
// (testi delle domande e delle opzioni: presi dai moduli A/B, non duplicati)
const LOOKUP = (() => {
  const domandaA = {}, opzioniA = {}, domandaB = {}, opzioniB = {}, chiusuraA = {};
  for (const area of AREE_A) for (const q of area.domande) { domandaA[q.id] = q.testo; opzioniA[q.id] = q.opzioni; }
  for (const area of AREE_B) for (const q of area.domande) { domandaB[q.id] = q.testo; opzioniB[q.id] = q.opzioni; }
  for (const q of DOMANDE_CHIUSURA) chiusuraA[q.id] = q.testo;
  return { domandaA, opzioniA, domandaB, opzioniB, chiusuraA };
})();

// ── Stile (iniettato una sola volta; documenti.html non va toccato per il CSS) ──
function iniettaStile() {
  if (document.getElementById('ppud-style')) return;
  const s = document.createElement('style');
  s.id = 'ppud-style';
  s.textContent = `
  .ppud-doc{max-width:760px;margin:0 auto;padding:8px 14px 90px;font-size:1rem;line-height:1.65;color:#2b2b2b}
  .ppud-testa{border-bottom:2px solid #e2ded4;padding-bottom:12px;margin-bottom:14px}
  .ppud-kicker{font-size:.72rem;font-weight:800;letter-spacing:.12em;color:#9a948a}
  .ppud-titolo{font-size:1.4rem;margin:2px 0 10px;color:#1f1f1f}
  .ppud-meta{display:grid;gap:2px 0;margin:0;font-size:.9rem}
  .ppud-meta>div{display:flex;gap:8px}
  .ppud-meta dt{font-weight:700;color:#8a857c;min-width:112px;flex:0 0 auto}
  .ppud-meta dd{margin:0}
  .ppud-stato{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.8rem;font-weight:700;background:#eef0f2;color:#555}
  .ppud-stato[data-stato="IN_RILETTURA"]{background:#f3ede0;color:#7a6a45}
  .ppud-stato[data-stato="VALIDATA"]{background:#e9f1ea;color:#3a6b47}
  .ppud-nota-metod{background:#f5f2ec;border:1px solid #e6e0d4;border-radius:10px;padding:10px 14px;font-size:.88rem;color:#5b5648;margin-bottom:22px}
  .ppud-nota-metod p{margin:0}
  .ppud-sez{margin:0 0 26px}
  .ppud-sez>h2{font-size:.95rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#4a4a4a;border-bottom:1px solid #e6e2d8;padding-bottom:5px;margin:0 0 12px}
  .ppud-pilastro>h2{text-transform:none;letter-spacing:0;font-size:1.12rem;color:#23303a;border-bottom:2px solid #e0e4e7}
  .ppud-dati{background:#f7f6f3;border-left:3px solid #d7d2c6;border-radius:0 8px 8px 0;padding:10px 14px}
  .ppud-campo{margin:0 0 10px}
  .ppud-campo:last-child{margin-bottom:0}
  .ppud-campo-k{font-size:.78rem;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:#8a857c;margin-bottom:2px}
  .ppud-campo p,.ppud-dati>p{margin:0 0 6px}
  .ppud-campo p:last-child{margin-bottom:0}
  .ppud-vuoto{color:#b7b2a8}
  .ppud-ai{margin-top:12px;background:#f4f1fa;border-left:3px solid #8b6db5;border-radius:0 8px 8px 0;padding:10px 14px}
  .ppud-ai-tag{font-size:.72rem;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:#7659a0;margin-bottom:8px}
  .ppud-chiavi>h2{text-transform:none;letter-spacing:0;font-size:1.12rem;color:#3a2f52;border-bottom:2px solid #e2ddec}
  .ppud-chiavi-sub{font-size:.86rem;color:#6a6478;margin:0 0 14px}
  .ppud-chiave{background:#f6f4fb;border:1px solid #e2ddec;border-left:3px solid #8b6db5;border-radius:0 10px 10px 0;padding:12px 16px;margin-bottom:14px}
  .ppud-chiave-ambito{font-size:.74rem;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:#7659a0;margin-bottom:8px}
  .ppud-chiave-lente{font-weight:800;color:#3a2f52;margin:0 0 2px}
  .ppud-chiave-teoria{font-size:.86rem;color:#6a6478;margin:0 0 4px}
  .ppud-chiave-lista{margin:2px 0 0;padding-left:18px}
  .ppud-chiave-lista li{margin:2px 0}
  .ppud-fonti-btn{margin-top:10px;background:#fff;border:1.5px solid #cfc9bd;color:#5a5648;font-weight:700;font-size:.82rem;border-radius:8px;padding:7px 12px;cursor:pointer;min-height:40px}
  .ppud-fonti-btn[aria-expanded="true"]{background:#efece4}
  .ppud-fonti-pan{margin-top:8px;display:grid;gap:8px}
  .ppud-fonti-pan[hidden]{display:none}
  .ppud-fonte{border:1px solid #e4e0d6;border-radius:8px;padding:8px 12px;background:#fcfbf8;font-size:.86rem}
  .ppud-fonte-cap{font-weight:800;color:#5a5648;margin-bottom:4px}
  .ppud-fonte>div{display:flex;gap:8px;margin:2px 0;flex-wrap:wrap}
  .ppud-k{font-weight:700;color:#8a857c;min-width:150px;flex:0 0 auto}
  .ppud-v{color:#333}
  .ppud-fonte-err{color:#8a6a3a;font-style:italic}
  .ppud-tr-sub{margin-bottom:14px}
  .ppud-tr-sub h3{font-size:.92rem;color:#3a3a3a;margin:0 0 6px}
  .ppud-tr-list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
  .ppud-tr-item{background:#f7f6f3;border-left:3px solid #d7d2c6;border-radius:0 8px 8px 0;padding:8px 14px}
  .ppud-tr-item p{margin:0 0 4px}
  .ppud-rilettura-info{opacity:.75}
  .ppud-rilettura-info>h2{color:#8a857c}
  .ppud-rilettura-info p{background:#f1f0ec;border:1px dashed #cfcabd;border-radius:8px;padding:10px 14px;color:#6a655a;font-style:italic;margin:0}
  /* --- rilettura équipe (Passo 5): riquadro distinto, non "clinico" --- */
  .ppud-rilettura{background:#f3f6f4;border:1px solid #dbe5df;border-radius:12px;padding:14px 16px}
  .ppud-rilettura>h2{border-bottom-color:#cfe0d6}
  .ppud-ril-intro{font-size:.86rem;color:#4c5a52;margin:0 0 12px}
  .ppud-ril-validata{background:#e9f1ea;border:1px solid #cbe2d2;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:.88rem;color:#345c46}
  .ppud-ril-validata-tit{font-weight:800;margin-bottom:2px}
  .ppud-ril-legenda{display:grid;gap:3px;font-size:.8rem;color:#5a6a60;background:#eef3f0;border-radius:8px;padding:8px 12px;margin-bottom:14px}
  .ppud-ril-grp{font-size:1rem;color:#2f4a3b;margin:18px 0 8px;border-bottom:1px solid #d7e4dc;padding-bottom:4px}
  .ppud-ril-el{background:#fff;border:1px solid #e0e8e3;border-radius:10px;padding:12px 14px;margin-bottom:10px}
  .ppud-ril-k{font-size:.76rem;font-weight:800;letter-spacing:.03em;text-transform:uppercase;color:#7a8a80;margin-bottom:4px}
  .ppud-ril-ai{background:#f4f1fa;border-left:3px solid #8b6db5;border-radius:0 6px 6px 0;padding:6px 12px;font-size:.9rem;margin-bottom:10px}
  .ppud-ril-ai p{margin:0 0 4px}.ppud-ril-ai p:last-child{margin-bottom:0}
  .ppud-ril-chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
  .ppud-ril-chip{display:inline-flex;align-items:center;gap:6px;border:1.5px solid #cfd8d2;border-radius:999px;padding:6px 12px;font-size:.84rem;font-weight:700;color:#4c5a52;cursor:pointer;min-height:38px}
  .ppud-ril-chip input{accent-color:#3b6ea5}
  .ppud-ril-chip:has(input:checked){background:#eef3f0;border-color:#8aa79a;color:#2f4a3b}
  .ppud-ril-obs-k{display:block;font-size:.74rem;font-weight:700;color:#8a857c;margin:6px 0 3px}
  .ppud-ril-obs{width:100%;box-sizing:border-box;border:1.5px solid #d5dbd7;border-radius:8px;padding:8px 10px;font-family:inherit;font-size:.9rem;resize:vertical}
  .ppud-ril-ro>div{display:flex;gap:8px;margin:2px 0;flex-wrap:wrap}
  .ppud-ril-og{margin-top:16px}
  .ppud-ril-azioni{margin-top:16px;border-top:1px solid #d7e4dc;padding-top:14px}
  .ppud-btn-salva{background:#fff;border:1.5px solid #3b6ea5;color:#2f5980;font-weight:800;font-size:.88rem;border-radius:8px;padding:10px 16px;cursor:pointer;min-height:44px}
  .ppud-btn-salva[disabled]{opacity:.5;cursor:default}
  .ppud-ril-nota-valida{font-size:.82rem;color:#5a6a60;margin:14px 0 8px}
  .ppud-btn-valida{background:#3a6b47;border:none;color:#fff;font-weight:800;font-size:.88rem;border-radius:8px;padding:10px 16px;cursor:pointer;min-height:44px}
  .ppud-btn-valida[disabled]{opacity:.5;cursor:default}
  .ppud-ril-status{margin-top:10px;font-size:.86rem;color:#5a5648}
  .ppud-ril-status.ok{color:#3a6b47}
  .ppud-ril-status.err{color:#8a3a3a;background:#f7ecec;border:1px solid #e6cfcf;border-radius:8px;padding:8px 12px}
  .ppud-ril-conferma{margin-top:12px;background:#fbf7ef;border:1px solid #e6dcc4;border-radius:8px;padding:12px 14px}
  .ppud-ril-conferma p{margin:0 0 10px;font-size:.88rem;color:#5b5030}
  .ppud-ril-conferma-btn{display:flex;gap:8px;flex-wrap:wrap}
  .ppud-btn-ghost{background:#fff;border:1.5px solid #cfc9bd;color:#5a5648;font-weight:700;font-size:.86rem;border-radius:8px;padding:9px 14px;cursor:pointer;min-height:40px}
  .ppud-btn-valida-def{background:#3a6b47;border:none;color:#fff;font-weight:800;font-size:.86rem;border-radius:8px;padding:9px 14px;cursor:pointer;min-height:40px}
  .ppud-intro{font-size:.86rem;color:#6a655a;padding:0 2px 12px}
  .ppud-mom{border:1px solid #e4e0d6;border-radius:12px;padding:14px;margin-bottom:14px;background:#fff}
  .ppud-mom-tit{font-weight:800;font-size:1rem;letter-spacing:.04em;color:#23303a;margin-bottom:8px}
  .ppud-fonti-stato{display:grid;gap:3px;font-size:.88rem;margin-bottom:10px}
  .ppud-fonti-stato>div{display:flex;justify-content:space-between;gap:12px;max-width:340px}
  .ppud-fonti-stato .ok{color:#3a6b47;font-weight:700}
  .ppud-fonti-stato .ko{color:#9a7b4a;font-weight:700}
  .ppud-nongen{font-size:.88rem;color:#6a655a;background:#f5f2ec;border-radius:8px;padding:10px 12px;line-height:1.5}
  .ppud-dagen{font-size:.9rem;color:#444}
  .ppud-novita{font-size:.86rem;color:#7a6a45;background:#f3ede0;border-radius:8px;padding:8px 12px;margin-bottom:8px}
  .ppud-vers{display:grid;gap:6px}
  .ppud-vers-row{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #e4e0d6;border-radius:8px;padding:9px 12px;cursor:pointer;background:#fcfbf8;min-height:44px}
  .ppud-vers-row:hover{background:#f4f2ec}
  .ppud-btn-gen{margin-top:8px;background:#3b6ea5;color:#fff;border:none;font-weight:800;font-size:.88rem;border-radius:8px;padding:10px 16px;cursor:pointer;min-height:44px}
  .ppud-btn-gen[disabled]{opacity:.6;cursor:default}
  .ppud-gen-status{font-size:.86rem;color:#5a5648;margin-top:8px}
  .ppud-err{font-size:.86rem;color:#8a3a3a;background:#f7ecec;border:1px solid #e6cfcf;border-radius:8px;padding:8px 12px;margin-top:8px}
  @media(max-width:560px){.ppud-k{min-width:110px}.ppud-doc{font-size:.98rem}}
  `;
  document.head.appendChild(s);
}

// ── Persistenza client (sola lettura: la D non si crea/aggiorna qui) ────
async function elencaSchedeD(db, { minorId, comunitaId }) {
  // Query a due sole uguaglianze, ordinamento in memoria (vedi report Passo 4,
  // sezione H): non richiede un indice composito dedicato.
  const snap = await getDocs(query(
    collection(db, 'ppu_schede_d'),
    where('minorId', '==', minorId),
    where('comunitaId', '==', comunitaId),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function caricaSchedaD(db, id) {
  const snap = await getDoc(doc(db, 'ppu_schede_d', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

// ══════════════════════════════════════════════════════════════════════
//  SCHERMATA: momenti PPU del ragazzo
// ══════════════════════════════════════════════════════════════════════
export async function montaElenco(main, ctx) {
  const { db, ragazzo, community, canWrite, go } = ctx;
  iniettaStile();
  main.innerHTML = '<div class="spinner"></div>';

  let listA, listB, listC, listD;
  try {
    [listA, listB, listC, listD] = await Promise.all([
      elencaSchedeA(db, { minorId: ragazzo.id, comunitaId: community.id }),
      elencaSchedeB(db, { minorId: ragazzo.id, comunitaId: community.id }),
      elencaSchedeC(db, { minorId: ragazzo.id, comunitaId: community.id }),
      elencaSchedeD(db, { minorId: ragazzo.id, comunitaId: community.id }),
    ]);
  } catch (e) {
    main.innerHTML = `<p class="empty-msg">Non è stato possibile caricare i dati: ${escHtml(e.message)}</p>`;
    return;
  }

  const gruppi = raggruppaFontiPerMomento(listA, listB, listC);
  const righe = elencaMomenti(gruppi, listD);

  main.innerHTML = `
    <div class="folder-header">
      <div>
        <div class="folder-title">SINTESI EDUCATIVA INTEGRATA</div>
        <div style="font-size:0.72rem;color:#999;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-top:1px;">Scheda D — PPU</div>
      </div>
    </div>
    <p class="ppud-intro">Una sintesi generata dall'AI attraverso l'incrocio delle Schede A, B e C, destinata alla rilettura dell'équipe educativa. Non è una valutazione, una diagnosi, un profilo psicologico, un test o un punteggio.</p>
    <div id="ppud-momenti"></div>`;

  const cont = document.getElementById('ppud-momenti');
  if (!righe.length) {
    cont.innerHTML = `<p class="empty-msg">📭 Nessun momento PPU con schede compilate per ${escHtml(ragazzo.nome || 'il ragazzo/a')}.</p>`;
    return;
  }
  for (const r of righe) cont.appendChild(renderRiga(r, ctx));

  function renderRiga(r) {
    const NOMI = {
      A: 'Scheda A — Come mi vedo',
      B: 'Scheda B — Come penso che mi vedano gli altri',
      C: 'Scheda C — Le persone intorno a me',
    };
    const linee = ['A', 'B', 'C'].map(k => {
      const ok = r.fonti[k] === 'completata';
      return `<div><span>${escHtml(NOMI[k])}</span><span class="${ok ? 'ok' : 'ko'}">${ok ? '✓ completata' : '— mancante'}</span></div>`;
    }).join('');

    let coda = '';
    if (r.stato === 'NON_GENERABILE') {
      coda = `<div class="ppud-nongen">${escHtml(descriviMancanti(r.gruppo))}</div>`;
    } else if (!r.schedeD.length) {
      coda = '<div class="ppud-dagen">Sintesi educativa: <strong>DA GENERARE</strong></div>'
        + (canWrite ? '<button class="ppud-btn-gen" data-gen="1">Genera sintesi educativa</button><div class="ppud-gen-status" hidden></div>' : '');
    } else {
      if (r.novita.haNovita && canWrite) {
        coda += `<div class="ppud-novita">Sono disponibili dati più recenti per questo momento (${r.novita.piuRecenti.map(x => 'Scheda ' + x).join(', ')}).</div>`
          + '<button class="ppud-btn-gen" data-gen="1">Genera nuova versione</button><div class="ppud-gen-status" hidden></div>';
      }
      coda += '<div class="ppud-vers">' + r.schedeD.map(d =>
        `<div class="ppud-vers-row" data-open="${escHtml(d.id)}">`
        + `<span>D — ${escHtml(formatDataD(d.generatedAt))}</span>`
        + `<span class="ppud-stato" data-stato="${escHtml(d.stato || '')}">${escHtml(ETICHETTE_STATO_D[d.stato] || d.stato || '—')}</span>`
        + '</div>').join('') + '</div>';
    }

    const el = document.createElement('div');
    el.className = 'ppud-mom';
    el.innerHTML = `<div class="ppud-mom-tit">${escHtml(String(r.label || '').toUpperCase())}</div>`
      + `<div class="ppud-fonti-stato">${linee}</div>${coda}`;

    el.querySelectorAll('.ppud-vers-row').forEach(row => {
      row.addEventListener('click', () => go(r.label, () => montaVista(main, { ...ctx, schedaDId: row.dataset.open })));
    });
    const btn = el.querySelector('[data-gen]');
    if (btn) btn.addEventListener('click', () => genera(r, btn, el.querySelector('.ppud-gen-status')));
    return el;
  }

  async function genera(r, btn, statusEl) {
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = 'Generazione in corso…';
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.className = 'ppud-gen-status';
      statusEl.textContent = 'Sto elaborando le informazioni delle Schede A, B e C…';
    }
    try {
      const fns = getFunctions(getApp(), FUNCTIONS_REGION);
      // Il timeout di default del Web SDK è 70 s; la generazione (fino a 2
      // chiamate al modello) supera regolarmente i 2 minuti. 330 s tiene il
      // client appena sopra il `timeoutSeconds: 300` della Function, così è il
      // server a governare la scadenza e il client riceve la sua risposta
      // strutturata invece di abortire prima.
      const call = httpsCallable(
        fns,
        'generaSchedaDPPU',
        { timeout: 330000 }
      );
      const res = await call({
        minorId: ragazzo.id,
        comunitaId: community.id,
        ppuMoment: r.ppuMoment,
        ppuMomentNote: r.ppuMomentNote || '',
      });
      const id = res && res.data && res.data.schedaDId;
      if (!id) throw new Error('risposta priva di id');
      go(r.label, () => montaVista(main, { ...ctx, schedaDId: id }));
    } catch (err) {
      btn.disabled = false;
      btn.textContent = orig;
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.className = 'ppud-err';
        statusEl.textContent = messaggioErroreGenerazione(err);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════
//  SCHERMATA: documento Scheda D
// ══════════════════════════════════════════════════════════════════════
async function montaVista(main, ctx) {
  const { db, ragazzo, community, schedaDId, canWrite } = ctx;
  iniettaStile();
  main.innerHTML = '<div class="spinner"></div>';

  let d;
  try {
    d = await caricaSchedaD(db, schedaDId);
  } catch (e) {
    main.innerHTML = `<p class="empty-msg">Non è stato possibile aprire la scheda: ${escHtml(e.message)}</p>`;
    return;
  }
  if (!d) {
    main.innerHTML = '<p class="empty-msg">La scheda richiesta non è più disponibile.</p>';
    return;
  }

  const modificabile = !!canWrite && d.stato !== 'VALIDATA';
  let validataInfo = null;
  if (d.stato === 'VALIDATA') {
    validataInfo = { data: formatDataD(d.validatedAt), nome: await nomeOperatore(db, d.validatedBy) };
  }

  main.innerHTML = renderVistaHTML(d, {
    nomeRagazzo: (ragazzo && ragazzo.nome) || '',            // nome SEMPRE locale, mai dall'AI
    comunitaLabel: (community && (community.label || community.id)) || '',
    modificabile,
    validataInfo,
  });

  wireFonti(main, d, db);
  if (modificabile) wireRilettura(main, d, ctx);
}

async function nomeOperatore(db, uid) {
  if (!uid) return '';
  try {
    const s = await getDoc(doc(db, 'staff', uid));
    if (s.exists() && s.data() && s.data().nome) return s.data().nome;
  } catch (_) { /* fallback neutro nel template */ }
  return '';
}

// ── RILETTURA / VALIDAZIONE (Passo 5) ─────────────────────────────────
// Scrive SOLO `rilettura` / `stato` / `updatedAt` (e `validated*` alla
// validazione). Mai `contenutoAI` / `fonti` / `source*Id`. Ogni scrittura
// passa da una transazione che rilegge il documento: se nel frattempo è
// diventato VALIDATA, non forza l'update e ricarica.
function wireRilettura(main, d, ctx) {
  const { db, currentUid } = ctx;
  const sez = main.querySelector('.ppud-rilettura');
  if (!sez) return;

  const statusEl = sez.querySelector('[data-ril-status]');
  const btnSalva = sez.querySelector('[data-ril-salva]');
  const btnValida = sez.querySelector('[data-ril-valida]');
  const conferma = sez.querySelector('[data-ril-conferma]');
  const ref = doc(db, 'ppu_schede_d', d.id);
  let dirty = false;

  if (btnSalva) btnSalva.disabled = true;
  const segnaDirty = () => { dirty = true; if (btnSalva) btnSalva.disabled = false; };
  sez.addEventListener('input', segnaDirty);
  sez.addEventListener('change', segnaDirty);

  function setStatus(msg, kind) {
    if (!statusEl) return;
    statusEl.hidden = !msg;
    statusEl.textContent = msg || '';
    statusEl.className = 'ppud-ril-status' + (kind ? ' ' + kind : '');
  }

  function raccogliValori() {
    const valori = {};
    sez.querySelectorAll('.ppud-ril-el').forEach(elDiv => {
      const chiave = elDiv.dataset.rilChiave;
      const checked = elDiv.querySelector('input[type=radio]:checked');
      const ta = elDiv.querySelector('textarea[data-ril-obs]');
      valori[chiave] = { valutazione: checked ? checked.value : null, osservazioni: ta ? ta.value : '' };
    });
    const og = sez.querySelector('textarea[data-ril-og]');
    return { valori, osservazioniGenerali: og ? og.value : '' };
  }

  function errApp(kind, extra) { const e = new Error(kind); e.appKind = kind; e.extra = extra; return e; }

  async function scrivi({ valida }) {
    const { valori, osservazioniGenerali } = raccogliValori();
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw errApp('assente');
      const cur = snap.data() || {};
      if (cur.stato === 'VALIDATA') throw errApp('gia_validata');

      const ril = costruisciRiletturaDaValori({
        valori, osservazioniGenerali,
        riletturaByEsistente: (cur.rilettura && cur.rilettura.riletturaBy) || [],
        uid: currentUid,
      }, d.contenutoAI);
      const errs = validaRiletturaEquipe(ril, d.contenutoAI);
      if (errs.length) throw errApp('rilettura_non_valida', errs);

      const significativa = riletturaSignificativa(ril);
      const patch = { updatedAt: serverTimestamp() };
      const rilConTs = { ...ril, riletturaAt: serverTimestamp() };

      if (valida) {
        patch.stato = 'VALIDATA';
        patch.validatedBy = currentUid;
        patch.validatedAt = serverTimestamp();
        if (significativa || cur.rilettura != null) patch.rilettura = rilConTs;
      } else {
        if (significativa || cur.rilettura != null) patch.rilettura = rilConTs;
        if (cur.stato === 'GENERATA' && significativa) patch.stato = 'IN_RILETTURA';
      }
      tx.update(ref, patch);
    });
  }

  function gestisciErrore(e) {
    if (btnSalva) btnSalva.disabled = !dirty;
    if (btnValida) btnValida.disabled = false;
    if (conferma) conferma.hidden = true;
    if (e && e.appKind === 'gia_validata') {
      setStatus('La Scheda D è stata validata e non è più modificabile.', 'err');
      setTimeout(() => montaVista(main, ctx), 1600);
      return;
    }
    if (e && e.appKind === 'assente') { setStatus('La Scheda D non è più disponibile.', 'err'); return; }
    if (e && e.appKind === 'rilettura_non_valida') {
      setStatus('La rilettura contiene elementi non validi e non è stata salvata: ' + (e.extra || []).slice(0, 2).join(' '), 'err');
      return;
    }
    const code = String((e && e.code) || '').replace(/^functions\//, '');
    if (code === 'permission-denied') { setStatus('Non hai i permessi per modificare questa scheda.', 'err'); return; }
    setStatus('Non è stato possibile completare l’operazione. Riprova.', 'err');
  }

  if (btnSalva) btnSalva.addEventListener('click', async () => {
    btnSalva.disabled = true;
    setStatus('Salvataggio…');
    try {
      await scrivi({ valida: false });
      dirty = false;
      setStatus('Rilettura salvata.', 'ok');
      setTimeout(() => montaVista(main, ctx), 700);
    } catch (e) { gestisciErrore(e); }
  });

  if (btnValida) btnValida.addEventListener('click', () => {
    if (conferma) conferma.hidden = false;
    btnValida.disabled = true;
    setStatus('');
  });
  sez.querySelector('[data-ril-annulla]')?.addEventListener('click', () => {
    if (conferma) conferma.hidden = true;
    if (btnValida) btnValida.disabled = false;
  });
  sez.querySelector('[data-ril-valida-def]')?.addEventListener('click', async () => {
    setStatus('Validazione…');
    try {
      await scrivi({ valida: true });
      setTimeout(() => montaVista(main, ctx), 500);
    } catch (e) { gestisciErrore(e); }
  });
}

// "Mostra elementi di origine": al click carica UNA SOLA VOLTA i documenti
// A/B/C CONGELATI (sourceAId/BId/CId salvati nella D — non la versione più
// recente) e ricostruisce le fonti citate. Nessuna chiamata AI.
function wireFonti(main, d, db) {
  let fontiCache = null;

  async function caricaFontiCongelate() {
    if (fontiCache) return fontiCache;
    const map = {
      A: { coll: 'ppu_schede_a', id: d.sourceAId },
      B: { coll: 'ppu_schede_b', id: d.sourceBId },
      C: { coll: 'ppu_schede_c', id: d.sourceCId },
    };
    const out = { A: null, B: null, C: null };
    await Promise.all(Object.entries(map).map(async ([k, { coll, id }]) => {
      if (!id) return;
      try {
        const s = await getDoc(doc(db, coll, id));
        if (s.exists()) out[k] = { id: s.id, ...s.data() };
      } catch (_) { /* fonte non leggibile → resterà null → messaggio leggibile */ }
    }));
    fontiCache = out;
    return out;
  }

  function fontiDelBottone(chiave) {
    const c = d.contenutoAI || {};
    const [tipo, idxS] = String(chiave).split(':');
    const idx = parseInt(idxS, 10);
    if (tipo === 'pilastro') return (c.pilastri && c.pilastri[idx] && c.pilastri[idx].fonti) || [];
    if (tipo === 'chiave') return (c.chiaviPsicoPedagogiche && c.chiaviPsicoPedagogiche[idx] && c.chiaviPsicoPedagogiche[idx].fonti) || [];
    const lt = c.letturaTrasversale || {};
    return (lt[tipo] && lt[tipo][idx] && lt[tipo][idx].fonti) || [];
  }

  main.querySelectorAll('.ppud-fonti-btn').forEach(btn => {
    const chiave = btn.dataset.ppudFonti;
    const pan = main.querySelector(`[data-ppud-fonti-pan="${chiave}"]`);
    if (!pan) return;
    btn.addEventListener('click', async () => {
      // Vero toggle bidirezionale: lo stato dipende solo da aria-expanded.
      // In chiusura basta `pan.hidden = true` (la regola .ppud-fonti-pan[hidden]
      // ora vince su display:grid). In riapertura, se i dati sono già in
      // memoria (dataset.caricato) non si rilegge nulla.
      const s = prossimoStatoToggleFonti({
        apertoOra: btn.getAttribute('aria-expanded') === 'true',
        giaCaricato: pan.dataset.caricato === '1',
      });
      btn.setAttribute('aria-expanded', s.ariaExpanded);
      btn.textContent = s.etichetta;
      pan.hidden = s.hidden;
      if (!s.deveCaricare) return;

      pan.innerHTML = '<div class="ppud-fonte">Caricamento…</div>';
      const src = await caricaFontiCongelate();
      const ctxRic = {
        schedaA: src.A, schedaB: src.B, schedaC: src.C,
        domandaA: LOOKUP.domandaA, opzioniA: LOOKUP.opzioniA,
        domandaB: LOOKUP.domandaB, opzioniB: LOOKUP.opzioniB,
        chiusuraA: LOOKUP.chiusuraA,
      };
      const ric = (fontiDelBottone(chiave) || []).map(f => ricostruisciFonte(f, ctxRic));
      pan.innerHTML = renderFontiPannelloHTML(ric);
      pan.dataset.caricato = '1';
    });
  });
}
