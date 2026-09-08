import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  multiFactor,
  getMultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  User,
  MultiFactorResolver,
  PhoneMultiFactorInfo,
  Auth,
  GoogleAuthProvider,
  signInWithPopup,
  UserCredential
} from "firebase/auth";
import { app } from "./firebase";

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

export interface MfaChallenge {
  resolver: MultiFactorResolver;
  verificationId: string;
  phoneHint: PhoneMultiFactorInfo;
}

/**
 * Sign in user with email and password.
 * Returns { user } if successful, or { mfaRequired: true, challenge } if second-factor SMS is needed.
 */
export async function signInUser(
  email: string,
  pass: string,
  appVerifier: RecaptchaVerifier
): Promise<{ user?: User; mfaChallenge?: MfaChallenge }> {
  const auth = getFirebaseAuth();
  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    return { user: cred.user };
  } catch (error: any) {
    if (error.code === "auth/multi-factor-auth-required") {
      const resolver = getMultiFactorResolver(auth, error);
      const phoneHint = resolver.hints.find(
        (h) => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID
      ) as PhoneMultiFactorInfo;

      if (!phoneHint) {
        throw new Error("SMS Multi-Factor hint not found on account.");
      }

      const phoneAuthProvider = new PhoneAuthProvider(auth);
      const verificationId = await phoneAuthProvider.verifyPhoneNumber(
        {
          multiFactorHint: phoneHint,
          session: resolver.session
        },
        appVerifier
      );

      return {
        mfaChallenge: {
          resolver,
          verificationId,
          phoneHint
        }
      };
    }
    throw error;
  }
}

/**
 * Completes sign in using the SMS verification code received on the user's enrolled phone.
 */
export async function resolveMfaSignIn(
  resolver: MultiFactorResolver,
  verificationId: string,
  verificationCode: string
): Promise<User> {
  const cred = PhoneAuthProvider.credential(verificationId, verificationCode);
  const assertion = PhoneMultiFactorGenerator.assertion(cred);
  const result = await resolver.resolveSignIn(assertion);
  return result.user;
}

/**
 * Register a new user with email and password.
 */
export async function registerUser(email: string, pass: string): Promise<User> {
  const auth = getFirebaseAuth();
  const cred = await createUserWithEmailAndPassword(auth, email, pass);
  return cred.user;
}

/**
 * Start enrolling a phone number as a second factor for the currently logged-in user.
 */
export async function startMfaEnrollment(
  phoneNumber: string,
  appVerifier: RecaptchaVerifier
): Promise<string> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error("No authenticated user found for MFA enrollment.");
  }

  const session = await multiFactor(user).getSession();
  const phoneAuthProvider = new PhoneAuthProvider(auth);
  const verificationId = await phoneAuthProvider.verifyPhoneNumber(
    {
      phoneNumber,
      session
    },
    appVerifier
  );

  return verificationId;
}

/**
 * Complete MFA enrollment using the SMS verification code.
 */
export async function confirmMfaEnrollment(
  verificationId: string,
  verificationCode: string,
  displayName = "Personal Mobile"
): Promise<void> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error("No authenticated user found for MFA enrollment confirmation.");
  }

  const cred = PhoneAuthProvider.credential(verificationId, verificationCode);
  const assertion = PhoneMultiFactorGenerator.assertion(cred);
  await multiFactor(user).enroll(assertion, displayName);
}

/**
 * Sign in with Google Popup.
 */
export async function signInWithGoogle(): Promise<User> {
  const auth = getFirebaseAuth();
  const provider = getGoogleAuthProvider();
  const result: UserCredential = await signInWithPopup(auth, provider);
  return result.user;
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
  return onAuthStateChanged(auth, callback);
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
    case "auth/user-not-found":
      return {
        code,
        title: "Kullanıcı Bulunamadı",
        message: "Bu e-posta adresine ait kayıtlı bir kullanıcı bulunamadı."
      };
    case "auth/wrong-password":
      return {
        code,
        title: "Hatalı Şifre",
        message: "Girdiğiniz şifre hatalı. Lütfen şifrenizi kontrol edip tekrar deneyin."
      };
    case "auth/invalid-credential":
      return {
        code,
        title: "Geçersiz Bilgiler",
        message: "Girdiğiniz kimlik bilgileri hatalı veya süresi dolmuş. Lütfen kontrol edip tekrar deneyin."
      };
    case "auth/email-already-in-use":
      return {
        code,
        title: "E-posta Zaten Kayıtlı",
        message: "Bu e-posta adresiyle zaten kayıtlı bir hesap bulunmaktadır. Lütfen giriş yapmayı deneyin."
      };
    case "auth/weak-password":
      return {
        code,
        title: "Zayıf Şifre",
        message: "Şifreniz çok zayıf. Lütfen en az 6 karakterden oluşan daha güvenli bir şifre belirleyin."
      };
    case "auth/invalid-email":
      return {
        code,
        title: "Geçersiz E-posta",
        message: "Lütfen geçerli bir e-posta adresi girin (örn. ornek@domain.com)."
      };
    case "auth/account-exists-with-different-credential":
      return {
        code,
        title: "Farklı Giriş Yöntemi",
        message: "Bu e-posta adresi başka bir yöntemle (örn. e-posta/şifre) önceden kaydedilmiş. Lütfen o yöntemle giriş yapın."
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

