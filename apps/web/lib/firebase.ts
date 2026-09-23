import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeAppCheck,
  getToken,
  ReCaptchaEnterpriseProvider,
  AppCheck
} from "firebase/app-check";

const defaultAuthDomain = "butler-alfred.firebaseapp.com";

// Firebase web yapilandirmasi. apiKey herkese acik web config anahtaridir, gizli degildir.
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyB2v-fk_DTVTRu4s2yuxScH-c9gSdNcRGQ",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || defaultAuthDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "butler-alfred",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "butler-alfred.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "653487811677",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:653487811677:web:1b53984d38a210428a31b4"
};

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

const RECAPTCHA_SITE_KEY =
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "6LfKoK8tAAAAAEo28kTSEBZWJpKK7-JMV9CZNYIX";

// App Check (reCAPTCHA Enterprise) yalnizca tarayicida baslatilir. Statik
// export sirasinda bu modul Node'da da degerlendirilir; orada hicbir sey yapilmaz.
let appCheckInstance: AppCheck | null = null;

/** Firebase App Check'in tarayicida okudugu debug token global'i (SDK tiplerinde yok). */
type AppCheckDebugGlobal = typeof globalThis & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean };

if (typeof window !== "undefined") {
  // localhost'ta ve ?debug_token=true ile App Check debug token'i kullanilir
  // (eski vanilla on yuzle ayni davranis).
  if (
    process.env.NODE_ENV === "development" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.search.includes("debug_token=true")
  ) {
    // Firebase App Check debug hook'u: SDK bu global'i initializeAppCheck'ten once okur.
    (self as AppCheckDebugGlobal).FIREBASE_APPCHECK_DEBUG_TOKEN =
      process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN || "REDACTED-REVOKED-DEBUG-TOKEN";
  }

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
 * null doner; sunucu ENFORCE_APP_CHECK kapaliyken istegi yine kabul eder.
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
