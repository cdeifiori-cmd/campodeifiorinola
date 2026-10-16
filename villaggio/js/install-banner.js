/**
 * install-banner.js
 * Banner di installazione PWA per Android (beforeinstallprompt)
 * e iOS (istruzioni manuali).
 * Non viene mostrato se l'utente lo ha già chiuso o se l'app è già installata.
 */

const STORAGE_KEY = 'pwa_install_dismissed';
const CSS_ID      = 'install-banner-css';
const BANNER_ID   = 'install-banner';

// ── Rilevamento piattaforma ───────────────────────────────────────────────
function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

// ── CSS ───────────────────────────────────────────────────────────────────
function injectCss() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement('style');
  style.id = CSS_ID;
  style.textContent = `
    #install-banner {
      position: fixed;
      bottom: 70px;          /* sopra la bottom nav (62px) */
      left: 12px; right: 12px;
      max-width: 600px;
      margin: 0 auto;
      background: #1a3a26;
      color: #fff;
      border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.35);
      padding: 14px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 9999;
      font-family: 'Nunito', sans-serif;
      font-size: 0.9rem;
      animation: banner-slide-up 0.3s ease;
    }
    @keyframes banner-slide-up {
      from { opacity: 0; transform: translateY(20px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    #install-banner .ib-icon {
      font-size: 1.6rem;
      flex-shrink: 0;
    }
    #install-banner .ib-text {
      flex: 1;
      line-height: 1.4;
      font-weight: 600;
    }
    #install-banner .ib-text strong {
      display: block;
      font-size: 0.92rem;
      font-weight: 800;
      margin-bottom: 2px;
    }
    #install-banner .ib-text .ib-sub {
      font-size: 0.78rem;
      opacity: 0.82;
    }
    #install-banner .ib-install {
      background: #52b788;
      color: #fff;
      border: none;
      border-radius: 20px;
      padding: 7px 16px;
      font-family: 'Nunito', sans-serif;
      font-size: 0.85rem;
      font-weight: 800;
      cursor: pointer;
      flex-shrink: 0;
      white-space: nowrap;
      transition: background 0.15s;
    }
    #install-banner .ib-install:hover { background: #3a9a6e; }
    #install-banner .ib-close {
      background: rgba(255,255,255,0.15);
      color: #fff;
      border: none;
      border-radius: 50%;
      width: 28px; height: 28px;
      font-size: 0.85rem;
      cursor: pointer;
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.15s;
    }
    #install-banner .ib-close:hover { background: rgba(255,255,255,0.28); }

    /* Freccia iOS che punta verso il basso (verso la share bar) */
    #install-banner.ios-hint::after {
      content: '';
      position: absolute;
      bottom: -8px;
      left: 50%;
      transform: translateX(-50%);
      border-left: 8px solid transparent;
      border-right: 8px solid transparent;
      border-top: 8px solid #1a3a26;
    }
  `;
  document.head.appendChild(style);
}

// ── Crea il banner ────────────────────────────────────────────────────────
function createBanner({ label, sub, btnLabel, onInstall, isIosBanner }) {
  removeBanner();
  injectCss();

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  if (isIosBanner) banner.classList.add('ios-hint');

  banner.innerHTML = `
    <span class="ib-icon">📲</span>
    <div class="ib-text">
      <strong>${label}</strong>
      <span class="ib-sub">${sub}</span>
    </div>
    ${onInstall ? `<button class="ib-install">${btnLabel}</button>` : ''}
    <button class="ib-close" aria-label="Chiudi">✕</button>`;

  document.body.appendChild(banner);

  if (onInstall) {
    banner.querySelector('.ib-install').addEventListener('click', () => {
      onInstall();
      dismiss();
    });
  }

  banner.querySelector('.ib-close').addEventListener('click', dismiss);
}

function removeBanner() {
  document.getElementById(BANNER_ID)?.remove();
}

function dismiss() {
  localStorage.setItem(STORAGE_KEY, '1');
  removeBanner();
}

// ── Entry point ───────────────────────────────────────────────────────────
export function setupInstallBanner() {
  // Non mostrare se già dismesso o già installato
  if (localStorage.getItem(STORAGE_KEY)) return;
  if (isInStandaloneMode()) return;

  // ── Android / Chrome: usa beforeinstallprompt ──────────────────────────
  let deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;

    // Mostra il banner dopo un breve ritardo (UI ha finito di caricare)
    setTimeout(() => {
      if (localStorage.getItem(STORAGE_KEY)) return;
      if (isInStandaloneMode()) return;

      createBanner({
        label:    'Installa Campo dei Fiori',
        sub:      'Accedi più velocemente dalla schermata Home!',
        btnLabel: 'Installa',
        onInstall: async () => {
          if (!deferredPrompt) return;
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          deferredPrompt = null;
          if (outcome === 'accepted') dismiss();
        },
      });
    }, 1500);
  });

  // ── iOS Safari ────────────────────────────────────────────────────────
  if (isIos() && !isInStandaloneMode()) {
    setTimeout(() => {
      if (localStorage.getItem(STORAGE_KEY)) return;
      createBanner({
        label:      'Installa Campo dei Fiori',
        sub:        "Tocca 'Condividi' (⬆️) poi 'Aggiungi a schermata Home'",
        btnLabel:   null,
        onInstall:  null,
        isIosBanner: true,
      });
    }, 1500);
  }

  // Nasconde il banner se l'app viene installata in seguito
  window.addEventListener('appinstalled', () => {
    dismiss();
  });
}
