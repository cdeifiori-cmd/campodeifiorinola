/**
 * Gestione notifiche push FCM per Campo dei Fiori.
 *
 * SETUP INIZIALE (una tantum):
 * 1. Vai su Firebase Console > Project Settings > Cloud Messaging
 * 2. Nella sezione "Web Push Certificates" clicca "Generate key pair"
 * 3. Copia la chiave e sostituisci VAPID_KEY qui sotto
 */

import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";
import { getFirestore, doc, updateDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ⚠️ Sostituisci con la tua chiave VAPID da Firebase Console
const VAPID_KEY = 'BIUkTONw1oYZnDjfYX26iLF77yrX10mbHVEtBFwrXRldPzeRD1hFk-3KzC4hc9j9Ne0Zi8BCrUro-J2Hw2xREgU';

const firebaseConfig = {
  apiKey: "AIzaSyC18lzwqhYcW29TsEO6Oy4Bqvb2PMBUmAg",
  authDomain: "campo-dei-fiori.firebaseapp.com",
  projectId: "campo-dei-fiori",
  storageBucket: "campo-dei-fiori.firebasestorage.app",
  messagingSenderId: "928976798756",
  appId: "1:928976798756:web:1b90027ec9f03b203e44b1"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getFirestore(app);

export async function setupNotifiche(user) {
  if (!user) return;

  // FCM non supportato su tutti i browser
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

  // iOS richiede che l'app sia installata come PWA
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                       window.navigator.standalone === true;
  if (isIOS && !isStandalone) return; // su iOS funziona solo da PWA

  try {
    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return;

    // Registra il service worker FCM
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg
    });

    if (!token) return;

    // Salva il token nel documento Firestore dell'utente (utenti o staff)
    let ref = doc(db, 'utenti', user.uid);
    let snap = await getDoc(ref);
    if (!snap.exists()) ref = doc(db, 'staff', user.uid);
    await updateDoc(ref, { fcmToken: token });

    // Gestisce messaggi in foreground (app aperta)
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
    // Notifiche non critiche — ignora errori silenziosamente
    console.warn('[Notifiche] Setup non completato:', err.message);
  }
}
