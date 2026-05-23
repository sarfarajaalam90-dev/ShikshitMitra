// firebase-messaging-sw.js
// Place this file in the ROOT of your GitHub Pages repo (same level as index.html)
// File path in repo: ShikshitMitra/firebase-messaging-sw.js

importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

firebase.initializeApp({
  apiKey: "AIzaSyAaTyHTxmuktChm8AtJC15dfVejD66Gxvg",
  authDomain: "digitalnepalapp.firebaseapp.com",
  projectId: "digitalnepalapp",
  storageBucket: "digitalnepalapp.firebasestorage.app",
  messagingSenderId: "570701053036",
  databaseURL: "https://digitalnepalapp-default-rtdb.asia-southeast1.firebasedatabase.app",
  appId: "1:570701053036:web:0d074762777277e9d26c49"
});

const messaging = firebase.messaging();

// Handle background push notifications (app is closed or in background)
messaging.onBackgroundMessage(function(payload) {
  console.log('[SW] Background message received:', payload);

  var title = (payload.notification && payload.notification.title)
    || (payload.data && payload.data.title)
    || 'Shikshit Mitra';

  var body = (payload.notification && payload.notification.body)
    || (payload.data && payload.data.body)
    || 'नयाँ अपडेट आयो!';

  var url = (payload.data && payload.data.url)
    || 'https://sarfarajaalam90-dev.github.io/ShikshitMitra/';

  return self.registration.showNotification(title, {
    body: body,
    icon: 'https://sarfarajaalam90-dev.github.io/ShikshitMitra/icon-192.png',
    badge: 'https://sarfarajaalam90-dev.github.io/ShikshitMitra/icon-96.png',
    vibrate: [200, 100, 200],
    tag: 'shikshit-mitra-notif',
    renotify: true,
    requireInteraction: false,
    data: { url: url }
  });
});

// When user taps the notification → open the app
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : 'https://sarfarajaalam90-dev.github.io/ShikshitMitra/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
