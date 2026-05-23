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

  var notification = payload.notification || {};
  var data = payload.data || {};

  var title = notification.title || data.title || 'Shikshit Mitra';
  var body  = notification.body  || data.body  || 'नयाँ अपडेट आयो!';
  var icon  = notification.icon  || 'https://sarfarajaalam90-dev.github.io/ShikshitMitra/icons/icon-192.png';
  var badge = 'https://sarfarajaalam90-dev.github.io/ShikshitMitra/icons/icon-96.png';
  var url   = data.url || 'https://sarfarajaalam90-dev.github.io/ShikshitMitra/';

  var options = {
    body: body,
    icon: icon,
    badge: badge,
    data: { url: url },
    vibrate: [200, 100, 200],
    requireInteraction: false,
    tag: 'shikshit-mitra-notif' // replaces old notification instead of stacking
  };

  return self.registration.showNotification(title, options);
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
