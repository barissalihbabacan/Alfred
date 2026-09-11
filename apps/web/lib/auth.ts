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

export const ALLOWED_UID = "test-owner-uid-123456";

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
    if (result.user && result.user.uid !== ALLOWED_UID) {
      await signOut(auth);
      const err: any = new Error("Yetkisiz Kullanıcı: Bu sisteme yalnızca yetkili yönetici erişebilir.");
      err.code = "auth/unauthorized-uid";
      throw err;
    }
    return result.user;
  } catch (error: any) {
    if (
      error?.code === "auth/internal-error" ||
      error?.code === "auth/popup-blocked" ||
      error?.code === "auth/cancelled-popup-request"
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
      if (cred.user.uid !== ALLOWED_UID) {
        await signOut(auth);
        const err: any = new Error("Yetkisiz Kullanıcı: Bu sisteme yalnızca yetkili yönetici erişebilir.");
        err.code = "auth/unauthorized-uid";
        throw err;
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
 * Subscribe to auth state changes.
 */
export function subscribeAuthState(callback: (user: User | null) => void): () => void {
  const auth = getFirebaseAuth();
  return onAuthStateChanged(auth, async (user) => {
    if (user && user.uid !== ALLOWED_UID) {
      try {
        await signOut(auth);
      } catch (e) {
        console.warn("[Auth] Failed to sign out unauthorized user:", e);
      }
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
}

/**
 * Converts Firebase Auth error codes into clear, user-friendly Turkish messages.
 */
export function getAuthErrorDetails(error: any): AuthErrorInfo {
  const code = error?.code || "";
  const rawMsg = error?.message || "";

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
export function getFriendlyAuthErrorMessage(error: any): string {
  const details = getAuthErrorDetails(error);
  return `${details.title}: ${details.message}`;
}
