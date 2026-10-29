use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationOutcome {
    pub value: String,
    pub warnings: Vec<String>,
}

/// Validates a Google Cloud / Firebase project ID without regex.
/// GCP project IDs must be 6-30 characters, lowercase letters, digits, and hyphens.
/// Must start with a lowercase letter and cannot end with a hyphen.
pub fn validate_gcp_project_id(project_id: &str) -> Result<String, String> {
    let trimmed = project_id.trim();
    if trimmed.is_empty() {
        return Err("Project ID cannot be empty.".to_string());
    }
    if trimmed.len() < 6 || trimmed.len() > 30 {
        return Err(format!(
            "Project ID must be between 6 and 30 characters (got {}).",
            trimmed.len()
        ));
    }

    let chars: Vec<char> = trimmed.chars().collect();
    if !chars[0].is_ascii_lowercase() {
        return Err("Project ID must start with a lowercase letter.".to_string());
    }

    let last = chars[chars.len() - 1];
    if !last.is_ascii_lowercase() && !last.is_ascii_digit() {
        return Err("Project ID cannot end with a hyphen.".to_string());
    }

    if !chars.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-') {
        return Err("Project ID can only contain lowercase letters, numbers, and hyphens.".to_string());
    }

    Ok(trimmed.to_string())
}

/// Validates an email address syntax for single-user authorization (ALLOWED_EMAIL).
/// Standard syntax validation without regex or false-positive word blocklists,
/// ensuring genuine names (e.g. isik@gmail.com, epic.dev@gmail.com) are accepted.
pub fn validate_email(email: &str) -> Result<String, String> {
    let trimmed = email.trim();
    if trimmed.is_empty() {
        return Err("Email address cannot be empty.".to_string());
    }

    if trimmed.contains('\n') || trimmed.contains('\r') || trimmed.contains("ALFRED_ENV_EOF") {
        return Err("Email address cannot contain newlines or delimiter tokens.".to_string());
    }

    let parts: Vec<&str> = trimmed.split('@').collect();
    if parts.len() != 2 {
        return Err("Please enter a valid email address (e.g. yourname@gmail.com).".to_string());
    }

    let local = parts[0];
    let domain = parts[1];

    if local.is_empty() || local.len() > 64 {
        return Err("Invalid email username length.".to_string());
    }

    if !local.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || c == '.'
            || c == '!'
            || c == '#'
            || c == '$'
            || c == '%'
            || c == '&'
            || c == '\''
            || c == '*'
            || c == '+'
            || c == '/'
            || c == '='
            || c == '?'
            || c == '^'
            || c == '_'
            || c == '`'
            || c == '{'
            || c == '|'
            || c == '}'
            || c == '~'
            || c == '-'
    }) {
        return Err("Email username contains invalid characters.".to_string());
    }

    if domain.is_empty() || domain.len() > 255 || !domain.contains('.') {
        return Err("Email domain must be a valid domain with an extension (e.g. gmail.com).".to_string());
    }

    let domain_labels: Vec<&str> = domain.split('.').collect();
    if domain_labels.iter().any(|l| l.is_empty()) {
        return Err("Email domain contains consecutive or trailing dots.".to_string());
    }

    for label in &domain_labels {
        if label.len() > 63 {
            return Err("Domain segment too long.".to_string());
        }
        let l_chars: Vec<char> = label.chars().collect();
        if !l_chars[0].is_ascii_alphanumeric() || !l_chars[l_chars.len() - 1].is_ascii_alphanumeric() {
            return Err("Domain segments must begin and end with an alphanumeric character.".to_string());
        }
        if !l_chars.iter().all(|c| c.is_ascii_alphanumeric() || *c == '-') {
            return Err("Domain segments can only contain letters, digits, and hyphens.".to_string());
        }
    }

    // TLD must have at least 2 characters
    if domain_labels.last().map(|tld| tld.len()).unwrap_or(0) < 2 {
        return Err("Email top-level domain is too short.".to_string());
    }

    Ok(trimmed.to_lowercase())
}

/// Validates a Firebase Auth UID for single-user authorization (ALLOWED_UID).
/// If empty, it is considered valid because Alfred supports authorization via verified email.
pub fn validate_firebase_uid(uid: &str) -> Result<String, String> {
    let trimmed = uid.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    if trimmed.contains('\n') || trimmed.contains('\r') || trimmed.contains("ALFRED_ENV_EOF") {
        return Err("Firebase UID cannot contain newlines or delimiter tokens.".to_string());
    }

    if !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Firebase UID must contain only alphanumeric characters, underscores, and hyphens.".to_string());
    }

    if trimmed.len() < 10 || trimmed.len() > 128 {
        return Err(format!(
            "Firebase Auth UID should be between 10 and 128 characters (got {}).",
            trimmed.len()
        ));
    }

    Ok(trimmed.to_string())
}

/// Validates model API keys based on strict character set rules [A-Za-z0-9_-].
/// Returns ValidationOutcome with warnings rather than errors for prefix mismatches.
pub fn validate_api_key(provider: &str, key: &str) -> Result<ValidationOutcome, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Ok(ValidationOutcome {
            value: String::new(),
            warnings: Vec::new(),
        });
    }

    // 1. Strict character set check: [A-Za-z0-9_-] only (strictly prevents shell injection)
    if !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("API key contains invalid characters. Only alphanumeric characters, underscores (_), and hyphens (-) are allowed.".to_string());
    }

    // 2. Minimum length check
    if trimmed.len() < 8 {
        return Err(format!("API key is too short ({} characters).", trimmed.len()));
    }

    // 3. Prefix checks: warnings only (never errors)
    let mut warnings = Vec::new();
    match provider.to_lowercase().as_str() {
        "groq" if !trimmed.starts_with("gsk_") => {
            warnings.push("Groq API keys usually begin with 'gsk_'.".to_string());
        }
        "gemini" | "google" if !trimmed.starts_with("AIza") => {
            warnings.push("Google Gemini API keys usually begin with 'AIza'.".to_string());
        }
        "tavily" if !trimmed.starts_with("tvly-") => {
            warnings.push("Tavily API keys usually begin with 'tvly-'.".to_string());
        }
        _ => {}
    }

    Ok(ValidationOutcome {
        value: trimmed.to_string(),
        warnings,
    })
}

/// Validates the owner's display name (how Alfred addresses them).
/// Any script is allowed (e.g. "Barış", "Zoë"); control characters are not.
pub fn validate_owner_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Name cannot be empty.".to_string());
    }
    if trimmed.chars().count() > 80 {
        return Err("Name is too long (80 characters at most).".to_string());
    }
    if trimmed.chars().any(|c| c.is_control()) || trimmed.contains("ALFRED_ENV_EOF") {
        return Err("Name cannot contain control characters.".to_string());
    }
    Ok(trimmed.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// Validates local Ollama endpoint URL.
/// Must begin with http:// or https:// and cannot contain spaces, quotes, or control characters.
pub fn validate_ollama_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Ok("http://localhost:11434".to_string());
    }

    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err("Ollama URL must start with 'http://' or 'https://'.".to_string());
    }

    if trimmed.chars().any(|c| c.is_whitespace() || c == '\'' || c == '"' || c.is_ascii_control()) {
        return Err("Ollama URL must not contain whitespace, quotes, or control characters.".to_string());
    }

    let after_scheme = if let Some(rest) = trimmed.strip_prefix("http://") {
        rest
    } else if let Some(rest) = trimmed.strip_prefix("https://") {
        rest
    } else {
        trimmed
    };

    if after_scheme.is_empty() {
        return Err("Ollama URL must include a host (e.g. http://localhost:11434).".to_string());
    }

    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_owner_name() {
        assert_eq!(validate_owner_name("  Barış   Salih ").unwrap(), "Barış Salih");
        assert!(validate_owner_name("Zoë").is_ok());
        assert!(validate_owner_name("   ").is_err());
        assert!(validate_owner_name("a\nb").is_err());
        assert!(validate_owner_name(&"x".repeat(81)).is_err());
    }

    #[test]
    fn test_validate_gcp_project_id() {
        assert!(validate_gcp_project_id("demo-alfred").is_ok());
        assert!(validate_gcp_project_id("my-project-123").is_ok());
        assert!(validate_gcp_project_id("123-bad").is_err());
        assert!(validate_gcp_project_id("bad-").is_err());
        assert!(validate_gcp_project_id("short").is_err());
        // Injection payloads
        assert!(validate_gcp_project_id("proj$(whoami)").is_err());
        assert!(validate_gcp_project_id("proj`id`").is_err());
        assert!(validate_gcp_project_id("proj;rm -rf").is_err());
        assert!(validate_gcp_project_id("proj'--").is_err());
    }

    #[test]
    fn test_validate_email() {
        assert!(validate_email("owner@gmail.com").is_ok());
        assert!(validate_email("john.doe@gmail.com").is_ok());
        // Genuine names that previously triggered false positives
        assert!(validate_email("isik@gmail.com").is_ok());
        assert!(validate_email("epic.dev@gmail.com").is_ok());
        assert!(validate_email("cagri.dev@gmail.com").is_ok());
        assert!(validate_email("dickens@gmail.com").is_ok());
        assert!(validate_email("topic@company.org").is_ok());

        assert!(validate_email("invalid-email").is_err());
        assert!(validate_email("").is_err());
        assert!(validate_email("@gmail.com").is_err());
        assert!(validate_email("user@").is_err());
        assert!(validate_email("user@no-extension").is_err());
        // Injection and delimiter payload attempts
        assert!(validate_email("user\nALFRED_ENV_EOF@gmail.com").is_err());
        assert!(validate_email("user$(whoami)@gmail.com").is_err());
    }

    #[test]
    fn test_validate_firebase_uid() {
        assert!(validate_firebase_uid("test-owner-uid-123456").is_ok());
        assert!(validate_firebase_uid("").is_ok()); // Optional
        assert!(validate_firebase_uid("too-short").is_err());
        // Injection attempts
        assert!(validate_firebase_uid("uid$(whoami)123456").is_err());
        assert!(validate_firebase_uid("uid;rm -rf;123456").is_err());
        assert!(validate_firebase_uid("uid' OR 1=1;123456").is_err());
        assert!(validate_firebase_uid("uid\nALFRED_ENV_EOF\n123456").is_err());
    }

    #[test]
    fn test_validate_api_key() {
        // Valid keys
        let groq = validate_api_key("groq", "gsk_1234567890abcdef12345678").unwrap();
        assert_eq!(groq.value, "gsk_1234567890abcdef12345678");
        assert!(groq.warnings.is_empty());

        let gemini = validate_api_key("gemini", "AIzaSy1234567890abcdef1234567890abcdef").unwrap();
        assert!(gemini.warnings.is_empty());

        // Prefix mismatch generates warning, not error
        let nonstandard_gemini = validate_api_key("gemini", "AIzaCustomPrefixKey1234567890").unwrap();
        assert!(nonstandard_gemini.warnings.is_empty()); // AIza prefix is satisfied

        let custom_groq = validate_api_key("groq", "custom_key_1234567890").unwrap();
        assert!(!custom_groq.warnings.is_empty());
        assert!(custom_groq.warnings[0].contains("usually begin with 'gsk_'"));

        // EVREN has no prefix check
        let evren = validate_api_key("evren", "custom_evren_token_123456").unwrap();
        assert!(evren.warnings.is_empty());

        // Optional empty check
        assert!(validate_api_key("groq", "").unwrap().value.is_empty());

        // Malicious injection payloads MUST be rejected with error
        assert!(validate_api_key("groq", "gsk_$(rm -rf /)1234567890").is_err());
        assert!(validate_api_key("groq", "gsk_`whoami`1234567890").is_err());
        assert!(validate_api_key("gemini", "AIzaSy\"; echo hacked; #").is_err());
        assert!(validate_api_key("tavily", "tvly-' || touch /tmp/pwned || '").is_err());
        assert!(validate_api_key("evren", "evren_key\nexport PWNED=1\n").is_err());
    }

    #[test]
    fn test_validate_ollama_url() {
        assert!(validate_ollama_url("http://localhost:11434").is_ok());
        assert!(validate_ollama_url("https://ollama.myhome.internal:11434").is_ok());
        assert!(validate_ollama_url("").is_ok()); // Default
        assert!(validate_ollama_url("ftp://localhost:11434").is_err());
        assert!(validate_ollama_url("http://localhost:11434/api'; rm -rf /").is_err());
        assert!(validate_ollama_url("http://localhost:11434 with spaces").is_err());
        assert!(validate_ollama_url("http://").is_err());
    }
}
