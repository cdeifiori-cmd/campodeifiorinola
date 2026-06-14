/**
 * notifiche.js — Gestione token FCM per Campo dei Fiori
 *
 * Viene chiamato da nav-auth.js ad ogni login utente.
 * Assicura che:
 *  1. Il service worker FCM sia quello attivo (non un vecchio SW di caching)
 *  2. Il token FCM venga ottenuto e salvato su Firestore ad ogni sessione
 *  3. Se il token è cambiato rispetto a quello salvato, venga aggiornato
 *  4. I log in console permettano di diagnosticare ogni passo
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import { getFirestore, doc, updateDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const VAPID_KEY = 'BIUkTONw1oYZnDjfYX26iLF77yrX10mbHVEtBFwrXRldPzeRD1hFk-3KzC4hc9j9Ne0Zi8BCrUro-J2Hw2xREgU';
const SW_URL    = '/firebase-messaging-sw.js';

const firebaseConfig = {
  apiKey:            "AIzaSyC18lzwqhYcW29TsEO6Oy4Bqvb2PMBUmAg",
  authDomain:        "campo-dei-fiori.firebaseapp.com",
  projectId:         "campo-dei-fiori",
  storageBucket:     "campo-dei-fiori.firebasestorage.app",
  messagingSenderId: "928976798756",
  appId:             "1:928976798756:web:1b90027ec9f03b203e44b1"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getFirestore(app);

/**
 * Assicura che firebase-messaging-sw.js sia il SW attivo.
 * Se è in stato "waiting" (c'era un vecchio SW), forza l'aggiornamento.
 */
async function getFcmServiceWorker() {
  // Registra (o recupera) il SW FCM
  let reg = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  console.log('[FCM] SW stato:', reg.active?.scriptURL?.split('/').pop(),
              '| installing:', !!reg.installing,
              '| waiting:', !!reg.waiting);

  // Se c'è un SW in attesa (nuovo SW installato ma non ancora attivo),
  // invia skipWaiting e aspetta che diventi attivo
  if (reg.waiting) {
    console.log('[FCM] SW in waiting → forzo attivazione');
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    // Aspetta l'evento controllerchange (il nuovo SW prende il controllo)
    await new Promise(resolve => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      // Timeout di sicurezza: 3 secondi
      setTimeout(resolve, 3000);
    });
    // Rileggi la registration aggiornata
    reg = await navigator.serviceWorker.getRegistration(SW_URL) || reg;
  }

  // Aspetta che il SW sia attivo
  const swReg = await navigator.serviceWorker.ready;
  console.log('[FCM] SW attivo:', swReg.active?.scriptURL?.split('/').pop() || 'sconosciuto');
  return swReg;
}

function showWelcomeToast(title, body, url) {
  const existing = document.getElementById('welcome-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'welcome-toast';
  toast.innerHTML = `<div style="font-size:1.6rem;margin-bottom:6px">🎉🌸🎊</div>
    <div style="font-weight:800;font-size:1rem;margin-bottom:4px">${title}</div>
    <div style="font-size:0.88rem;opacity:0.9">${body}</div>`;
  Object.assign(toast.style, {
    position:     'fixed',
    bottom:       '80px',
    left:         '50%',
    transform:    'translateX(-50%)',
    background:   'linear-gradient(135deg,#e07b39,#f0a060)',
    color:        '#fff',
    padding:      '16px 24px',
    borderRadius: '16px',
    boxShadow:    '0 8px 32px rgba(0,0,0,0.22)',
    zIndex:       '99999',
    textAlign:    'center',
    maxWidth:     '88vw',
    animation:    'toast-in 0.35s ease',
    cursor:       url ? 'pointer' : 'default'
  });

  if (!document.getElementById('welcome-toast-css')) {
    const s = document.createElement('style');
    s.id = 'welcome-toast-css';
    s.textContent = '@keyframes toast-in{from{opacity:0;transform:translateX(-50%) translateY(30px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(s);
  }

  if (url) toast.addEventListener('click', () => { location.href = url; });
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.transition = 'opacity 0.5s'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, 6000);
}

export async function setupNotifiche(user) {
  if (!user) return;
  // Azzera badge con tutti i metodi disponibili (compatibilità Android/Samsung)
  if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  if (navigator.setAppBadge)   navigator.setAppBadge(0).catch(() => {});

  // FCM richiede Notification API e Service Worker
  if (!('Notification' in window)) {
    console.log('[FCM] Notification API non supportata');
    return;
  }
  if (!('serviceWorker' in navigator)) {
    console.log('[FCM] Service Worker non supportato');
    return;
  }

  // Su iOS funziona solo se installata come PWA standalone
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
                    || window.navigator.standalone === true;
  if (isIOS && !isStandalone) {
    console.log('[FCM] iOS: funziona solo da PWA installata');
    return;
  }

  try {
    // Chiedi permesso notifiche se non ancora dato
    let permission = Notification.permission;
    console.log('[FCM] Permesso attuale:', permission);

    if (permission === 'default') {
      permission = await Notification.requestPermission();
      console.log('[FCM] Permesso dopo richiesta:', permission);
    }
    if (permission !== 'granted') {
      console.log('[FCM] Permesso non concesso — skip');
      return;
    }

    // Ottieni il SW FCM attivo (con forza aggiornamento se necessario)
    const swReg = await getFcmServiceWorker();

    // Ottieni il token FCM
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg
    });

    if (!token) {
      console.warn('[FCM] getToken() ha restituito null — SW non è FCM-ready?');
      return;
    }
    console.log('[FCM] Token ottenuto:', token.slice(0, 20) + '…');

    // Salva il token su Firestore (array per supportare più dispositivi)
    // Cerca in utenti → staff → amici
    let saved = false;
    for (const coll of ['utenti', 'staff', 'amici']) {
      try {
        const snap = await getDoc(doc(db, coll, user.uid));
        if (!snap.exists()) continue;

        const data = snap.data();

        // Migrazione: se esiste il vecchio campo stringa, convertilo in array
        const existing = data.fcmTokens
          ? [...data.fcmTokens]
          : data.fcmToken ? [data.fcmToken] : [];

        // Sempre aggiorna: nuovo token in cima, deduplicato, max 5
        const filtered = existing.filter(t => t !== token); // rimuovi eventuale duplicato
        const updated  = [token, ...filtered].slice(0, 5);
        await updateDoc(doc(db, coll, user.uid), {
          fcmTokens: updated,  // array aggiornato ad ogni sessione
          fcmToken:  token     // backward compat
        });
        console.log(`[FCM] Token scritto in ${coll} (${updated.length} in array) UID:`, user.uid);
        saved = true;
        break;
      } catch (e) {
        console.warn('[FCM] Errore accesso a', coll + ':', e.message);
      }
    }

    if (!saved) {
      console.warn('[FCM] Utente non trovato in nessuna collezione:', user.uid);
    }

    // Sottoscrivi contatore notifiche non lette → aggiorna badge PWA
    onSnapshot(doc(db, 'notifiche', user.uid), snap => {
      const contatore = (snap.exists() ? snap.data()?.contatore : 0) || 0;
      if (contatore > 0) {
        if (navigator.setAppBadge) navigator.setAppBadge(contatore).catch(() => {});
      } else {
        if (navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
        if (navigator.setAppBadge)   navigator.setAppBadge(0).catch(() => {});
      }
    });

    // Gestisci notifiche in foreground (app aperta)
    onMessage(messaging, payload => {
      const n    = payload.notification || {};
      const data = payload.data         || {};

      // Toast festoso per notifiche di benvenuto
      if (data.isWelcome === 'true') {
        showWelcomeToast(n.title || '🎉 Benvenuto!', n.body || '', data.url);
        return;
      }

      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification(n.title || 'Campo dei Fiori 🌸', {
          body:               n.body || '',
          icon:               '/icons/icon-192.png',
          badge:              '/icons/icon-192.png',
          tag:                data.tag || 'campo-foreground',
          data:               { url: data.url || '/giornale.html' },
          requireInteraction: false
        });
      });
    });

  } catch (err) {
    console.warn('[FCM] Errore setup:', err.message);
  }
}
