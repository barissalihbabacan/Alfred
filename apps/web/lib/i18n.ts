/**
 * UI language: English and Turkish dictionaries plus the current-language
 * store. Dependency-free and React-free (the hook is in `use-i18n.ts`), so the
 * lib helpers and the unit tests can import it.
 *
 * The choice is the user's saved one, else the browser language (tr* ->
 * Turkish, anything else -> English). The static export is prerendered in
 * DEFAULT_LANG; the client switches after hydration.
 *
 * Only the UI is translated: messages the server sends (SSE `error` texts,
 * `{ error }` bodies) arrive as they are.
 */

export type Lang = "en" | "tr";

export const LANGS: readonly Lang[] = ["en", "tr"];

/** Language of the prerendered HTML and of callers that pass none. */
export const DEFAULT_LANG: Lang = "en";

/** Locale for dates and case-insensitive search, per UI language. */
export const LOCALES: Record<Lang, string> = { en: "en-GB", tr: "tr-TR" };

/** Locale for voice input (SpeechRecognition), per UI language. */
export const SPEECH_LOCALES: Record<Lang, string> = { en: "en-US", tr: "tr-TR" };

const tr = {
  "app.title": "Alfred — Yönetici Yapay Zeka Asistanı",
  "app.tagline": "Kişisel Yapay Zeka ve Yönetici Asistanı",
  "app.sidebarTagline": "Kişisel Yapay Zeka Asistanı",
  "app.checkingSession": "Oturum doğrulanıyor...",

  "lang.label": "Dil",
  "lang.switchTo": "Arayüz dilini değiştir",

  "login.badge": "Özel · Tek Kullanıcı",
  "login.intro": "Kişisel yapay zeka asistanınıza ve sesli etkileşim sistemine erişmek için lütfen kimliğinizi doğrulayın.",
  "login.fixSteps": "⚙️ Çözüm Adımları (1 Dakika):",
  "login.fixStep1": "**Firebase Console > Authentication > Sign-in method** sekmesini açın.",
  "login.fixStep2": "**Google** seçeneğine tıklayıp **Enable (Etkinleştir)** yapın.",
  "login.fixStep3": "Proje destek e-postasını seçip **Save (Kaydet)** butonuna tıklayın.",
  "login.openConsole": "Firebase Console Sağlayıcılar Sayfasına Git",
  "login.serverResponse": "Sunucu Yanıtı: {details}",
  "login.errorCode": "Hata Kodu: {code}",
  "login.redirecting": "Google'a Yönlendiriliyor...",
  "login.signingIn": "Giriş Yapılıyor...",
  "login.signInGoogle": "Google ile Giriş Yap",
  "login.redirectTitle": "Safari veya tarayıcı engeli varsa doğrudan sayfayı yönlendirerek giriş yapın",
  "login.redirectPrefix": "Safari veya açılır pencere engeli yaşıyorsanız:",
  "login.redirectAction": "Doğrudan Yönlendirme ile Giriş",
  "login.footer": "Yalnızca yetkili Google hesabı giriş yapabilir",

  "auth.missingState.title": "Tarayıcı Oturum/Gizlilik Engeli",
  "auth.missingState.message": "Tarayıcınızın çerez ve oturum kısıtlaması (özellikle Safari 'Siteler arası takibi engelle' veya gizli sekme) oturum açma durumunu engelledi. Lütfen sayfayı yenileyip tekrar giriş yapmayı deneyin.",
  "auth.unauthorizedUid.title": "Yetkisiz Kullanıcı (Erişim Reddedildi)",
  "auth.unauthorizedUid.message": "Bu sisteme yalnızca yetkili yönetici erişebilir. Giriş yaptığınız hesap yetkilendirilmemiştir.",
  "auth.popupClosed.title": "Giriş Penceresi Kapatıldı",
  "auth.popupClosed.message": "Google kimlik doğrulama penceresi işlem tamamlanmadan kapatıldı. Lütfen tekrar deneyin.",
  "auth.popupBlocked.title": "Açılır Pencere Engellendi",
  "auth.popupBlocked.message": "Tarayıcınız Google giriş penceresini engelledi. Lütfen adres çubuğundaki bildirimden açılır pencerelere (pop-up) izin verip tekrar deneyin.",
  "auth.cancelledPopup.title": "İstek Yenilendi",
  "auth.cancelledPopup.message": "Aynı anda birden fazla giriş denemesi yapıldığı için önceki istek iptal edildi.",
  "auth.unauthorizedDomain.title": "Yetkisiz Alan Adı",
  "auth.unauthorizedDomain.message": "Bu alan adı (domain) Firebase Console > Authentication > Settings > Authorized Domains listesine eklenmemiş.",
  "auth.operationNotAllowed.title": "Google ile Giriş Henüz Etkin Değil",
  "auth.operationNotAllowed.message": "Firebase Console üzerinde Google ile giriş sağlayıcısı etkinleştirilmemiş. Firebase Console > Authentication > Sign-in method sekmesinden 'Google' sağlayıcısını 'Enable' durumuna getirmeniz gerekmektedir.",
  "auth.network.title": "Bağlantı Hatası",
  "auth.network.message": "İnternet bağlantısı kurulamadı. Lütfen ağ bağlantınızı kontrol edin ve tekrar deneyin.",
  "auth.userDisabled.title": "Hesap Devre Dışı",
  "auth.userDisabled.message": "Bu kullanıcı hesabı güvenlik nedeniyle devre dışı bırakılmıştır.",
  "auth.differentCredential.title": "Farklı Giriş Yöntemi",
  "auth.differentCredential.message": "Bu e-posta adresi başka bir yöntemle önceden kaydedilmiş. Lütfen o yöntemle giriş yapın.",
  "auth.tooManyRequests.title": "Çok Fazla Deneme",
  "auth.tooManyRequests.message": "Kısa sürede çok fazla başarısız deneme yapıldı. Güvenliğiniz için lütfen birkaç dakika sonra tekrar deneyin.",
  "auth.internal.title": "Sunucu Hatası",
  "auth.internal.message": "Kimlik doğrulama sunucusunda geçici bir hata oluştu. Lütfen tekrar deneyin.",
  "auth.unknown.title": "İşlem Başarısız Oldu",
  "auth.unknown.message": "Kimlik doğrulama işlemi sırasında beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.",

  "api.notSignedIn": "Oturum henüz doğrulanmadı.",
  "api.serverError": "Sunucu hatası ({status})",

  "googleCallback.providerError": "Google yetkilendirme hatası: {error}",
  "googleCallback.missingCode": "Yetkilendirme kodu (code) bulunamadı.",
  "googleCallback.failed": "Google hesabı bağlanırken bir hata oluştu.",
  "googleCallback.noSession": "Alfred oturumunuz bulunamadı. Lütfen önce uygulamaya giriş yapın.",
  "googleCallback.verifying": "Google Hesabı Doğrulanıyor",
  "googleCallback.saving": "Takvim ve Görev izinleri kaydediliyor, lütfen bekleyin…",
  "googleCallback.success": "Bağlantı Başarılı!",
  "googleCallback.successDetail": "Google Takvim ve Görevler başarıyla bağlandı. Yönlendiriliyorsunuz…",
  "googleCallback.errorTitle": "Bağlantı Kurulamadı",
  "googleCallback.home": "Ana Sayfaya Dön",
  "googleCallback.loading": "Yükleniyor…",

  "state.idle": "Hazır",
  "state.noModelKey": "Model anahtarı yok",
  "state.listening": "Dinliyor",
  "state.transcribing": "Çözümleniyor",
  "state.thinking": "Düşünüyor",
  "state.streaming": "Yanıtlıyor",
  "state.error": "Hata",
  "state.title": "Durum: {state}",

  "memoryType.preference": "Tercih",
  "memoryType.technicalPreference": "Teknik Tercih",
  "memoryType.project": "Proje",
  "memoryType.architecturalDecision": "Mimari Karar",
  "memoryType.personal": "Kişisel",
  "memoryType.decision": "Karar",
  "memoryType.workflow": "İş Akışı",
  "memoryType.constraint": "Kısıt",
  "memoryType.relationship": "İlişki",
  "memoryType.general": "Genel",
  "memoryType.option.projectFact": "Proje Bilgisi",
  "memoryType.option.personalFact": "Kişisel Bilgi",
  "memoryType.filter.all": "Tümü",
  "memoryType.filter.technical": "Teknik",
  "memoryType.filter.architecture": "Mimari",

  "tool.status.webSearch": "Web'de aranıyor…",
  "tool.status.readUrl": "Sayfa okunuyor…",
  "tool.status.github": "GitHub inceleniyor…",
  "tool.status.calendar": "Takvim inceleniyor…",
  "tool.status.tasks": "Görevler güncelleniyor…",
  "tool.status.gmail": "E-postalar taranıyor…",
  "tool.badge.webSearch": "Web Araması",
  "tool.badge.readUrl": "Bağlantı",
  "tool.badge.calendar": "Google Takvim",
  "tool.badge.tasks": "Google Görevler",
  "tool.badge.time": "Sistem Zamanı",
  "tool.badge.error": "{tool} (Hata)",
  "tool.badge.running": "{tool} (Çalışıyor...)",
  "tool.badge.success": "{tool} (Başarılı)",

  "rateLimit.waiting": "{name} sınırına ulaşıldı, ~{seconds} sn bekleniyor…",
  "rateLimit.retrying": "{name} sınırına ulaşıldı, yeniden deneniyor…",

  "fallback.switch": "{from} {what}, {to} geçiliyor…",
  "fallback.sameProvider": "{from} {what}, başka bir {to} modeli deneniyor…",
  "fallback.reason.rateLimited": "sınıra ulaştı",
  "fallback.reason.serverError": "hata verdi",
  "fallback.reason.noResponse": "yanıt vermedi",
  "fallback.reason.streamError": "yanıtı tamamlayamadı",
  "fallback.reason.clientError": "isteği reddetti",
  "fallback.reason.unavailable": "kullanılamıyor",

  "markdown.copy": "Kopyala",
  "markdown.copied": "Kopyalandı",
  "markdown.quote": "Taslak / Alıntı",

  "notify.unsupported": "Tarayıcınız bildirimleri desteklemiyor.",
  "notify.denied": "Bildirim izni verilmedi.",
  "notify.messagingUnsupported": "Firebase Messaging bu tarayıcıda desteklenmiyor.",
  "notify.swFailed": "Service Worker başlatılamadı.",
  "notify.noToken": "Cihaz bildirim anahtarı (FCM token) üretilemedi.",
  "notify.testTitle": "Alfred — Test Bildirimi",
  "notify.testBody": "Alfred bildirim sistemi cihazınızda başarıyla devrede!",
  "notify.testSent": "Test bildirimi gönderildi.",
  "notify.confirmTest": "Bildirimler bu cihazda aktif!\n\nCihazınıza anında bir test bildirimi göndermek istiyor musunuz?\n\n(İptal'e basarak bildirimleri bu cihazda kapatma seçeneğini görebilirsiniz)",
  "notify.confirmDisable": "Bildirimler bu cihaz için devre dışı bırakılsın mı?",
  "notify.removed": "Bildirim kaydı başarıyla kaldırıldı.",
  "notify.permissionFailed": "Bildirim izni alınamadı: {error}",
  "notify.unknownError": "Bilinmeyen hata",
  "notify.enabled": "Bildirimler başarıyla açıldı! Cihazınıza ilk test bildirimi gönderildi.",
  "notify.activeTitle": "Bildirimler aktif (Test için tıklayın)",
  "notify.enableTitle": "Bildirimleri etkinleştir",
  "notify.removeFailed": "Kaldırılamadı.",

  "common.error": "Hata: {message}",
  "common.cancel": "İptal",
  "common.close": "Kapat",
  "common.ok": "Tamam",
  "common.saving": "Kaydediliyor...",
  "common.opening": "Açılıyor…",
  "common.install": "Yükle",
  "common.active": "Aktif",
  "common.connected": "Bağlı",
  "common.serverUnreachable": "Sunucuya bağlanılamadı.",
  "common.source": "Kaynak",
  "common.sources": "Kaynaklar:",
  "common.userFallback": "Kullanıcı",
  "common.ownerFallback": "Yönetici",

  "conversation.new": "Yeni Sohbet",
  "conversation.search": "Sohbetlerde ara...",
  "conversation.clearSearch": "Aramayı temizle",
  "conversation.history": "Geçmiş Sohbetler",
  "conversation.projectHistory": "{project} Sohbetleri",
  "conversation.noMatch": "Eşleşen sohbet bulunamadı.",
  "conversation.noneInProject": "Bu projede henüz sohbet yok.",
  "conversation.none": "Henüz kayıtlı sohbet yok.",
  "conversation.rename": "Sohbeti Yeniden Adlandır",
  "conversation.delete": "Sohbeti Sil",
  "conversation.confirmDelete": "Bu sohbeti silmek istediğinizden emin misiniz?",
  "conversation.deleteFailed": "Sohbet silinirken bir hata oluştu.",

  "project.section": "Projeler",
  "project.create": "Yeni Proje Oluştur",
  "project.edit": "Projeyi Düzenle",
  "project.delete": "Projeyi Sil",
  "project.general": "Genel Çalışma Alanı",
  "project.fallbackName": "Proje",
  "project.confirmDelete": "\"{name}\" projesini ve bu projeye özel anıları silmek istediğinizden emin misiniz?",
  "project.saveFailed": "Proje kaydedilemedi.",
  "project.activeTitle": "Aktif Proje: {name} (Düzenlemek için tıklayın)",
  "project.openRepo": "GitHub Deposunu Aç: {url}",
  "project.intro": "Her projenin kendine özel sohbet geçmişi, mimari bağlamı ve diğer projelerden izole uzun süreli semantik belleği bulunur.",
  "project.name": "Proje Adı",
  "project.namePlaceholder": "Ör: Alfred, Otonom İHA, Finans API...",
  "project.repo": "GitHub Depo Bağlantısı (İsteğe Bağlı)",
  "project.instructions": "Proje Talimatları & Mimari Bağlam (İsteğe Bağlı)",
  "project.instructionsPlaceholder": "Ör: Next.js 16 + Firebase Cloud Functions + Firestore tabanlı proje. Kod örneklerinde TypeScript ve ESM kullan...",
  "project.color": "Renk Etiketi:",
  "project.colorLabel": "Renk {color}",
  "project.update": "Güncelle",
  "project.submitCreate": "Projeyi Oluştur",

  "sidebar.account": "Hesap Bilgileri",
  "sidebar.verified": "Google ile Doğrulandı",
  "sidebar.memory": "Uzun Süreli Bellek Yönetimi",
  "sidebar.settings": "Ayarlar",
  "sidebar.signOut": "Güvenli Çıkış Yap",
  "sidebar.toggle": "Kenar Çubuğunu Aç/Kapat",

  "model.selectTitle": "Model ve sağlayıcı seçin",
  "model.menuHeading": "Model & Sağlayıcı Seçimi",
  "model.noApiKey": "API anahtarı yok",

  "export.title": "Mevcut sohbeti Markdown (.md) dosyası olarak indir",
  "export.button": ".md İndir",
  "export.defaultTitle": "Alfred Sohbeti",
  "export.date": "Tarih",
  "export.project": "Proje",
  "export.slugFallback": "alfred-sohbet",

  "install.title": "Alfred'i telefona yükle (PWA)",

  "welcome.title": "Merhaba.",
  "welcome.subtitle": "Bugün ne üzerinde çalışıyoruz?",
  "welcome.briefing": "Sabah Brifingi Al",
  "welcome.briefingPrompt": "Günaydın Alfred, bugünün sabah brifingini hazırlar mısın?",
  "welcome.wrapUp": "Günü Kapat",
  "welcome.wrapUpPrompt": "Günü kapatalım Alfred, bugünün özetini, tamamlananları ve yarına kalanları çıkarır mısın?",

  "chat.cancel": "İptal",
  "chat.saveAndSend": "Kaydet ve Gönder",
  "chat.editMessage": "Mesajı Düzenle",
  "chat.thinking": "Düşünüyor...",
  "chat.copy": "Kopyala",
  "chat.copied": "Kopyalandı",
  "chat.inputLabel": "Alfred'e mesaj yazın",
  "chat.inputPlaceholder": "Alfred'e mesaj yazın...",
  "chat.voice": "Sesli Konuşma",
  "chat.stop": "Durdur",
  "chat.send": "Gönder",
  "chat.noStream": "Yanıt akışı alınamadı.",
  "chat.emptyReply": "*(Yanıt boş)*",
  "chat.streamError": "Akış sırasında bir hata oluştu.",
  "chat.closedEarly": "Bağlantı yanıt tamamlanmadan kapandı.",
  "chat.stoppedByUser": "*(Yanıt kullanıcı tarafından durduruldu)*",
  "chat.stopped": "*Yanıt durduruldu.*",
  "chat.commError": "İletişim sırasında bir hata oluştu.",
  "chat.speechUnsupported": "Tarayıcınız Web Speech API mikrofon girişini desteklemiyor.",

  "settings.title": "Sistem & Model Yapılandırması",
  "settings.intro": "Üst çubuktaki seçiciden istediğiniz modeli seçebilirsiniz; seçilen sağlayıcı yanıt veremezse istek otomatik olarak yedek sağlayıcı zincirine ({chain}) aktarılır.",
  "settings.engine": "Aktif Motor:",
  "settings.offline": "Çevrimdışı",
  "settings.noProvider": "Kullanılabilir yapay zeka sağlayıcısı yok",
  "settings.groqCloud": "Groq Bulut",
  "settings.engineOff": "Kapalı",
  "settings.engineUnknown": "Bilinmiyor",
  "settings.keys": "API Anahtarları:",
  "settings.keysDetail": "Groq ve Gemini anahtarları sunucuda Google Secret Manager'da tutulur; tarayıcıda saklanmaz.",
  "settings.language": "Arayüz Dili:",

  "memory.title": "Uzun Süreli Bellek",
  "memory.count": "{count} kayıt",
  "memory.subtitle": "Firestore + Gemini semantik vektör belleğinde saklanan aktif bilgiler",
  "memory.refresh": "Yenile",
  "memory.addTitle": "Manuel olarak yeni bellek kaydı ekle",
  "memory.add": "Anı Ekle",
  "memory.newLabel": "Yeni Bellek Kaydı (Doğrudan Vektörleştirilir)",
  "memory.placeholder": "Ör: {name} yeni TypeScript projelerinde paket yöneticisi olarak pnpm kullanmayı tercih ediyor.",
  "memory.scopeLabel": "Bellek kapsamı (proje)",
  "memory.globalScope": "🌐 Genel Bellek",
  "memory.categoryLabel": "Bellek kategorisi",
  "memory.supersede": "Benzer eski anıyı güncelle",
  "memory.save": "Belleğe Kaydet",
  "memory.searchLabel": "Bellekte ara",
  "memory.searchPlaceholder": "Bellek kayıtlarında ara (ör. tercih, proje, teknoloji)...",
  "memory.scope": "Kapsam:",
  "memory.allScopes": "Tüm Kapsamlar",
  "memory.empty": "Henüz kaydedilmiş aktif bir uzun süreli bellek bulunmuyor.",
  "memory.noMatch": "Arama veya filtreyle eşleşen bellek kaydı bulunamadı.",
  "memory.globalBadge": "🌐 Genel",
  "memory.forgetTitle": "Bu bellek kaydını sil (unut)",
  "memory.deleting": "Siliniyor...",
  "memory.forget": "Unut",
  "memory.saveFailed": "Anı kaydedilirken hata oluştu.",
  "memory.superseded": "Benzer eski anı güncellenerek yeni anı kaydedildi.",
  "memory.duplicate": "Bu bilgi zaten uzun süreli bellekte mevcut.",
  "memory.created": "Yeni anı vektörleştirilip belleğe kaydedildi.",

  "account.title": "Hesap Bilgileri",
  "account.activeUser": "Aktif Kullanıcı:",
  "account.google": "Google Workspace (Takvim, Görevler, Gmail)",
  "account.googleConnectedAs": "{email} bağlı",
  "account.googleConnected": "Bağlantı aktif",
  "account.googlePitch": "Tek tıkla bağlanın, Alfred ajandanızı ve e-postalarınızı yönetsin",
  "account.googleConnect": "Google'a Bağlan",
  "account.googleUrlFailed": "Google OAuth URL alınamadı.",
  "account.googleConfirmDisconnect": "Google Takvim ve Görevler bağlantısını kesmek istiyor musunuz?",
  "account.googleDisconnectFailed": "Bağlantı kesilemedi.",
  "account.googleDisconnect": "Bağlantıyı Kaldır",
  "account.push": "Anlık Bildirimler (FCM & PWA)",
  "account.pushReady": "Cihazınız bildirim almaya hazır",
  "account.pushPitch": "Görev, alarm ve arka plan bildirimleri için izni açın",
  "account.pushEnable": "Bildirimleri Aç",
  "account.pushTest": "Test Bildirimi Gönder",
  "account.pushDisable": "Bildirimleri Kapat",
  "account.pwa": "Telefon Uygulaması (PWA)",
  "account.pwaDetail": "Ana ekranınıza tam ekran Alfred uygulamasını kurun",
  "account.signOut": "Oturumu Kapat"
};

export type MessageKey = keyof typeof tr;

/** Every language has exactly the Turkish keys (a missing or extra key is a type error). */
export type Dictionary = Record<MessageKey, string>;

const en: Dictionary = {
  "app.title": "Alfred — Personal AI Executive Assistant",
  "app.tagline": "Personal AI and Executive Assistant",
  "app.sidebarTagline": "Personal AI Assistant",
  "app.checkingSession": "Checking your session...",

  "lang.label": "Language",
  "lang.switchTo": "Change the interface language",

  "login.badge": "Private · Single User",
  "login.intro": "Sign in to reach your personal AI assistant and its voice interface.",
  "login.fixSteps": "⚙️ How to fix it (1 minute):",
  "login.fixStep1": "Open **Firebase Console > Authentication > Sign-in method**.",
  "login.fixStep2": "Click **Google** and switch it to **Enable**.",
  "login.fixStep3": "Pick the project support email and click **Save**.",
  "login.openConsole": "Open the Firebase Console providers page",
  "login.serverResponse": "Server response: {details}",
  "login.errorCode": "Error code: {code}",
  "login.redirecting": "Redirecting to Google...",
  "login.signingIn": "Signing in...",
  "login.signInGoogle": "Sign in with Google",
  "login.redirectTitle": "If Safari or the browser blocks the pop-up, sign in by redirecting the page instead",
  "login.redirectPrefix": "Safari or a pop-up blocker in the way?",
  "login.redirectAction": "Sign in with a redirect",
  "login.footer": "Only the authorised Google account can sign in",

  "auth.missingState.title": "Browser Session/Privacy Block",
  "auth.missingState.message": "Your browser's cookie and session restrictions (notably Safari's 'Prevent cross-site tracking' or a private window) blocked the sign-in state. Please reload the page and sign in again.",
  "auth.unauthorizedUid.title": "Unauthorised User (Access Denied)",
  "auth.unauthorizedUid.message": "Only the authorised owner can use this system. The account you signed in with is not authorised.",
  "auth.popupClosed.title": "Sign-in Window Closed",
  "auth.popupClosed.message": "The Google sign-in window was closed before sign-in finished. Please try again.",
  "auth.popupBlocked.title": "Pop-up Blocked",
  "auth.popupBlocked.message": "Your browser blocked the Google sign-in window. Allow pop-ups from the notice in the address bar and try again.",
  "auth.cancelledPopup.title": "Request Replaced",
  "auth.cancelledPopup.message": "Several sign-in attempts were made at once, so the earlier request was cancelled.",
  "auth.unauthorizedDomain.title": "Unauthorised Domain",
  "auth.unauthorizedDomain.message": "This domain is not in Firebase Console > Authentication > Settings > Authorized Domains.",
  "auth.operationNotAllowed.title": "Google Sign-in Not Enabled Yet",
  "auth.operationNotAllowed.message": "The Google sign-in provider is not enabled in Firebase. Switch the 'Google' provider to 'Enable' under Firebase Console > Authentication > Sign-in method.",
  "auth.network.title": "Connection Error",
  "auth.network.message": "Could not connect to the internet. Please check your network connection and try again.",
  "auth.userDisabled.title": "Account Disabled",
  "auth.userDisabled.message": "This user account has been disabled for security reasons.",
  "auth.differentCredential.title": "Different Sign-in Method",
  "auth.differentCredential.message": "This email address is already registered with another method. Please sign in with that method.",
  "auth.tooManyRequests.title": "Too Many Attempts",
  "auth.tooManyRequests.message": "Too many failed attempts in a short time. For your security, please try again in a few minutes.",
  "auth.internal.title": "Server Error",
  "auth.internal.message": "The authentication server had a temporary error. Please try again.",
  "auth.unknown.title": "Something Went Wrong",
  "auth.unknown.message": "An unexpected error occurred during sign-in. Please try again.",

  "api.notSignedIn": "The session is not verified yet.",
  "api.serverError": "Server error ({status})",

  "googleCallback.providerError": "Google authorisation error: {error}",
  "googleCallback.missingCode": "No authorisation code was found.",
  "googleCallback.failed": "Something went wrong while connecting the Google account.",
  "googleCallback.noSession": "No Alfred session was found. Please sign in to the app first.",
  "googleCallback.verifying": "Verifying the Google Account",
  "googleCallback.saving": "Saving Calendar and Tasks permissions, please wait…",
  "googleCallback.success": "Connected!",
  "googleCallback.successDetail": "Google Calendar and Tasks are connected. Redirecting…",
  "googleCallback.errorTitle": "Could Not Connect",
  "googleCallback.home": "Back to the App",
  "googleCallback.loading": "Loading…",

  "state.idle": "Ready",
  "state.noModelKey": "No model key",
  "state.listening": "Listening",
  "state.transcribing": "Transcribing",
  "state.thinking": "Thinking",
  "state.streaming": "Replying",
  "state.error": "Error",
  "state.title": "Status: {state}",

  "memoryType.preference": "Preference",
  "memoryType.technicalPreference": "Technical Preference",
  "memoryType.project": "Project",
  "memoryType.architecturalDecision": "Architecture Decision",
  "memoryType.personal": "Personal",
  "memoryType.decision": "Decision",
  "memoryType.workflow": "Workflow",
  "memoryType.constraint": "Constraint",
  "memoryType.relationship": "Relationship",
  "memoryType.general": "General",
  "memoryType.option.projectFact": "Project Fact",
  "memoryType.option.personalFact": "Personal Fact",
  "memoryType.filter.all": "All",
  "memoryType.filter.technical": "Technical",
  "memoryType.filter.architecture": "Architecture",

  "tool.status.webSearch": "Searching the web…",
  "tool.status.readUrl": "Reading the page…",
  "tool.status.github": "Checking GitHub…",
  "tool.status.calendar": "Checking the calendar…",
  "tool.status.tasks": "Updating tasks…",
  "tool.status.gmail": "Scanning email…",
  "tool.badge.webSearch": "Web Search",
  "tool.badge.readUrl": "Link",
  "tool.badge.calendar": "Google Calendar",
  "tool.badge.tasks": "Google Tasks",
  "tool.badge.time": "System Time",
  "tool.badge.error": "{tool} (Failed)",
  "tool.badge.running": "{tool} (Running...)",
  "tool.badge.success": "{tool} (Done)",

  "rateLimit.waiting": "{name} rate limit reached, waiting ~{seconds} s…",
  "rateLimit.retrying": "{name} rate limit reached, retrying…",

  "fallback.switch": "{from} {what}, switching to {to}…",
  "fallback.sameProvider": "{from} {what}, trying another {to} model…",
  "fallback.reason.rateLimited": "hit its rate limit",
  "fallback.reason.serverError": "returned an error",
  "fallback.reason.noResponse": "did not respond",
  "fallback.reason.streamError": "could not finish the reply",
  "fallback.reason.clientError": "rejected the request",
  "fallback.reason.unavailable": "is unavailable",

  "markdown.copy": "Copy",
  "markdown.copied": "Copied",
  "markdown.quote": "Draft / Quote",

  "notify.unsupported": "Your browser does not support notifications.",
  "notify.denied": "Notification permission was not granted.",
  "notify.messagingUnsupported": "Firebase Messaging is not supported in this browser.",
  "notify.swFailed": "The service worker could not be started.",
  "notify.noToken": "Could not create a device notification token (FCM token).",
  "notify.testTitle": "Alfred — Test Notification",
  "notify.testBody": "Alfred notifications are working on this device.",
  "notify.testSent": "Test notification sent.",
  "notify.confirmTest": "Notifications are on for this device.\n\nSend a test notification now?\n\n(Press Cancel to see the option to turn notifications off on this device)",
  "notify.confirmDisable": "Turn notifications off for this device?",
  "notify.removed": "Notification registration removed.",
  "notify.permissionFailed": "Could not get notification permission: {error}",
  "notify.unknownError": "Unknown error",
  "notify.enabled": "Notifications are on. A first test notification was sent to this device.",
  "notify.activeTitle": "Notifications on (click to test)",
  "notify.enableTitle": "Turn on notifications",
  "notify.removeFailed": "Could not remove it.",

  "common.error": "Error: {message}",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.ok": "OK",
  "common.saving": "Saving...",
  "common.opening": "Opening…",
  "common.install": "Install",
  "common.active": "Active",
  "common.connected": "Connected",
  "common.serverUnreachable": "Could not reach the server.",
  "common.source": "Source",
  "common.sources": "Sources:",
  "common.userFallback": "User",
  "common.ownerFallback": "Owner",

  "conversation.new": "New Chat",
  "conversation.search": "Search chats...",
  "conversation.clearSearch": "Clear search",
  "conversation.history": "Recent Chats",
  "conversation.projectHistory": "{project} Chats",
  "conversation.noMatch": "No matching chats.",
  "conversation.noneInProject": "No chats in this project yet.",
  "conversation.none": "No saved chats yet.",
  "conversation.rename": "Rename Chat",
  "conversation.delete": "Delete Chat",
  "conversation.confirmDelete": "Delete this chat?",
  "conversation.deleteFailed": "Something went wrong while deleting the chat.",

  "project.section": "Projects",
  "project.create": "New Project",
  "project.edit": "Edit Project",
  "project.delete": "Delete Project",
  "project.general": "General Workspace",
  "project.fallbackName": "Project",
  "project.confirmDelete": "Delete the \"{name}\" project and the memories that belong to it?",
  "project.saveFailed": "The project could not be saved.",
  "project.activeTitle": "Active project: {name} (click to edit)",
  "project.openRepo": "Open the GitHub repository: {url}",
  "project.intro": "Each project has its own chat history, architecture context and long-term semantic memory, kept apart from other projects.",
  "project.name": "Project Name",
  "project.namePlaceholder": "e.g. Alfred, Autonomous UAV, Finance API...",
  "project.repo": "GitHub Repository Link (Optional)",
  "project.instructions": "Project Instructions & Architecture Context (Optional)",
  "project.instructionsPlaceholder": "e.g. A Next.js 16 + Firebase Cloud Functions + Firestore project. Use TypeScript and ESM in code examples...",
  "project.color": "Colour Tag:",
  "project.colorLabel": "Colour {color}",
  "project.update": "Update",
  "project.submitCreate": "Create Project",

  "sidebar.account": "Account",
  "sidebar.verified": "Verified with Google",
  "sidebar.memory": "Long-Term Memory",
  "sidebar.settings": "Settings",
  "sidebar.signOut": "Sign Out",
  "sidebar.toggle": "Toggle Sidebar",

  "model.selectTitle": "Choose a model and provider",
  "model.menuHeading": "Model & Provider",
  "model.noApiKey": "No API key",

  "export.title": "Download this chat as a Markdown (.md) file",
  "export.button": "Download .md",
  "export.defaultTitle": "Alfred Chat",
  "export.date": "Date",
  "export.project": "Project",
  "export.slugFallback": "alfred-chat",

  "install.title": "Install Alfred on your phone (PWA)",

  "welcome.title": "Hello.",
  "welcome.subtitle": "What are we working on today?",
  "welcome.briefing": "Morning Briefing",
  "welcome.briefingPrompt": "Good morning, Alfred. Could you put together today's morning briefing?",
  "welcome.wrapUp": "Wrap Up the Day",
  "welcome.wrapUpPrompt": "Let's wrap up the day, Alfred. Could you summarise today, what got done and what carries over to tomorrow?",

  "chat.cancel": "Cancel",
  "chat.saveAndSend": "Save and Send",
  "chat.editMessage": "Edit Message",
  "chat.thinking": "Thinking...",
  "chat.copy": "Copy",
  "chat.copied": "Copied",
  "chat.inputLabel": "Message Alfred",
  "chat.inputPlaceholder": "Message Alfred...",
  "chat.voice": "Voice Input",
  "chat.stop": "Stop",
  "chat.send": "Send",
  "chat.noStream": "No response stream was received.",
  "chat.emptyReply": "*(Empty reply)*",
  "chat.streamError": "Something went wrong during the stream.",
  "chat.closedEarly": "The connection closed before the reply was complete.",
  "chat.stoppedByUser": "*(Reply stopped by the user)*",
  "chat.stopped": "*Reply stopped.*",
  "chat.commError": "Something went wrong while talking to the server.",
  "chat.speechUnsupported": "Your browser does not support microphone input through the Web Speech API.",

  "settings.title": "System & Model Settings",
  "settings.intro": "Pick a model from the selector in the top bar; if the chosen provider cannot answer, the request moves to the fallback chain ({chain}) automatically.",
  "settings.engine": "Active Engine:",
  "settings.offline": "Offline",
  "settings.noProvider": "No AI provider is available",
  "settings.groqCloud": "Groq Cloud",
  "settings.engineOff": "Off",
  "settings.engineUnknown": "Unknown",
  "settings.keys": "API Keys:",
  "settings.keysDetail": "The Groq and Gemini keys are kept on the server in Google Secret Manager; the browser never stores them.",
  "settings.language": "Interface Language:",

  "memory.title": "Long-Term Memory",
  "memory.count": "{count} entries",
  "memory.subtitle": "Active facts stored in the Firestore + Gemini semantic vector memory",
  "memory.refresh": "Refresh",
  "memory.addTitle": "Add a memory entry by hand",
  "memory.add": "Add Memory",
  "memory.newLabel": "New Memory Entry (Embedded Right Away)",
  "memory.placeholder": "e.g. {name} prefers pnpm as the package manager in new TypeScript projects.",
  "memory.scopeLabel": "Memory scope (project)",
  "memory.globalScope": "🌐 General Memory",
  "memory.categoryLabel": "Memory category",
  "memory.supersede": "Update a similar older memory",
  "memory.save": "Save to Memory",
  "memory.searchLabel": "Search memory",
  "memory.searchPlaceholder": "Search memory entries (e.g. preference, project, technology)...",
  "memory.scope": "Scope:",
  "memory.allScopes": "All Scopes",
  "memory.empty": "There are no active long-term memories yet.",
  "memory.noMatch": "No memory entries match the search or filter.",
  "memory.globalBadge": "🌐 General",
  "memory.forgetTitle": "Delete (forget) this memory entry",
  "memory.deleting": "Deleting...",
  "memory.forget": "Forget",
  "memory.saveFailed": "Something went wrong while saving the memory.",
  "memory.superseded": "The similar older memory was updated and the new one saved.",
  "memory.duplicate": "This is already in long-term memory.",
  "memory.created": "The new memory was embedded and saved.",

  "account.title": "Account",
  "account.activeUser": "Signed in as:",
  "account.google": "Google Workspace (Calendar, Tasks, Gmail)",
  "account.googleConnectedAs": "{email} connected",
  "account.googleConnected": "Connection active",
  "account.googlePitch": "Connect in one click so Alfred can manage your calendar and email",
  "account.googleConnect": "Connect Google",
  "account.googleUrlFailed": "Could not get the Google OAuth URL.",
  "account.googleConfirmDisconnect": "Disconnect Google Calendar and Tasks?",
  "account.googleDisconnectFailed": "Could not disconnect.",
  "account.googleDisconnect": "Disconnect",
  "account.push": "Push Notifications (FCM & PWA)",
  "account.pushReady": "This device is ready to receive notifications",
  "account.pushPitch": "Allow notifications for tasks, alarms and background updates",
  "account.pushEnable": "Turn On",
  "account.pushTest": "Send Test Notification",
  "account.pushDisable": "Turn Off Notifications",
  "account.pwa": "Phone App (PWA)",
  "account.pwaDetail": "Install Alfred full-screen on your home screen",
  "account.signOut": "Sign Out"
};

export const DICTIONARIES: Record<Lang, Dictionary> = { en, tr };

/** Name shown on the language toggle, in that language. */
export const LANG_NAMES: Record<Lang, string> = { en: "English", tr: "Türkçe" };

export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "tr";
}

/** The dictionary text for `key`, with `{name}` placeholders filled from `vars`. */
export function translate(lang: Lang, key: MessageKey, vars?: Record<string, string | number>): string {
  const text = DICTIONARIES[lang][key];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
  );
}

/** Saved choice first, else the browser language: tr* -> Turkish, anything else -> English. */
export function detectLang(saved: string | null | undefined, browserLanguages: readonly string[]): Lang {
  if (isLang(saved)) return saved;
  const first = browserLanguages.find((l) => typeof l === "string" && l.length > 0);
  return first && /^tr\b/i.test(first) ? "tr" : "en";
}

// --- Current language (one per page) ---------------------------------------

const STORAGE_KEY = "alfred_ui_lang";

let currentLang: Lang | null = null;
const listeners = new Set<() => void>();

function readSavedLang(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function browserLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) return [...navigator.languages];
  return navigator.language ? [navigator.language] : [];
}

/** The page's language; DEFAULT_LANG outside a browser. */
export function getLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  if (currentLang === null) currentLang = detectLang(readSavedLang(), browserLanguages());
  return currentLang;
}

/** Switches the page's language and remembers the choice in this browser. */
export function setLang(lang: Lang): void {
  if (lang === currentLang) return;
  currentLang = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Gizli sekme / engellenmis depolama: secim yalnizca bu sayfada gecerli.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeLang(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
