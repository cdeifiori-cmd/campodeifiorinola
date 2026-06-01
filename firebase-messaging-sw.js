importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyC18lzwqhYcW29TsEO6Oy4Bqvb2PMBUmAg",
  authDomain: "campo-dei-fiori.firebaseapp.com",
  projectId: "campo-dei-fiori",
  storageBucket: "campo-dei-fiori.firebasestorage.app",
  messagingSenderId: "928976798756",
  appId: "1:928976798756:web:1b90027ec9f03b203e44b1"
});

const messaging = firebase.messaging();

// Gestisce notifiche quando l'app è in background o chiusa
messaging.onBackgroundMessage(payload => {
  const notification = payload.notification || {};
  const data = payload.data || {};

  self.registration.showNotification(notification.title || 'Campo dei Fiori 🌸', {
    body: notification.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'campo-notifica',
    data: { url: data.url || '/' },
    requireInteraction: false
  });
});

// Click sulla notifica → apre la pagina corretta
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
