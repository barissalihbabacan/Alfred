import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeAppCheck,
  getToken,
  ReCaptchaEnterpriseProvider,
  AppCheck
} from "firebase/app-check";
import { resolveAppCheckDebugToken } from "./app-check-debug";

export function validateProductionFirebaseConfig(config: {
  apiKey?: string;
  projectId?: string;
  appId?: string;
}): void {
  if (!config.apiKey || !config.projectId || !config.appId) {
    throw new Error(
      "Missing mandatory Firebase configuration in production environment. " +
      "Ensure NEXT_PUBLIC_FIREBASE_API_KEY, NEXT_PUBLIC_FIREBASE_PROJECT_ID, " +
      "and NEXT_PUBLIC_FIREBASE_APP_ID are set."
    );
  }
}

const apiKey = (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "").trim();
const projectId = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "").trim();
const appId = (process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "").trim();

if (process.env.NODE_ENV === "production" && (typeof window !== "undefined" || process.env.VALIDATE_FIREBASE_CONFIG === "true")) {
  validateProductionFirebaseConfig({ apiKey, projectId, appId });
}

const defaultAuthDomain = projectId ? `${projectId}.firebaseapp.com` : "";
const defaultStorageBucket = projectId ? `${projectId}.firebasestorage.app` : "";

// Firebase web yapilandirmasi. apiKey herkese acik web config anahtaridir, gizli degildir.
export const firebaseConfig = {
  apiKey,
  authDomain: (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "").trim() || defaultAuthDomain,
  projectId,
  storageBucket: (process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "").trim() || defaultStorageBucket,
  messagingSenderId: (process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "").trim(),
  appId
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

const RECAPTCHA_SITE_KEY = (process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "").trim();

// App Check (reCAPTCHA Enterprise) yalnizca tarayicida baslatilir. Statik
// export sirasinda bu modul Node'da da degerlendirilir; orada hicbir sey yapilmaz.
let appCheckInstance: AppCheck | null = null;

/** Firebase App Check'in tarayicida okudugu debug token global'i (SDK tiplerinde yok). */
type AppCheckDebugGlobal = typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean };

if (typeof window !== "undefined") {
  // Debug token yalnizca yerel gelistirmede; canli sitede asla (bkz. app-check-debug.ts).
  const debugToken = resolveAppCheckDebugToken({
    hostname: window.location.hostname,
    nodeEnv: process.env.NODE_ENV,
    envToken: process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN,
    secureContext: window.isSecureContext
  });
  if (debugToken !== undefined) {
    // Firebase App Check debug hook'u: SDK bu global'i initializeAppCheck'ten once okur.
    (self as AppCheckDebugGlobal).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
  }

  // RECAPTCHA_SITE_KEY yoksa App Check'i baslatma (hata vermeden gec)
  if (RECAPTCHA_SITE_KEY && RECAPTCHA_SITE_KEY !== "dummy-recaptcha-site-key") {
    try {
      appCheckInstance = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true
      });
    } catch (err) {
      console.warn("[AppCheck] Initialization skipped or already initialized:", err);
    }
  }
}

export const appCheck = appCheckInstance;

/**
 * `X-Firebase-AppCheck` basligi icin guncel App Check token'i. Token alinamazsa
 * null doner; App Check zorunlu oldugu icin sunucu o istegi 401 ile reddeder.
 */
export async function getAppCheckToken(): Promise<string | null> {
  if (!appCheckInstance) return null;
  try {
    const result = await getToken(appCheckInstance, false);
    return result?.token || null;
  } catch (err) {
    console.warn("[AppCheck] Token acquisition failed:", err);
    return null;
  }
}

export default app;
