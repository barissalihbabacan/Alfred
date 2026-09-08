// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, AppCheck } from "firebase/app-check";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

const defaultAuthDomain = "butler-alfred.firebaseapp.com";

// Your web app's Firebase configuration
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyB2v-fk_DTVTRu4s2yuxScH-c9gSdNcRGQ",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || defaultAuthDomain,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "butler-alfred",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "butler-alfred.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "653487811677",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:653487811677:web:1b53984d38a210428a31b4"
};

// Initialize Firebase
export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// Initialize Firebase App Check with reCAPTCHA Enterprise
let appCheckInstance: AppCheck | null = null;
if (typeof window !== "undefined") {
  // Allow Firebase App Check debug token on localhost/development to avoid 401 PAT errors
  if (
    process.env.NODE_ENV === "development" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    // @ts-ignore
    self.FIREBASE_APPCHECK_DEBUG_TOKEN =
      process.env.NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN || "REDACTED-REVOKED-DEBUG-TOKEN";
  }

  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || "6LfKoK8tAAAAAEo28kTSEBZWJpKK7-JMV9CZNYIX";

  if (siteKey && siteKey !== "dummy-recaptcha-site-key") {
    try {
      appCheckInstance = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: true
      });
    } catch (err) {
      console.warn("[AppCheck] Initialization skipped or already initialized:", err);
    }
  }
}

export const appCheck = appCheckInstance;
export default app;
