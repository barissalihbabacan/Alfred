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
  RecaptchaVerifier
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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

window.handleSignOut = async function() {
  try {
    await signOut(auth);
    showAuthAlert("Oturum başarıyla kapatıldı.", "info");
    switchAuthTab("login");
    setTimeout(() => closeAuthModal(), 500);
  } catch (err) {
    showAuthAlert(formatAuthError(err), "error");
  }
};

// Listen to Firebase Auth State Changes
onAuthStateChanged(auth, (user) => {
  const tabMfaBtn = document.getElementById("tabMfaBtn");
  const tabLoginBtn = document.getElementById("tabLoginBtn");
  const tabRegBtn = document.getElementById("tabRegisterBtn");

  if (user) {
    if (tabMfaBtn) tabMfaBtn.style.display = "inline-block";
    if (tabLoginBtn) tabLoginBtn.style.display = "none";
    if (tabRegBtn) tabRegBtn.style.display = "none";
    document.getElementById("authCurrentUserEmail").textContent = user.email || "-";
    updateMfaUiState(user);
  } else {
    if (tabMfaBtn) tabMfaBtn.style.display = "none";
    if (tabLoginBtn) tabLoginBtn.style.display = "inline-block";
    if (tabRegBtn) tabRegBtn.style.display = "inline-block";
    updateMfaUiState(null);
  }
});
