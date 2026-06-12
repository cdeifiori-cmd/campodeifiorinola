/**
 * Lightbox condiviso — un solo modulo per tutta la PWA.
 * Usa event delegation: basta chiamare initLightbox() una volta per pagina.
 * Funziona su contenuto aggiunto dinamicamente (nessuna chiamata attachTo necessaria).
 */

// ── Selettori da SALTARE (avatar, icone nav, card-link, ecc.) ────────────────
const SKIP_SEL = [
  'nav', '.bottom-nav', '.top-nav-desktop', '.top-header',
  '.index-nav', '.nav-item',
  '.post-avatar', '.comment-avatar', '.bott-avatar',
  '.card-autore', '.brand',
  // Card utente: il click deve navigare alla pagina profilo, non aprire il lightbox
  '.card-staff', '.card-minore', '.card-ragazzo', '.card-comunita', '.card-amico',
  '.evento-avatar',
  '[data-no-lb]',
].join(',');

// Contenitori che definiscono un "gruppo" di navigazione (solo post/media)
const GROUP_SEL = '.post-card,.card-post,.card-bottiglia,.media-grid,.mgitem';

// ── Stato ────────────────────────────────────────────────────────────────────
let lb     = null;
let lbImg  = null;
let gallery = [];  // array di { src, alt }
let gIdx   = 0;
let touchX0 = 0;
let initialized = false;

// ── Crea il DOM del lightbox (una sola volta) ─────────────────────────────────
function createLB() {
  if (lb) return;

  // CSS iniettato nel documento
  const style = document.createElement('style');
  style.textContent = `
    #lb-overlay {
      display: none; position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,0.88);
      align-items: center; justify-content: center;
      animation: lb-fade-in 0.18s ease;
    }
    #lb-overlay.open { display: flex; }
    @keyframes lb-fade-in { from { opacity:0 } to { opacity:1 } }

    #lb-img-wrap {
      position: relative; max-width: 92vw; max-height: 90vh;
      display: flex; align-items: center; justify-content: center;
    }
    #lb-img-wrap img {
      max-width: 92vw; max-height: 90vh;
      object-fit: contain; border-radius: 6px;
      cursor: default !important;
      box-shadow: 0 8px 40px rgba(0,0,0,0.6);
      display: block;
    }
    #lb-close {
      position: fixed; top: 14px; right: 16px;
      background: rgba(255,255,255,0.14); border: none; color: #fff;
      font-size: 1.3rem; width: 40px; height: 40px; border-radius: 50%;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: background 0.15s; z-index: 10001;
    }
    #lb-close:hover { background: rgba(255,255,255,0.28); }

    .lb-arrow {
      position: fixed; top: 50%; transform: translateY(-50%);
      background: rgba(255,255,255,0.14); border: none; color: #fff;
      font-size: 2rem; width: 52px; height: 52px; border-radius: 50%;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: background 0.15s; z-index: 10001; line-height: 1;
      user-select: none; -webkit-user-select: none;
    }
    .lb-arrow:hover { background: rgba(255,255,255,0.28); }
    #lb-prev { left: 14px; }
    #lb-next { right: 14px; }

    #lb-counter {
      position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
      color: rgba(255,255,255,0.65); font-size: 0.85rem; font-weight: 700;
      font-family: 'Nunito', sans-serif; z-index: 10001; pointer-events: none;
    }

    /* Cursor zoom-in sulle foto di contenuto (non sulle card-link profilo) */
    .post-card .mgitem img,
    .post-card .media-grid img,
    .card-post .post-img,
    .card-bottiglia .bott-media,
    .card-bottiglia img:not(.bott-avatar img) {
      cursor: zoom-in;
    }
  `;
  document.head.appendChild(style);

  lb = document.createElement('div');
  lb.id = 'lb-overlay';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', 'Immagine ingrandita');
  lb.innerHTML = `
    <div id="lb-img-wrap"><img id="lb-main-img" src="" alt=""></div>
    <button id="lb-close" aria-label="Chiudi">✕</button>
    <button class="lb-arrow" id="lb-prev" aria-label="Precedente">&#8249;</button>
    <button class="lb-arrow" id="lb-next" aria-label="Successiva">&#8250;</button>
    <div id="lb-counter"></div>
  `;
  document.body.appendChild(lb);
  lbImg = lb.querySelector('#lb-main-img');

  // Chiudi cliccando lo sfondo (non l'immagine)
  lb.addEventListener('click', e => {
    if (e.target === lb) closeLB();
  });
  lb.querySelector('#lb-close').addEventListener('click', e => { e.stopPropagation(); closeLB(); });
  lb.querySelector('#lb-prev').addEventListener('click', e => { e.stopPropagation(); prevImg(); });
  lb.querySelector('#lb-next').addEventListener('click', e => { e.stopPropagation(); nextImg(); });

  // Tastiera
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key === 'Escape')      closeLB();
    if (e.key === 'ArrowLeft')   prevImg();
    if (e.key === 'ArrowRight')  nextImg();
  });

  // Touch swipe
  lb.addEventListener('touchstart', e => {
    touchX0 = e.touches[0].clientX;
  }, { passive: true });
  lb.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchX0;
    if (Math.abs(dx) > 45) dx < 0 ? nextImg() : prevImg();
  });
}

// ── Determina se un'immagine va saltata ───────────────────────────────────────
function shouldSkip(img) {
  if (!img || !img.src || img.src === window.location.href) return true;
  if (img.hasAttribute('data-no-lb')) return true;
  if (img.closest(SKIP_SEL)) return true;
  // Salta icone molto piccole (es. emoji-avatar inline)
  if (img.width > 0 && img.width < 40 && img.height > 0 && img.height < 40) return true;
  return false;
}

// ── Raccoglie tutte le immagini del gruppo ────────────────────────────────────
function buildGallery(clicked) {
  // Cerca il contenitore più stretto adatto
  const container = clicked.closest(GROUP_SEL) || document.body;
  const all = [...container.querySelectorAll('img')].filter(i => !shouldSkip(i));
  if (!all.includes(clicked)) all.push(clicked); // assicurati che ci sia
  return all;
}

// ── Apri / chiudi / naviga ────────────────────────────────────────────────────
function openLB(imgs, startIdx) {
  createLB();
  gallery = imgs.map(i => ({ src: i.src, alt: i.alt || '' }));
  gIdx    = Math.max(0, Math.min(startIdx, gallery.length - 1));
  renderImg();
  lb.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLB() {
  if (!lb) return;
  lb.classList.remove('open');
  document.body.style.overflow = '';
}

function renderImg() {
  lbImg.src = gallery[gIdx].src;
  lbImg.alt = gallery[gIdx].alt;
  const n = gallery.length;
  lb.querySelector('#lb-prev').style.display = n > 1 ? '' : 'none';
  lb.querySelector('#lb-next').style.display = n > 1 ? '' : 'none';
  lb.querySelector('#lb-counter').textContent = n > 1 ? `${gIdx + 1} / ${n}` : '';
}

function prevImg() { gIdx = (gIdx - 1 + gallery.length) % gallery.length; renderImg(); }
function nextImg() { gIdx = (gIdx + 1) % gallery.length; renderImg(); }

// ── API pubblica ──────────────────────────────────────────────────────────────

/**
 * Inizializza il lightbox per la pagina corrente.
 * Usa event delegation: funziona automaticamente su contenuto aggiunto dopo la chiamata.
 * Chiamare UNA SOLA VOLTA per pagina.
 */
export function initLightbox() {
  if (initialized) return;
  initialized = true;
  createLB();

  document.body.addEventListener('click', e => {
    // Ignora click dentro il lightbox stesso
    if (lb && lb.contains(e.target)) return;

    const img = e.target.tagName === 'IMG' ? e.target : e.target.closest('img');
    if (!img || shouldSkip(img)) return;

    e.preventDefault();
    e.stopPropagation();

    const grp   = buildGallery(img);
    const start = grp.indexOf(img);
    openLB(grp, start >= 0 ? start : 0);
  }, true); // useCapture=true per intercettare prima dei link <a>
}
