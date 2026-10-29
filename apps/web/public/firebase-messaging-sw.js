/* eslint-disable no-undef */
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

const searchParams = new URL(location.href).searchParams;
const projectId = searchParams.get("projectId") || "";

const firebaseConfig = {
  apiKey: searchParams.get("apiKey") || "",
  authDomain: searchParams.get("authDomain") || (projectId ? `${projectId}.firebaseapp.com` : ""),
  projectId,
  storageBucket: searchParams.get("storageBucket") || (projectId ? `${projectId}.firebasestorage.app` : ""),
  messagingSenderId: searchParams.get("messagingSenderId") || "",
  appId: searchParams.get("appId") || ""
};

if (firebaseConfig.apiKey && firebaseConfig.projectId) {
  firebase.initializeApp(firebaseConfig);
  firebase.messaging();
}

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
