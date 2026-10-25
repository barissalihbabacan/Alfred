/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

const firebaseConfig = {
  apiKey: "AIzaSyB2v-fk_DTVTRu4s2yuxScH-c9gSdNcRGQ",
  authDomain: "butler-alfred.firebaseapp.com",
  projectId: "butler-alfred",
  storageBucket: "butler-alfred.firebasestorage.app",
  messagingSenderId: "653487811677",
  appId: "1:653487811677:web:1b53984d38a210428a31b4"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log("[firebase-messaging-sw.js] Arka plan bildirimi alındı:", payload);

  const title = payload.notification?.title || payload.data?.title || "Alfred";
  const body = payload.notification?.body || payload.data?.body || "Yeni bir bildirim var.";
  const url = payload.data?.url || payload.fcmOptions?.link || "/";

  const options = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [200, 100, 200],
    tag: payload.data?.tag || "alfred-notification",
    renotify: true,
    data: {
      url,
      timestamp: Date.now()
    }
  };

  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.registration.scope) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
