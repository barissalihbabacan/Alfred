import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app-check.js";
import {
  getAuth,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyB2v-fk_DTVTRu4s2yuxScH-c9gSdNcRGQ",
  authDomain: "butler-alfred.firebaseapp.com",
  projectId: "butler-alfred",
  storageBucket: "butler-alfred.firebasestorage.app",
  messagingSenderId: "653487811677",
  appId: "1:653487811677:web:1b53984d38a210428a31b4"
};

const app = initializeApp(firebaseConfig);
window.firebaseApp = app;

// App Check configuration with official registered reCAPTCHA Enterprise key
const RECAPTCHA_SITE_KEY = window.RECAPTCHA_SITE_KEY || "6LfKoK8tAAAAAEo28kTSEBZWJpKK7-JMV9CZNYIX";

if (typeof window !== "undefined") {
  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.search.includes("debug_token=true")
  ) {
    // @ts-ignore
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = "REDACTED-REVOKED-DEBUG-TOKEN";
  }
}

let appCheckInstance = null;
window.getAppCheckToken = async () => {
  try {
    if (!appCheckInstance) {
      appCheckInstance = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true
      });
      window.firebaseAppCheck = appCheckInstance;
      console.log("[AppCheck] Initialized on demand with key:", RECAPTCHA_SITE_KEY);
    }
    const tokenResult = await getToken(appCheckInstance, false);
    return tokenResult?.token || null;
  } catch (e) {
    console.warn("[AppCheck] Token acquisition failed:", e);
    return null;
  }
};

export const ALLOWED_UID = "test-owner-uid-123456";
window.ALLOWED_UID = ALLOWED_UID;

function formatAuthErrorDetails(err) {
  const code = err?.code || "";
  const rawMsg = err?.message || "";

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
    case "auth/operation-not-allowed":
      return {
        code,
        title: "Google ile Giriş Henüz Etkin Değil",
        message: "Firebase Console üzerinde Google ile giriş yöntemi henüz etkinleştirilmemiş. Firebase Console > Authentication > Sign-in method sekmesinden 'Google' sağlayıcısını 'Enable' durumuna getirmeniz gerekmektedir.",
        isOperationNotAllowed: true
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
    case "auth/unauthorized-domain":
      return {
        code,
        title: "Yetkisiz Alan Adı",
        message: "Bu alan adı (domain) Firebase Console > Authentication > Settings > Authorized Domains listesine eklenmemiş."
      };
    case "auth/network-request-failed":
      return {
        code,
        title: "Bağlantı Hatası",
        message: "İnternet bağlantısı kurulamadı. Lütfen ağ bağlantınızı kontrol edin ve tekrar deneyin."
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
        message: rawMsg || "Kimlik doğrulama işlemi sırasında beklenmeyen bir hata oluştu."
      };
  }
}

// Initialize Firebase Auth
const auth = getAuth(app);
window.firebaseAuth = auth;

// Listen for returning redirect sign-in result
getRedirectResult(auth)
  .then(async (cred) => {
    if (cred && cred.user) {
      if (cred.user.uid !== ALLOWED_UID) {
        console.warn("[Auth] Unauthorized redirect sign-in attempt:", cred.user.uid);
        await signOut(auth);
        const errBox = document.getElementById("gateAuthError");
        if (errBox) {
          const details = formatAuthErrorDetails({ code: "auth/unauthorized-uid" });
          errBox.innerHTML = `
            <div class="auth-error-header">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>${details.title}</span>
              <button onclick="document.getElementById('gateAuthError').style.display='none'" class="auth-error-close" title="Kapat">✕</button>
            </div>
            <div class="auth-error-desc">${details.message}</div>
          `;
          errBox.style.display = "block";
        }
        return;
      }
      console.log("[Auth] Redirect sign-in success:", cred.user);
      const gateOverlay = document.getElementById("authGateOverlay");
      if (gateOverlay) gateOverlay.style.display = "none";
    } else {
      console.log("[Auth] getRedirectResult: No pending redirect result found.");
    }
  })
  .catch((err) => {
    console.error("[Auth] getRedirectResult error:", err);
    const errBox = document.getElementById("gateAuthError");
    if (errBox) {
      const details = formatAuthErrorDetails(err);
      errBox.innerHTML = `
        <div class="auth-error-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>${details.title}</span>
          <button onclick="document.getElementById('gateAuthError').style.display='none'" class="auth-error-close" title="Kapat">✕</button>
        </div>
        <div class="auth-error-desc">${details.message}</div>
      `;
      errBox.style.display = "block";
    }
  });

// Window Exposure for Auth Actions
window.openAuthModal = function() {
  const user = auth.currentUser;
  const emailEl = document.getElementById("authCurrentUserEmail");
  if (emailEl) emailEl.textContent = user?.email || "-";
  document.getElementById("authModal").classList.add("open");
};

window.closeAuthModal = function() {
  document.getElementById("authModal").classList.remove("open");
};

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

window.handleGoogleSignIn = async function() {
  const btn = document.getElementById("gateGoogleSignInBtn");
  const errBox = document.getElementById("gateAuthError");
  if (errBox) {
    errBox.style.display = "none";
    errBox.innerHTML = "";
  }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="gate-spinner"></span> <span>Giriş Yapılıyor...</span>`;
  }

  try {
    const cred = await signInWithPopup(auth, googleProvider);
    if (cred && cred.user && cred.user.uid !== ALLOWED_UID) {
      console.warn("[Auth] Unauthorized popup sign-in attempt:", cred.user.uid);
      await signOut(auth);
      throw { code: "auth/unauthorized-uid" };
    }
  } catch (err) {
    console.error("[Auth] Google Sign-In error:", err);
    console.error("[Auth] Error customData:", err?.customData);

    if (errBox) {
      const details = formatAuthErrorDetails(err);
      let solutionHtml = "";
      if (details.isOperationNotAllowed) {
        solutionHtml = `
          <div class="auth-solution-card">
            <div class="auth-solution-title">⚙️ Çözüm Adımları (1 Dakika):</div>
            <ol>
              <li><strong>Firebase Console &gt; Authentication &gt; Sign-in method</strong> sekmesini açın.</li>
              <li><strong>Google</strong> seçeneğine tıklayıp <strong>Enable (Etkinleştir)</strong> yapın.</li>
              <li>Proje destek e-postasını seçip <strong>Save (Kaydet)</strong> butonuna basın.</li>
            </ol>
            <a href="https://console.firebase.google.com/project/butler-alfred/authentication/providers" target="_blank" rel="noopener noreferrer" class="auth-solution-link">
              <span>Firebase Console Sağlayıcılar Sayfasına Git</span> <span>↗</span>
            </a>
          </div>
        `;
      }
      let serverDetails = "";
      if (err?.customData && Object.keys(err.customData).length > 0) {
        try {
          serverDetails = `<div style="margin-top:8px;font-size:11px;color:#cbd5e1;font-family:monospace;word-break:break-all;background:rgba(0,0,0,0.4);padding:6px 8px;border-radius:6px;">Sunucu Yanıtı: ${JSON.stringify(err.customData)}</div>`;
        } catch {}
      }
      errBox.innerHTML = `
        <div class="auth-error-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>${details.title}</span>
          <button onclick="document.getElementById('gateAuthError').style.display='none'" class="auth-error-close" title="Kapat">✕</button>
        </div>
        <div class="auth-error-desc">${details.message}</div>
        ${serverDetails}
        ${solutionHtml}
      `;
      errBox.style.display = "block";
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        <span>Google ile Giriş Yap</span>
      `;
    }
  }
};

window.handleGoogleSignInRedirect = async function() {
  const btn = document.getElementById("gateGoogleSignInBtn");
  const redirectBtn = document.getElementById("gateGoogleRedirectBtn");
  const errBox = document.getElementById("gateAuthError");
  if (errBox) {
    errBox.style.display = "none";
    errBox.innerHTML = "";
  }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span class="gate-spinner"></span> <span>Google'a Yönlendiriliyor...</span>`;
  }
  if (redirectBtn) {
    redirectBtn.style.opacity = "0.5";
    redirectBtn.style.pointerEvents = "none";
  }

  try {
    await signInWithRedirect(auth, googleProvider);
  } catch (err) {
    console.error("[Auth] Direct redirect sign-in error:", err);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>Google ile Giriş Yap</span>`;
    }
    if (redirectBtn) {
      redirectBtn.style.opacity = "1";
      redirectBtn.style.pointerEvents = "auto";
    }
    if (errBox) {
      const details = formatAuthErrorDetails(err);
      errBox.innerHTML = `
        <div class="auth-error-header">
          <span>${details.title}</span>
        </div>
        <div class="auth-error-desc">${details.message}</div>
      `;
      errBox.style.display = "block";
    }
  }
};

window.handleSignOut = async function() {
  try {
    await signOut(auth);
    const gateOverlay = document.getElementById("authGateOverlay");
    if (gateOverlay) gateOverlay.style.display = "flex";
  } catch (err) {
    console.error("[Auth] Sign out error:", err);
  }
};

// Listen to Firebase Auth State Changes and enforce Auth Gate
onAuthStateChanged(auth, async (user) => {
  const gateOverlay = document.getElementById("authGateOverlay");
  const topSignOutBtn = document.getElementById("topSignOutBtn");
  const userAvatar = document.getElementById("sidebarUserAvatar");
  const userName = document.getElementById("sidebarUserName");
  const userRole = document.getElementById("sidebarUserRole");

  if (user) {
    if (user.uid !== ALLOWED_UID) {
      console.warn("[Auth] Unauthorized UID detected in onAuthStateChanged:", user.uid);
      try {
        await signOut(auth);
      } catch (e) {
        console.warn("[Auth] Sign-out error:", e);
      }
      if (gateOverlay) gateOverlay.style.display = "flex";
      if (topSignOutBtn) topSignOutBtn.style.display = "none";
      if (userName) userName.textContent = "Giriş Yapılmadı";
      if (userRole) userRole.textContent = "Erişim Kilitli";
      if (userAvatar) userAvatar.textContent = "?";

      const errBox = document.getElementById("gateAuthError");
      if (errBox) {
        const details = formatAuthErrorDetails({ code: "auth/unauthorized-uid" });
        errBox.innerHTML = `
          <div class="auth-error-header">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>${details.title}</span>
            <button onclick="document.getElementById('gateAuthError').style.display='none'" class="auth-error-close" title="Kapat">✕</button>
          </div>
          <div class="auth-error-desc">${details.message}</div>
        `;
        errBox.style.display = "block";
      }
      return;
    }

    // User is authenticated and authorized: unlock app layout
    if (gateOverlay) gateOverlay.style.display = "none";
    if (topSignOutBtn) topSignOutBtn.style.display = "inline-flex";

    const name = user.displayName || user.email?.split("@")[0] || "Yönetici";
    if (userName) userName.textContent = name;
    if (userRole) userRole.textContent = "Google ile Doğrulandı";

    if (userAvatar) {
      if (user.photoURL) {
        userAvatar.innerHTML = `<img src="${user.photoURL}" alt="${name}" referrerpolicy="no-referrer" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
      } else {
        userAvatar.textContent = name.charAt(0).toUpperCase();
      }
    }

    const emailEl = document.getElementById("authCurrentUserEmail");
    if (emailEl) emailEl.textContent = user.email || "-";
  } else {
    // Unauthenticated: lock app down completely with Auth Gate
    if (gateOverlay) gateOverlay.style.display = "flex";
    if (topSignOutBtn) topSignOutBtn.style.display = "none";

    if (userName) userName.textContent = "Giriş Yapılmadı";
    if (userRole) userRole.textContent = "Erişim Kilitli";
    if (userAvatar) userAvatar.textContent = "?";
  }
});
