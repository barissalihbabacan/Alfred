//! English and Turkish copy for the wizard, plus translations of the
//! validator messages that `alfred-setup-core` returns in English.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    En,
    Tr,
}

impl Lang {
    /// Turkish when the locale environment says so, English otherwise.
    pub fn from_env() -> Self {
        let locale = ["LC_ALL", "LC_MESSAGES", "LANG"]
            .iter()
            .find_map(|name| std::env::var(name).ok().filter(|v| !v.is_empty()))
            .unwrap_or_default();
        Self::from_code(&locale)
    }

    pub fn from_code(code: &str) -> Self {
        if code.to_lowercase().starts_with("tr") {
            Lang::Tr
        } else {
            Lang::En
        }
    }

    pub fn toggled(self) -> Self {
        match self {
            Lang::En => Lang::Tr,
            Lang::Tr => Lang::En,
        }
    }

    pub fn texts(self) -> &'static Texts {
        match self {
            Lang::En => &EN,
            Lang::Tr => &TR,
        }
    }
}

pub struct Texts {
    pub title: &'static str,
    pub lang_badge: &'static str,
    pub steps: [&'static str; 5],
    pub footer_form: &'static str,
    pub footer_review: &'static str,
    pub footer_deploy: &'static str,
    pub footer_done: &'static str,
    pub footer_failed: &'static str,
    pub fix_field: &'static str,
    pub quit_confirm: &'static str,

    pub project_heading: &'static str,
    pub project_intro: &'static str,
    pub project_id: &'static str,
    pub project_id_placeholder: &'static str,
    pub project_id_hint: &'static str,
    pub billing: &'static str,
    pub billing_hint: &'static str,
    pub billing_loading: &'static str,
    pub billing_none: &'static str,
    pub billing_failed: &'static str,
    pub region: &'static str,
    pub region_hint: &'static str,

    pub account_heading: &'static str,
    pub account_intro: &'static str,
    pub email: &'static str,
    pub email_placeholder: &'static str,
    pub uid: &'static str,
    pub uid_hint: &'static str,

    pub keys_heading: &'static str,
    pub keys_intro: &'static str,
    pub chain_note: &'static str,
    pub key_evren: &'static str,
    pub key_evren_hint: &'static str,
    pub key_groq: &'static str,
    pub key_groq_hint: &'static str,
    pub key_gemini: &'static str,
    pub key_gemini_hint: &'static str,
    pub key_tavily: &'static str,
    pub key_tavily_hint: &'static str,
    pub key_placeholder: &'static str,

    pub review_heading: &'static str,
    pub review_set: &'static str,
    pub review_unset: &'static str,
    pub review_uid_empty: &'static str,
    pub review_no_chat_key: &'static str,
    pub review_cta: &'static str,
    pub review_source: &'static str,
    pub review_unofficial: &'static str,

    pub deploy_heading: &'static str,
    pub deploy_log: &'static str,
    pub deploy_stages: [&'static str; 9],
    pub deploy_failed: &'static str,

    pub done_heading: &'static str,
    pub done_open: &'static str,
    pub done_next: &'static str,
    pub done_step_google: &'static str,
    pub done_step_signin: &'static str,
    pub done_step_appcheck: &'static str,
}

pub static EN: Texts = Texts {
    title: "Alfred Setup",
    lang_badge: "EN · F2 Türkçe",
    steps: ["Project", "Account", "API keys", "Review", "Deploy"],
    footer_form: "Tab next field · Enter continue · Esc back · F2 language · Ctrl+C quit",
    footer_review: "Enter deploy · Esc back · F2 language · Ctrl+C quit",
    footer_deploy: "PgUp/PgDn scroll log · Ctrl+C stop",
    footer_done: "Q quit",
    footer_failed: "Enter retry · Esc back to review · Q quit",
    fix_field: "Fix the highlighted field to continue.",
    quit_confirm: "The deploy is still running. Press Ctrl+C again to stop it.",

    project_heading: "Google Cloud project",
    project_intro: "Alfred runs in a Firebase project of its own. Type an ID or press Ctrl+G for a new one; it is created if it does not exist.",
    project_id: "Project ID",
    project_id_placeholder: "alfred-yourname",
    project_id_hint: "6–30 characters: lowercase letters, digits and hyphens.",
    billing: "Billing account",
    billing_hint: "Cloud Functions need Firebase's Blaze plan, so the project needs a billing account. ↑/↓ to choose.",
    billing_loading: "Loading your billing accounts…",
    billing_none: "No open billing account. Create one at console.cloud.google.com/billing, then press Ctrl+R.",
    billing_failed: "Could not list billing accounts. Press Ctrl+R to retry.",
    region: "Firestore region",
    region_hint: "←/→ to choose. It cannot be changed later.",

    account_heading: "Your account",
    account_intro: "Alfred is single-user: only this Google account can sign in.",
    email: "Google e-mail",
    email_placeholder: "you@gmail.com",
    uid: "Firebase Auth UID (optional)",
    uid_hint: "Leave it empty: the first verified sign-in with this e-mail is accepted.",

    keys_heading: "API keys",
    keys_intro: "All optional. You can add or change them later in Secret Manager. Ctrl+R shows or hides them.",
    chain_note: "Alfred tries EVREN first when its key is set, then Groq, then Gemini.",
    key_evren: "EVREN (TÜBİTAK, Turkish LLM)",
    key_evren_hint: "evren-llmapi.ssyz.org.tr · free daily quota via e-Devlet",
    key_groq: "Groq",
    key_groq_hint: "console.groq.com · free tier",
    key_gemini: "Google Gemini",
    key_gemini_hint: "aistudio.google.com · also powers long-term memory",
    key_tavily: "Tavily (web search)",
    key_tavily_hint: "tavily.com · 1,000 free searches a month",
    key_placeholder: "leave empty to add later",

    review_heading: "Review",
    review_set: "set",
    review_unset: "not set",
    review_uid_empty: "empty (verified e-mail)",
    review_no_chat_key: "No chat key: Alfred needs EVREN, Groq or Gemini to answer. You can add one later in Secret Manager.",
    review_cta: "Press Enter to create the project and deploy Alfred.",
    review_source: "Source code",
    review_unofficial: "This is not the official Alfred repository. Deploy it only if you trust its code: it will run in your Google account.",

    deploy_heading: "Deploying",
    deploy_log: "Log",
    deploy_stages: [
        "Project",
        "Billing",
        "APIs",
        "Firebase",
        "Firestore",
        "Secrets",
        "Config",
        "Build",
        "Deploy",
    ],
    deploy_failed: "Setup stopped (exit code {code}). The full log is at {log}.",

    done_heading: "Alfred is live",
    done_open: "Open",
    done_next: "Left to do",
    done_step_google: "Enable Google sign-in:",
    done_step_signin: "Open the app and sign in with",
    done_step_appcheck: "Optional, later: turn on App Check (see docs/OPERATIONS.md).",
};

pub static TR: Texts = Texts {
    title: "Alfred Kurulumu",
    lang_badge: "TR · F2 English",
    steps: ["Proje", "Hesap", "API anahtarları", "Özet", "Kurulum"],
    footer_form: "Tab sonraki alan · Enter devam · Esc geri · F2 dil · Ctrl+C çık",
    footer_review: "Enter kur · Esc geri · F2 dil · Ctrl+C çık",
    footer_deploy: "PgUp/PgDn log'u kaydır · Ctrl+C durdur",
    footer_done: "Q çık",
    footer_failed: "Enter tekrar dene · Esc özete dön · Q çık",
    fix_field: "Devam etmek için işaretli alanı düzelt.",
    quit_confirm: "Kurulum sürüyor. Durdurmak için Ctrl+C'ye bir kez daha bas.",

    project_heading: "Google Cloud projesi",
    project_intro: "Alfred kendine ait bir Firebase projesinde çalışır. Bir ID yaz ya da yenisi için Ctrl+G'ye bas; proje yoksa oluşturulur.",
    project_id: "Proje ID'si",
    project_id_placeholder: "alfred-adin",
    project_id_hint: "6–30 karakter: küçük harf, rakam ve tire.",
    billing: "Faturalandırma hesabı",
    billing_hint: "Cloud Functions, Firebase'in Blaze planını gerektirir; bu yüzden projeye bir faturalandırma hesabı bağlanmalı. ↑/↓ ile seç.",
    billing_loading: "Faturalandırma hesapların yükleniyor…",
    billing_none: "Açık faturalandırma hesabı yok. console.cloud.google.com/billing adresinden oluştur, sonra Ctrl+R'ye bas.",
    billing_failed: "Faturalandırma hesapları listelenemedi. Tekrar denemek için Ctrl+R'ye bas.",
    region: "Firestore bölgesi",
    region_hint: "←/→ ile seç. Sonradan değiştirilemez.",

    account_heading: "Hesabın",
    account_intro: "Alfred tek kullanıcılı: yalnızca bu Google hesabı giriş yapabilir.",
    email: "Google e-postası",
    email_placeholder: "adin@gmail.com",
    uid: "Firebase Auth UID (isteğe bağlı)",
    uid_hint: "Boş bırakabilirsin: bu e-postayla yapılan ilk doğrulanmış giriş kabul edilir.",

    keys_heading: "API anahtarları",
    keys_intro: "Hepsi isteğe bağlı; sonradan Secret Manager'dan ekleyip değiştirebilirsin. Ctrl+R anahtarları gösterir ya da gizler.",
    chain_note: "Alfred önce (anahtarı varsa) EVREN'i, ardından Groq'u, sonra Gemini'yi dener.",
    key_evren: "EVREN (TÜBİTAK, Türkçe LLM)",
    key_evren_hint: "evren-llmapi.ssyz.org.tr · e-Devlet ile günlük ücretsiz kota",
    key_groq: "Groq",
    key_groq_hint: "console.groq.com · ücretsiz katman",
    key_gemini: "Google Gemini",
    key_gemini_hint: "aistudio.google.com · uzun süreli hafızayı da çalıştırır",
    key_tavily: "Tavily (web araması)",
    key_tavily_hint: "tavily.com · ayda 1.000 ücretsiz arama",
    key_placeholder: "sonra eklemek için boş bırak",

    review_heading: "Özet",
    review_set: "ayarlandı",
    review_unset: "boş",
    review_uid_empty: "boş (doğrulanmış e-posta)",
    review_no_chat_key: "Sohbet anahtarı yok: Alfred'in cevap verebilmesi için EVREN, Groq ya da Gemini gerekir. Sonradan Secret Manager'dan ekleyebilirsin.",
    review_cta: "Projeyi oluşturup Alfred'i kurmak için Enter'a bas.",
    review_source: "Kaynak kod",
    review_unofficial: "Bu resmi Alfred reposu değil. Kodu Google hesabında çalışacak; yalnızca güveniyorsan kur.",

    deploy_heading: "Kuruluyor",
    deploy_log: "Log",
    deploy_stages: [
        "Proje",
        "Fatura",
        "API'ler",
        "Firebase",
        "Firestore",
        "Secret'lar",
        "Ayarlar",
        "Derleme",
        "Deploy",
    ],
    deploy_failed: "Kurulum durdu (çıkış kodu {code}). Log'un tamamı: {log}",

    done_heading: "Alfred yayında",
    done_open: "Aç",
    done_next: "Kalan adımlar",
    done_step_google: "Google ile girişi aç:",
    done_step_signin: "Uygulamayı aç ve şu hesapla giriş yap:",
    done_step_appcheck: "İsteğe bağlı, sonra: App Check'i aç (bkz. docs/OPERATIONS.md).",
};

/// Turkish wording for the English messages of `alfred-setup-core`'s
/// validators. Unknown messages are returned unchanged.
pub fn core_message(lang: Lang, message: &str) -> String {
    if lang == Lang::En {
        return message.to_string();
    }
    const PREFIXES: &[(&str, &str)] = &[
        ("Project ID cannot be empty", "Proje ID'si boş olamaz."),
        ("Project ID must be between 6 and 30", "Proje ID'si 6 ile 30 karakter arasında olmalı."),
        ("Project ID must start with a lowercase letter", "Proje ID'si küçük bir harfle başlamalı."),
        ("Project ID cannot end with a hyphen", "Proje ID'si tireyle bitemez."),
        ("Project ID can only contain", "Proje ID'si yalnızca küçük harf, rakam ve tire içerebilir."),
        ("Email address cannot be empty", "E-posta adresi boş olamaz."),
        ("Email address cannot contain newlines", "E-posta adresi satır sonu içeremez."),
        ("Please enter a valid email address", "Geçerli bir e-posta adresi gir (örn. adin@gmail.com)."),
        ("Invalid email username length", "E-postanın @ öncesi kısmı geçersiz uzunlukta."),
        ("Email username contains invalid characters", "E-postanın @ öncesi kısmında geçersiz karakter var."),
        ("Email domain must be a valid domain", "E-postanın alan adı uzantılı olmalı (örn. gmail.com)."),
        ("Email domain contains consecutive or trailing dots", "E-postanın alan adında art arda ya da sonda nokta var."),
        ("Domain segment too long", "Alan adının bir bölümü çok uzun."),
        ("Domain segments must begin and end", "Alan adı bölümleri harf ya da rakamla başlayıp bitmeli."),
        ("Domain segments can only contain", "Alan adı bölümleri yalnızca harf, rakam ve tire içerebilir."),
        ("Email top-level domain is too short", "E-postanın uzantısı çok kısa."),
        ("Firebase UID cannot contain newlines", "Firebase UID satır sonu içeremez."),
        ("Firebase UID must contain only", "Firebase UID yalnızca harf, rakam, alt çizgi ve tire içerebilir."),
        ("Firebase Auth UID should be between", "Firebase Auth UID 10 ile 128 karakter arasında olmalı."),
        ("API key contains invalid characters", "Anahtar geçersiz karakter içeriyor; yalnızca harf, rakam, _ ve - kullanılabilir."),
        ("API key is too short", "Anahtar çok kısa."),
        ("Groq API keys usually begin", "Groq anahtarları genellikle 'gsk_' ile başlar."),
        ("Google Gemini API keys usually begin", "Gemini anahtarları genellikle 'AIza' ile başlar."),
        ("Tavily API keys usually begin", "Tavily anahtarları genellikle 'tvly-' ile başlar."),
    ];
    PREFIXES
        .iter()
        .find(|(prefix, _)| message.starts_with(prefix))
        .map(|(_, tr)| (*tr).to_string())
        .unwrap_or_else(|| message.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use alfred_setup_core::validator::{validate_api_key, validate_email, validate_firebase_uid, validate_gcp_project_id};

    #[test]
    fn picks_turkish_from_locale() {
        assert_eq!(Lang::from_code("tr_TR.UTF-8"), Lang::Tr);
        assert_eq!(Lang::from_code("en_US.UTF-8"), Lang::En);
        assert_eq!(Lang::from_code(""), Lang::En);
    }

    #[test]
    fn every_validator_error_has_a_turkish_wording() {
        let errors = [
            validate_gcp_project_id("").unwrap_err(),
            validate_gcp_project_id("abc").unwrap_err(),
            validate_gcp_project_id("Alfred-prod").unwrap_err(),
            validate_gcp_project_id("alfred-prod-").unwrap_err(),
            validate_gcp_project_id("alfred_prod").unwrap_err(),
            validate_email("").unwrap_err(),
            validate_email("not-an-email").unwrap_err(),
            validate_email("a b@gmail.com").unwrap_err(),
            validate_email("me@gmail").unwrap_err(),
            validate_email("me@gmail..com").unwrap_err(),
            validate_email("me@gmail.c").unwrap_err(),
            validate_firebase_uid("short").unwrap_err(),
            validate_firebase_uid("bad uid with spaces").unwrap_err(),
            validate_api_key("groq", "gsk_$(id)aaaaaaaa").unwrap_err(),
            validate_api_key("groq", "gsk_1").unwrap_err(),
        ];
        for error in errors {
            let turkish = core_message(Lang::Tr, &error);
            assert_ne!(turkish, error, "no Turkish wording for: {error}");
        }
    }

    #[test]
    fn prefix_warnings_are_translated() {
        let outcome = validate_api_key("groq", "abcdefghijklmnop").unwrap();
        for warning in outcome.warnings {
            assert_ne!(core_message(Lang::Tr, &warning), warning);
        }
    }
}
