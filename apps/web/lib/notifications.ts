import { app, firebaseConfig } from "./firebase";
import { apiFetch, ensureOk } from "./api";

let messagingPromise: Promise<import("firebase/messaging").Messaging | null> | null = null;

export async function getFirebaseMessaging(): Promise<import("firebase/messaging").Messaging | null> {
  if (typeof window === "undefined") return null;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return null;

  if (!messagingPromise) {
    messagingPromise = (async () => {
      try {
        const { getMessaging, isSupported } = await import("firebase/messaging");
        const supported = await isSupported();
        if (!supported) return null;
        return getMessaging(app);
      } catch (err) {
        console.warn("[Notifications] Firebase Messaging is not supported or failed to load:", err);
        return null;
      }
    })();
  }
  return messagingPromise;
}

export function getNotificationPermissionState(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const params = new URLSearchParams();
    if (firebaseConfig.apiKey) params.set("apiKey", firebaseConfig.apiKey);
    if (firebaseConfig.projectId) params.set("projectId", firebaseConfig.projectId);
    if (firebaseConfig.authDomain) params.set("authDomain", firebaseConfig.authDomain);
    if (firebaseConfig.storageBucket) params.set("storageBucket", firebaseConfig.storageBucket);
    if (firebaseConfig.messagingSenderId) params.set("messagingSenderId", firebaseConfig.messagingSenderId);
    if (firebaseConfig.appId) params.set("appId", firebaseConfig.appId);
    const queryString = params.toString();
    const swUrl = queryString ? `/firebase-messaging-sw.js?${queryString}` : "/firebase-messaging-sw.js";

    const registration = await navigator.serviceWorker.register(swUrl, {
      scope: "/"
    });
    return registration;
  } catch (err) {
    console.error("[Notifications] Service worker registration failed:", err);
    return null;
  }
}

export async function requestPushPermissionAndToken(
  customVapidKey?: string
): Promise<{ token: string | null; error?: string }> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return { token: null, error: "Tarayıcınız bildirimleri desteklemiyor." };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { token: null, error: "Bildirim izni verilmedi." };
    }

    const messaging = await getFirebaseMessaging();
    if (!messaging) {
      return { token: null, error: "Firebase Messaging bu tarayıcıda desteklenmiyor." };
    }

    const registration = await registerServiceWorker();
    if (!registration) {
      return { token: null, error: "Service Worker başlatılamadı." };
    }

    const vapidKey =
      customVapidKey ||
      process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ||
      undefined;

    const { getToken } = await import("firebase/messaging");
    const token = await getToken(messaging, {
      serviceWorkerRegistration: registration,
      vapidKey: vapidKey || undefined
    });

    if (!token) {
      return { token: null, error: "Cihaz bildirim anahtarı (FCM token) üretilemedi." };
    }

    return { token };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Notifications] Token retrieval error:", err);
    return { token: null, error: message };
  }
}

export async function saveFcmTokenToBackend(token: string): Promise<void> {
  const res = await apiFetch("/notifications/fcm-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      platform: "web"
    })
  });
  await ensureOk(res);
}

export async function removeFcmTokenFromBackend(token: string): Promise<void> {
  await apiFetch("/notifications/fcm-token", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  }).catch((err) => console.warn("[Notifications] Failed to delete token on backend:", err));
}

export async function sendTestPushNotification(): Promise<{ success: boolean; message: string }> {
  const res = await apiFetch("/notifications/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Alfred — Test Bildirimi",
      body: "Alfred bildirim sistemi cihazınızda başarıyla devrede!"
    })
  });
  await ensureOk(res);
  const data = await res.json().catch(() => ({}));
  return { success: true, message: data.message || "Test bildirimi gönderildi." };
}

export async function subscribeForegroundMessages(
  onNotification?: (payload: { title?: string; body?: string; data?: Record<string, unknown> }) => void
): Promise<(() => void) | null> {
  const messaging = await getFirebaseMessaging();
  if (!messaging) return null;

  const { onMessage } = await import("firebase/messaging");
  const unsubscribe = onMessage(messaging, async (payload) => {
    console.log("[Notifications] Ön planda bildirim:", payload);
    const title = payload.notification?.title || payload.data?.title || "Alfred";
    const body = payload.notification?.body || payload.data?.body || "";

    if (onNotification) {
      onNotification({ title, body, data: payload.data });
    }

    // Ön plandayken de sistem bildirimini tetikle
    if (typeof window !== "undefined" && "serviceWorker" in navigator && Notification.permission === "granted") {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          body,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          data: payload.data || { url: "/" },
          // @ts-expect-error vibrate is standard in ServiceWorker NotificationOptions
          vibrate: [200, 100, 200]
        });
      } catch (err) {
        console.warn("[Notifications] Foreground showNotification:", err);
      }
    }
  });

  return unsubscribe;
}
