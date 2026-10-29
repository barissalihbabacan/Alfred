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
        "Yetkisiz Kullanıcı: Bu sisteme yalnızca yetkili yönetici erişebilir.",
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
          "Yetkisiz Kullanıcı: Bu sisteme yalnızca yetkili yönetici erişebilir.",
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

/**
 * Converts Firebase Auth error codes into clear, user-friendly Turkish messages.
 */
export function getAuthErrorDetails(error: unknown): AuthErrorInfo {
  const info = describeAuthError(error);
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

function describeAuthError(error: unknown): AuthErrorInfo {
  const code = String(errorCode(error) || "");
  const rawMsg = String(readErrorProp(error, "message") || "");

  if (
    rawMsg.includes("missing initial state") ||
    rawMsg.includes("sessionStorage") ||
    code === "auth/missing-initial-state"
  ) {
    return {
      code: "auth/missing-initial-state",
      title: "Tarayıcı Oturum/Gizlilik Engeli",
      message: "Tarayıcınızın çerez ve oturum kısıtlaması (özellikle Safari 'Siteler arası takibi engelle' veya gizli sekme) oturum açma durumunu engelledi. Lütfen sayfayı yenileyip tekrar giriş yapmayı deneyin."
    };
  }

  switch (code) {
    case "auth/unauthorized-uid":
      return {
        code,
        title: "Yetkisiz Kullanıcı (Erişim Reddedildi)",
        message: "Bu sisteme yalnızca yetkili yönetici erişebilir. Giriş yaptığınız hesap yetkilendirilmemiştir."
      };
    case "auth/popup-closed-by-user":
      return {
        code,
        title: "Giriş Penceresi Kapatıldı",
        message: "Google kimlik doğrulama penceresi işlem tamamlanmadan kapatıldı. Lütfen tekrar deneyin."
      };
    case "auth/popup-blocked":
      return {
        code,
        title: "Açılır Pencere Engellendi",
        message: "Tarayıcınız Google giriş penceresini engelledi. Lütfen adres çubuğundaki bildirimden açılır pencerelere (pop-up) izin verip tekrar deneyin."
      };
    case "auth/cancelled-popup-request":
      return {
        code,
        title: "İstek Yenilendi",
        message: "Aynı anda birden fazla giriş denemesi yapıldığı için önceki istek iptal edildi."
      };
    case "auth/unauthorized-domain":
      return {
        code,
        title: "Yetkisiz Alan Adı",
        message: "Bu alan adı (domain) Firebase Console > Authentication > Settings > Authorized Domains listesine eklenmemiş."
      };
    case "auth/operation-not-allowed":
      return {
        code,
        title: "Google ile Giriş Henüz Etkin Değil",
        message: "Firebase Console üzerinde Google ile giriş sağlayıcısı etkinleştirilmemiş. Firebase Console > Authentication > Sign-in method sekmesinden 'Google' sağlayıcısını 'Enable' durumuna getirmeniz gerekmektedir."
      };
    case "auth/network-request-failed":
      return {
        code,
        title: "Bağlantı Hatası",
        message: "İnternet bağlantısı kurulamadı. Lütfen ağ bağlantınızı kontrol edin ve tekrar deneyin."
      };
    case "auth/user-disabled":
      return {
        code,
        title: "Hesap Devre Dışı",
        message: "Bu kullanıcı hesabı güvenlik nedeniyle devre dışı bırakılmıştır."
      };
    case "auth/account-exists-with-different-credential":
      return {
        code,
        title: "Farklı Giriş Yöntemi",
        message: "Bu e-posta adresi başka bir yöntemle önceden kaydedilmiş. Lütfen o yöntemle giriş yapın."
      };
    case "auth/too-many-requests":
      return {
        code,
        title: "Çok Fazla Deneme",
        message: "Kısa sürede çok fazla başarısız deneme yapıldı. Güvenliğiniz için lütfen birkaç dakika sonra tekrar deneyin."
      };
    case "auth/internal-error":
      return {
        code,
        title: "Sunucu Hatası",
        message: "Kimlik doğrulama sunucusunda geçici bir hata oluştu. Lütfen tekrar deneyin."
      };
    default:
      return {
        code: code || "unknown_error",
        title: "İşlem Başarısız Oldu",
        message: rawMsg || "Kimlik doğrulama işlemi sırasında beklenmeyen bir hata oluştu. Lütfen tekrar deneyin."
      };
  }
}

/**
 * Returns a single formatted error message string.
 */
export function getFriendlyAuthErrorMessage(error: unknown): string {
  const details = getAuthErrorDetails(error);
  return `${details.title}: ${details.message}`;
}
