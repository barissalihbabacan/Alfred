import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
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
  GoogleAuthProvider,
  signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const currentHost = typeof window !== "undefined" ? window.location.hostname : "";
const resolvedAuthDomain =
  currentHost && (currentHost.endsWith(".web.app") || currentHost.endsWith(".firebaseapp.com"))
    ? currentHost
    : "butler-alfred.firebaseapp.com";

const firebaseConfig = {
  apiKey: "AIzaSyB2v-fk_DTVTRu4s2yuxScH-c9gSdNcRGQ",
  authDomain: resolvedAuthDomain,
  projectId: "butler-alfred",
  storageBucket: "butler-alfred.firebasestorage.app",
  messagingSenderId: "653487811677",
  appId: "1:653487811677:web:1b53984d38a210428a31b4"
};

const app = initializeApp(firebaseConfig);
window.firebaseApp = app;

// Set App Check debug token on localhost/127.0.0.1 to prevent 401 pat errors
if (
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
   window.location.hostname === "127.0.0.1")
) {
  // @ts-ignore
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}

// Initialize App Check
try {
  const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider("6Lfkr68tAAAAAKOEJoZyf11tapRzOI1LP4Er6AmL"),
    isTokenAutoRefreshEnabled: true
  });
  window.firebaseAppCheck = appCheck;
  window.getAppCheckToken = async () => {
    try {
      const tokenResult = await getToken(appCheck, /* forceRefresh */ false);
      return tokenResult?.token || null;
    } catch (e) {
      console.warn("[AppCheck] Token acquisition failed:", e);
      return null;
    }
  };
} catch (err) {
  console.warn("[AppCheck] Initialization skipped:", err);
}

// Initialize Firebase Auth
const auth = getAuth(app);
window.firebaseAuth = auth;

let mfaResolver = null;
let mfaVerificationId = null;
let enrollVerificationId = null;
let phoneRecaptchaVerifier = null;

function getOrCreateRecaptchaVerifier() {
  if (!phoneRecaptchaVerifier) {
    phoneRecaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-verifier-container", {
      size: "invisible",
      callback: () => {}
    });
  }
  return phoneRecaptchaVerifier;
}

function showAuthAlert(msg, type = "info") {
  const el = document.getElementById("authAlert");
  if (!el) return;
  el.className = `auth-alert ${type}`;
  el.textContent = msg;
}

function clearAuthAlert() {
  const el = document.getElementById("authAlert");
  if (el) {
    el.className = "auth-alert";
    el.textContent = "";
  }
}

function formatAuthError(err) {
  if (!err || !err.code) return err?.message || "Bilinmeyen bir kimlik doğrulama hatası oluştu.";
  switch (err.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Geçersiz e-posta veya şifre.";
    case "auth/email-already-in-use":
      return "Bu e-posta adresi zaten kullanımda.";
    case "auth/weak-password":
      return "Şifre en az 6 karakter olmalıdır.";
    case "auth/invalid-verification-code":
      return "Hatalı SMS doğrulama kodu. Lütfen tekrar deneyin.";
    case "auth/too-many-requests":
      return "Çok fazla başarısız deneme yapıldı. Lütfen daha sonra tekrar deneyin.";
    default:
      return err.message || err.code;
  }
}

function updateMfaUiState(user) {
  const statusBadge = document.getElementById("authMfaStatusBadge");
  const userRole = document.getElementById("sidebarUserRole");
  const userAvatar = document.getElementById("sidebarUserAvatar");
  const userName = document.getElementById("sidebarUserName");

  if (user) {
    const email = user.email || "Kullanıcı";
    const initial = email.charAt(0).toUpperCase();
    if (userAvatar) userAvatar.textContent = initial;
    if (userName) userName.textContent = user.displayName || email.split("@")[0];

    const enrolled = multiFactor(user).enrolledFactors || [];
    const hasMfa = enrolled.some(f => f.factorId === PhoneMultiFactorGenerator.FACTOR_ID);

    if (hasMfa) {
      if (statusBadge) {
        statusBadge.className = "mfa-badge active";
        statusBadge.textContent = "● Aktif (SMS Korumalı)";
      }
      if (userRole) userRole.textContent = "MFA Korumalı";
    } else {
      if (statusBadge) {
        statusBadge.className = "mfa-badge inactive";
        statusBadge.textContent = "○ Pasif (SMS Eklenmedi)";
      }
      if (userRole) userRole.textContent = "Standart Giriş";
    }
  } else {
    if (userAvatar) userAvatar.textContent = "?";
    if (userName) userName.textContent = "Misafir";
    if (userRole) userRole.textContent = "Giriş Yapmak İçin Tıklayın";
  }
}

// Window Exposure for Auth Actions
window.openAuthModal = function() {
  clearAuthAlert();
  const user = auth.currentUser;
  if (user) {
    document.getElementById("authCurrentUserEmail").textContent = user.email || "-";
    updateMfaUiState(user);
    switchAuthTab("mfa");
  } else {
    switchAuthTab("login");
  }
  document.getElementById("authModal").classList.add("open");
};

window.closeAuthModal = function() {
  document.getElementById("authModal").classList.remove("open");
  clearAuthAlert();
  if (mfaResolver) cancelMfaChallenge();
};

window.switchAuthTab = function(tab) {
  clearAuthAlert();
  const loginPane = document.getElementById("authLoginPane");
  const regPane = document.getElementById("authRegisterPane");
  const mfaPane = document.getElementById("authMfaManagePane");
  const challengePane = document.getElementById("authMfaChallengePane");
  const tabsNav = document.getElementById("authTabsNav");
  const tabLoginBtn = document.getElementById("tabLoginBtn");
  const tabRegBtn = document.getElementById("tabRegisterBtn");
  const tabMfaBtn = document.getElementById("tabMfaBtn");

  tabsNav.style.display = "flex";
  challengePane.style.display = "none";
  tabLoginBtn.classList.remove("active");
  tabRegBtn.classList.remove("active");
  tabMfaBtn.classList.remove("active");

  loginPane.style.display = "none";
  regPane.style.display = "none";
  mfaPane.style.display = "none";

  if (tab === "login") {
    loginPane.style.display = "block";
    tabLoginBtn.classList.add("active");
  } else if (tab === "register") {
    regPane.style.display = "block";
    tabRegBtn.classList.add("active");
  } else if (tab === "mfa") {
    mfaPane.style.display = "block";
    tabMfaBtn.classList.add("active");
  }
};

window.cancelMfaChallenge = function() {
  mfaResolver = null;
  mfaVerificationId = null;
  document.getElementById("authMfaChallengePane").style.display = "none";
  document.getElementById("authTabsNav").style.display = "flex";
  switchAuthTab("login");
};

window.handleLoginSubmit = async function() {
  const email = document.getElementById("loginEmailInput").value.trim();
  const pass = document.getElementById("loginPasswordInput").value.trim();
  if (!email || !pass) {
    showAuthAlert("Lütfen e-posta ve şifrenizi girin.", "error");
    return;
  }
  const btn = document.getElementById("loginSubmitBtn");
  btn.disabled = true;
  btn.textContent = "Giriş yapılıyor...";
  clearAuthAlert();

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    showAuthAlert("Giriş başarılı! Hoş geldiniz.", "success");
    setTimeout(() => closeAuthModal(), 700);
  } catch (err) {
    if (err.code === "auth/multi-factor-auth-required") {
      // Trigger MFA Challenge
      mfaResolver = getMultiFactorResolver(auth, err);
      const phoneHint = mfaResolver.hints.find(h => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID);
      if (!phoneHint) {
        showAuthAlert("Hesapta kayıtlı telefon numarası bulunamadı.", "error");
        return;
      }
      document.getElementById("mfaMaskedPhone").textContent = phoneHint.phoneNumber || "telefonunuza";
      showAuthAlert("SMS doğrulama kodu gönderiliyor...", "info");

      try {
        const verifier = getOrCreateRecaptchaVerifier();
        const phoneProvider = new PhoneAuthProvider(auth);
        mfaVerificationId = await phoneProvider.verifyPhoneNumber({
          multiFactorHint: phoneHint,
          session: mfaResolver.session
        }, verifier);

        document.getElementById("authTabsNav").style.display = "none";
        document.getElementById("authLoginPane").style.display = "none";
        document.getElementById("authMfaChallengePane").style.display = "block";
        showAuthAlert("Doğrulama kodu telefonunuza SMS olarak iletildi.", "success");
      } catch (phoneErr) {
        showAuthAlert("SMS gönderimi başarısız: " + formatAuthError(phoneErr), "error");
      }
    } else {
      showAuthAlert(formatAuthError(err), "error");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Giriş Yap";
  }
};

window.handleMfaChallengeSubmit = async function() {
  const code = document.getElementById("mfaChallengeCodeInput").value.trim();
  if (!code || code.length < 6) {
    showAuthAlert("Lütfen 6 haneli SMS kodunu girin.", "error");
    return;
  }
  const btn = document.getElementById("mfaChallengeSubmitBtn");
  btn.disabled = true;
  btn.textContent = "Doğrulanıyor...";
  try {
    const cred = PhoneAuthProvider.credential(mfaVerificationId, code);
    const assertion = PhoneMultiFactorGenerator.assertion(cred);
    await mfaResolver.resolveSignIn(assertion);
    showAuthAlert("SMS MFA doğrulaması başarılı! Giriş yapıldı.", "success");
    setTimeout(() => {
      cancelMfaChallenge();
      closeAuthModal();
    }, 700);
  } catch (err) {
    showAuthAlert(formatAuthError(err), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Kodu Doğrula & Giriş Yap";
  }
};

window.handleRegisterSubmit = async function() {
  const email = document.getElementById("regEmailInput").value.trim();
  const pass = document.getElementById("regPasswordInput").value.trim();
  if (!email || !pass || pass.length < 6) {
    showAuthAlert("Şifre en az 6 karakter olmalıdır.", "error");
    return;
  }
  const btn = document.getElementById("registerSubmitBtn");
  btn.disabled = true;
  btn.textContent = "Hesap oluşturuluyor...";
  try {
    await createUserWithEmailAndPassword(auth, email, pass);
    showAuthAlert("Hesap başarıyla oluşturuldu! Şimdi SMS MFA ekleyebilirsiniz.", "success");
    switchAuthTab("mfa");
  } catch (err) {
    showAuthAlert(formatAuthError(err), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Hesap Oluştur";
  }
};

window.handleStartEnrollment = async function() {
  const phone = document.getElementById("enrollPhoneInput").value.trim();
  if (!phone || phone.length < 9) {
    showAuthAlert("Lütfen geçerli bir telefon numarası girin (+90...)", "error");
    return;
  }
  const btn = document.getElementById("sendEnrollCodeBtn");
  btn.disabled = true;
  btn.textContent = "SMS gönderiliyor...";
  try {
    const session = await multiFactor(auth.currentUser).getSession();
    const verifier = getOrCreateRecaptchaVerifier();
    const phoneProvider = new PhoneAuthProvider(auth);
    enrollVerificationId = await phoneProvider.verifyPhoneNumber({
      phoneNumber: phone,
      session
    }, verifier);
    document.getElementById("enrollVerifyGroup").style.display = "block";
    showAuthAlert("Onay kodu telefonunuza SMS olarak iletildi.", "success");
  } catch (err) {
    showAuthAlert("SMS gönderilemedi: " + formatAuthError(err), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "SMS Onay Kodu Gönder";
  }
};

window.handleConfirmEnrollment = async function() {
  const code = document.getElementById("enrollCodeInput").value.trim();
  if (!code || code.length < 6) {
    showAuthAlert("Lütfen 6 haneli kodu girin.", "error");
    return;
  }
  const btn = document.getElementById("confirmEnrollBtn");
  btn.disabled = true;
  btn.textContent = "Doğrulanıyor...";
  try {
    const cred = PhoneAuthProvider.credential(enrollVerificationId, code);
    const assertion = PhoneMultiFactorGenerator.assertion(cred);
    await multiFactor(auth.currentUser).enroll(assertion, "Kişisel Telefon");
    showAuthAlert("Tebrikler! SMS Çok Faktörlü Doğrulama (MFA) başarıyla etkinleştirildi.", "success");
    document.getElementById("enrollVerifyGroup").style.display = "none";
    updateMfaUiState(auth.currentUser);
  } catch (err) {
    showAuthAlert(formatAuthError(err), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "MFA'yı Doğrula ve Etkinleştir";
  }
};

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

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
    default:
      return {
        code: code || "unknown_error",
        title: "İşlem Başarısız Oldu",
        message: rawMsg || "Kimlik doğrulama işlemi sırasında beklenmeyen bir hata oluştu."
      };
  }
}

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
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.error("[Auth] Google Sign-In error:", err);
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
      errBox.innerHTML = `
        <div class="auth-error-header">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <span>${details.title}</span>
          <button onclick="document.getElementById('gateAuthError').style.display='none'" class="auth-error-close" title="Kapat">✕</button>
        </div>
        <div class="auth-error-desc">${details.message}</div>
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
onAuthStateChanged(auth, (user) => {
  const gateOverlay = document.getElementById("authGateOverlay");
  const topSignOutBtn = document.getElementById("topSignOutBtn");
  const userAvatar = document.getElementById("sidebarUserAvatar");
  const userName = document.getElementById("sidebarUserName");
  const userRole = document.getElementById("sidebarUserRole");
  const tabMfaBtn = document.getElementById("tabMfaBtn");
  const tabLoginBtn = document.getElementById("tabLoginBtn");
  const tabRegBtn = document.getElementById("tabRegisterBtn");

  if (user) {
    // User is authenticated: unlock app layout
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

    if (tabMfaBtn) tabMfaBtn.style.display = "inline-block";
    if (tabLoginBtn) tabLoginBtn.style.display = "none";
    if (tabRegBtn) tabRegBtn.style.display = "none";
    const emailEl = document.getElementById("authCurrentUserEmail");
    if (emailEl) emailEl.textContent = user.email || "-";
    updateMfaUiState(user);
  } else {
    // Unauthenticated: lock app down completely with Auth Gate
    if (gateOverlay) gateOverlay.style.display = "flex";
    if (topSignOutBtn) topSignOutBtn.style.display = "none";

    if (userName) userName.textContent = "Giriş Yapılmadı";
    if (userRole) userRole.textContent = "Erişim Kilitli";
    if (userAvatar) userAvatar.textContent = "?";

    if (tabMfaBtn) tabMfaBtn.style.display = "none";
    if (tabLoginBtn) tabLoginBtn.style.display = "inline-block";
    if (tabRegBtn) tabRegBtn.style.display = "inline-block";
    updateMfaUiState(null);
  }
});

