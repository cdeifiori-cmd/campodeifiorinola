/**
 * notifiche.js — Gestione token FCM per Campo dei Fiori
 *
 * FIX applicati:
 * - Usa navigator.serviceWorker.ready invece di registrare un secondo SW
 *   (evita il conflitto di scope con firebase-messaging-sw.js già registrato)
 * - Salva il token anche per utenti nella collezione 'amici'
 * - Aggiunge logging per facilitare il debugging
 * - Gestisce correttamente il caso token null
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import { getFirestore, doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const VAPID_KEY = 'BIUkTONw1oYZnDjfYX26iLF77yrX10mbHVEtBFwrXRldPzeRD1hFk-3KzC4hc9j9Ne0Zi8BCrUro-J2Hw2xREgU';

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

export async function setupNotifiche(user) {
  if (!user) return;

  // FCM richiede Notification API e Service Worker
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    console.log('[FCM] Browser non supportato');
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
    // Chiedi permesso se non ancora dato
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      console.log('[FCM] Permesso notifiche negato:', permission);
      return;
    }

    // ── FIX CRITICO: usa il SW già registrato (firebase-messaging-sw.js)
    //    invece di registrarne uno nuovo con scope '/' identico.
    //    navigator.serviceWorker.ready attende che il SW sia attivo.
    const swReg = await navigator.serviceWorker.ready;
    console.log('[FCM] Service worker attivo:', swReg.active?.scriptURL);

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg
    });

    if (!token) {
      console.warn('[FCM] Token null — il SW potrebbe non essere attivo o la VAPID key non valida');
      return;
    }

    console.log('[FCM] Token ottenuto:', token.slice(0, 20) + '…');

    // ── FIX: salva token cercando anche nella collezione 'amici'
    let ref  = null;
    let found = false;
    for (const coll of ['utenti', 'staff', 'amici']) {
      const snap = await getDoc(doc(db, coll, user.uid));
      if (snap.exists()) {
        ref = doc(db, coll, user.uid);
        found = true;
        // Aggiorna solo se il token è cambiato (evita scritture inutili)
        const prevToken = snap.data().fcmToken;
        if (prevToken === token) {
          console.log('[FCM] Token già aggiornato in', coll);
          break;
        }
        await updateDoc(ref, { fcmToken: token });
        console.log('[FCM] Token salvato in', coll, 'per', user.uid);
        break;
      }
    }

    if (!found) {
      console.warn('[FCM] Utente non trovato in nessuna collezione:', user.uid);
    }

    // Notifiche in foreground (app aperta e in primo piano)
    onMessage(messaging, payload => {
      const n = payload.notification || {};
      if (Notification.permission === 'granted') {
        new Notification(n.title || 'Campo dei Fiori 🌸', {
          body: n.body || '',
          icon: '/icons/icon-192.png'
        });
      }
    });

  } catch (err) {
    console.warn('[FCM] Setup non completato:', err.message);
  }
}
