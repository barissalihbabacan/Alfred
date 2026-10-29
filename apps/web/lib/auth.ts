import {
  getAuth,
  signOut,
  onAuthStateChanged,
  User,
  Auth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  UserCredential
} from "firebase/auth";
import { app } from "./firebase";
import { ALLOWED_UID, ALLOWED_EMAIL, isAuthorizedUser, checkUserAuthorization } from "./allowed-uid";
import { errorCode, errorWithCode, readErrorProp } from "./errors";
import { translate, type Lang } from "./i18n";

export { ALLOWED_UID, ALLOWED_EMAIL, isAuthorizedUser, checkUserAuthorization };

let authInstance: Auth | null = null;
let googleProviderInstance: GoogleAuthProvider | null = null;

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(app);
  }
  return authInstance;
}

export function getGoogleAuthProvider(): GoogleAuthProvider {
  if (!googleProviderInstance) {
    googleProviderInstance = new GoogleAuthProvider();
    googleProviderInstance.setCustomParameters({
      prompt: "select_account"
    });
  }
  return googleProviderInstance;
}

/**
 * Sign in with Google Popup, falling back to redirect if blocked by browser.
 */
export async function signInWithGoogle(): Promise<User> {
  const auth = getFirebaseAuth();
  const provider = getGoogleAuthProvider();
  try {
    const result: UserCredential = await signInWithPopup(auth, provider);
    if (result.user && !isAuthorizedUser(result.user)) {
      await signOut(auth);
      throw errorWithCode(
        "Unauthorized user: this account is not allowed to sign in.",
        "auth/unauthorized-uid"
      );
    }
    return result.user;
  } catch (error: unknown) {
    const code = errorCode(error);
    if (
      code === "auth/internal-error" ||
      code === "auth/popup-blocked" ||
      code === "auth/cancelled-popup-request"
    ) {
      console.log("[Auth] Popup encountered issue, transitioning to redirect sign-in...");
      await signInWithRedirect(auth, provider);
      return new Promise(() => {});
    }
    throw error;
  }
}

/**
 * Directly sign in with Google Redirect (useful for Safari / mobile).
 */
export async function signInWithGoogleRedirect(): Promise<void> {
  const auth = getFirebaseAuth();
  const provider = getGoogleAuthProvider();
  await signInWithRedirect(auth, provider);
}

/**
 * Checks for returning redirect credential on page load.
 */
export async function checkRedirectResult(): Promise<User | null> {
  const auth = getFirebaseAuth();
  try {
    const cred = await getRedirectResult(auth);
    if (cred?.user) {
      if (!isAuthorizedUser(cred.user)) {
        await signOut(auth);
        throw errorWithCode(
          "Unauthorized user: this account is not allowed to sign in.",
          "auth/unauthorized-uid"
        );
      }
      return cred.user;
    }
    return null;
  } catch (err) {
    console.warn("[Auth] checkRedirectResult error:", err);
    throw err;
  }
}

/**
 * Sign out current user.
 */
export async function signOutCurrentUser(): Promise<void> {
  const auth = getFirebaseAuth();
  await signOut(auth);
}

/**
 * Subscribe to auth state changes. A restored session whose UID is not the
 * allowed one is signed straight back out; `onUnauthorized` lets the UI show
 * the `auth/unauthorized-uid` message instead of silently returning to the gate.
 */
export function subscribeAuthState(
  callback: (user: User | null) => void,
  onUnauthorized?: (uid: string) => void,
  auth: Auth = getFirebaseAuth()
): () => void {
  return onAuthStateChanged(auth, async (user) => {
    if (user && !isAuthorizedUser(user)) {
      console.warn("[Auth] Unauthorized user detected in onAuthStateChanged:", user.uid, user.email);
      try {
        await signOut(auth);
      } catch (e) {
        console.warn("[Auth] Failed to sign out unauthorized user:", e);
      }
      onUnauthorized?.(user.uid);
      callback(null);
      return;
    }
    callback(user);
  });
}

export interface AuthErrorInfo {
  code: string;
  title: string;
  message: string;
  /** Firebase `customData` (sunucu yaniti), varsa JSON olarak. */
  serverDetails?: string;
}

/** Firebase Auth error code -> dictionary key prefix (`<prefix>.title` / `.message`). */
const AUTH_ERROR_KEYS = {
  "auth/unauthorized-uid": "auth.unauthorizedUid",
  "auth/popup-closed-by-user": "auth.popupClosed",
  "auth/popup-blocked": "auth.popupBlocked",
  "auth/cancelled-popup-request": "auth.cancelledPopup",
  "auth/unauthorized-domain": "auth.unauthorizedDomain",
  "auth/operation-not-allowed": "auth.operationNotAllowed",
  "auth/network-request-failed": "auth.network",
  "auth/user-disabled": "auth.userDisabled",
  "auth/account-exists-with-different-credential": "auth.differentCredential",
  "auth/too-many-requests": "auth.tooManyRequests",
  "auth/internal-error": "auth.internal"
} as const;

type AuthErrorKey = (typeof AUTH_ERROR_KEYS)[keyof typeof AUTH_ERROR_KEYS] | "auth.missingState";

/**
 * Converts Firebase Auth error codes into clear, user-friendly messages in `lang`.
 */
export function getAuthErrorDetails(error: unknown, lang: Lang): AuthErrorInfo {
  const info = describeAuthError(error, lang);
  const customData = readErrorProp(error, "customData");
  if (customData && typeof customData === "object" && Object.keys(customData).length > 0) {
    try {
      info.serverDetails = JSON.stringify(customData);
    } catch {
      // Dongusel veri: detay gosterilmez.
    }
  }
  return info;
}

function describeAuthError(error: unknown, lang: Lang): AuthErrorInfo {
  const code = String(errorCode(error) || "");
  const rawMsg = String(readErrorProp(error, "message") || "");
  const described = (infoCode: string, key: AuthErrorKey): AuthErrorInfo => ({
    code: infoCode,
    title: translate(lang, `${key}.title`),
    message: translate(lang, `${key}.message`)
  });

  if (
    rawMsg.includes("missing initial state") ||
    rawMsg.includes("sessionStorage") ||
    code === "auth/missing-initial-state"
  ) {
    return described("auth/missing-initial-state", "auth.missingState");
  }

  if (Object.hasOwn(AUTH_ERROR_KEYS, code)) {
    return described(code, AUTH_ERROR_KEYS[code as keyof typeof AUTH_ERROR_KEYS]);
  }
  return {
    code: code || "unknown_error",
    title: translate(lang, "auth.unknown.title"),
    message: rawMsg || translate(lang, "auth.unknown.message")
  };
}

/**
 * Returns a single formatted error message string.
 */
export function getFriendlyAuthErrorMessage(error: unknown, lang: Lang): string {
  const details = getAuthErrorDetails(error, lang);
  return `${details.title}: ${details.message}`;
}
