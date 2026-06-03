/**
 * firebase-messaging-sw.js
 * Service Worker UNIFICATO — Campo dei Fiori
 *
 * Gestisce:
 *  1. Notifiche push FCM (background + foreground)
 *  2. Caching delle risorse per funzionamento offline
 *
 * IMPORTANTE: questo è l'unico SW registrato (scope '/').
 * Non registrare service-worker.js separatamente.
 */

// ── Firebase Messaging (deve usare compat per importScripts) ──────────────
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyC18lzwqhYcW29TsEO6Oy4Bqvb2PMBUmAg",
  authDomain:        "campo-dei-fiori.firebaseapp.com",
  projectId:         "campo-dei-fiori",
  storageBucket:     "campo-dei-fiori.firebasestorage.app",
  messagingSenderId: "928976798756",
  appId:             "1:928976798756:web:1b90027ec9f03b203e44b1"
});

const messaging = firebase.messaging();

// Notifiche in background o con app chiusa
messaging.onBackgroundMessage(payload => {
  const n    = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(n.title || 'Campo dei Fiori 🌸', {
    body:                n.body  || '',
    icon:                '/icons/icon-192.png',
    badge:               '/icons/icon-192.png',
    tag:                 data.tag || 'campo-notifica',
    data:                { url: data.url || '/' },
    requireInteraction:  false
  });
});

// Click sulla notifica → naviga alla pagina giusta
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});

// Risponde al postMessage SKIP_WAITING inviato da notifiche.js
// quando c'è un vecchio SW in "waiting" da sostituire
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Caching (ex service-worker.js) ───────────────────────────────────────
const CACHE_NAME = 'campo-dei-fiori-v2';
const ASSETS_TO_PRECACHE = [
  '/',
  '/index.html',
  '/comunita.html',
  '/login.html',
  '/giornale.html',
  '/staff.html',
  '/amici.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', event => {
  // Diventa attivo immediatamente senza aspettare la chiusura delle vecchie tab
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_PRECACHE))
      .catch(() => {}) // ignora errori di precaching (file opzionali)
  );
});

self.addEventListener('activate', event => {
  // Prende controllo di tutte le tab aperte subito
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Elimina vecchie versioni della cache
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
      )
    ])
  );
});

self.addEventListener('fetch', event => {
  // Ignora richieste non-GET e richieste a Firebase/CDN
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache-and-serve: salva in cache ogni risorsa scaricata con successo
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request)) // offline fallback
  );
});
