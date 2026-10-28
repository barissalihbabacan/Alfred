use regex::Regex;

/// Validates a Google Cloud / Firebase project ID.
/// GCP project IDs must be 6-30 characters, lowercase letters, digits, and hyphens.
/// Must start with a letter and cannot end with a hyphen.
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

    let re = Regex::new(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
        .map_err(|e| e.to_string())?;

    if !re.is_match(trimmed) {
        return Err("Project ID must start with a lowercase letter, contain only lowercase letters, numbers, and hyphens, and not end with a hyphen.".to_string());
    }

    Ok(trimmed.to_string())
}

/// Validates an email address for single-user authorization (ALLOWED_EMAIL).
/// Rejects dummy, placeholder, disposable, profane, or RFC 2606 example domains.
pub fn validate_email(email: &str) -> Result<String, String> {
    let trimmed = email.trim().to_lowercase();
    if trimmed.is_empty() {
        return Err("Email address cannot be empty.".to_string());
    }

    let re = Regex::new(r"^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$")
        .map_err(|e| e.to_string())?;

    if !re.is_match(&trimmed) {
        return Err("Please enter a valid email address (e.g. yourname@gmail.com).".to_string());
    }

    let parts: Vec<&str> = trimmed.split('@').collect();
    if parts.len() != 2 {
        return Err("Invalid email address format.".to_string());
    }
    let local = parts[0];
    let domain = parts[1];

    // 1. Block RFC 2606 reserved example & test domains and disposable providers
    const BLOCKED_DOMAINS: &[&str] = &[
        "example.com",
        "example.org",
        "example.net",
        "test.com",
        "test.org",
        "test.net",
        "sample.com",
        "fake.com",
        "dummy.com",
        "invalid",
        "localhost",
        "mailinator.com",
        "tempmail.com",
        "dispostable.com",
        "10minutemail.com",
        "guerrillamail.com",
        "trashmail.com",
        "yopmail.com",
        "sharklasers.com",
    ];

    if BLOCKED_DOMAINS.iter().any(|d| domain == *d || domain.ends_with(&format!(".{d}"))) {
        return Err("Placeholder, test, or disposable domains (like example.com) are not allowed. Please enter your real Google account email.".to_string());
    }

    // 2. Block placeholder/dummy local names
    const DUMMY_LOCALPARTS: &[&str] = &[
        "test",
        "demo",
        "sample",
        "fake",
        "dummy",
        "placeholder",
        "asdf",
        "qwerty",
    ];

    if DUMMY_LOCALPARTS.contains(&local) {
        return Err(format!("'{local}' is a placeholder name. Please enter your real personal Google account email."));
    }

    // 3. Block profanity / abusive localparts
    const PROFANITY_PATTERNS: &[&str] = &[
        "fuck",
        "shit",
        "bitch",
        "asshole",
        "dick",
        "cunt",
        "bastard",
        "sik",
        "amk",
        "pic",
        "orospu",
        "yarrak",
    ];

    for bad in PROFANITY_PATTERNS {
        if local.contains(bad) {
            return Err("Inappropriate or abusive email address detected. Please enter your real email address.".to_string());
        }
    }

    Ok(trimmed)
}

/// Validates a Firebase Auth UID for single-user authorization (ALLOWED_UID).
/// If empty, it is considered valid because Alfred supports auto-binding on first login.
pub fn validate_firebase_uid(uid: &str) -> Result<String, String> {
    let trimmed = uid.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.len() < 10 || trimmed.len() > 128 {
        return Err(format!(
            "Firebase Auth UID should be between 10 and 128 characters (got {}).",
            trimmed.len()
        ));
    }

    Ok(trimmed.to_string())
}

/// Validates model API keys based on provider prefix rules.
/// If empty, it is considered valid because all API keys are optional (can be configured later or use local Ollama).
pub fn validate_api_key(provider: &str, key: &str) -> Result<String, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    match provider.to_lowercase().as_str() {
        "groq" => {
            if !trimmed.starts_with("gsk_") {
                return Err("Groq API key must start with 'gsk_'.".to_string());
            }
            if trimmed.len() < 24 {
                return Err("Groq API key appears too short (expected > 24 characters).".to_string());
            }
        }
        "gemini" | "google" => {
            if !trimmed.starts_with("AIzaSy") {
                return Err("Google Gemini API key typically starts with 'AIzaSy'.".to_string());
            }
            if trimmed.len() < 30 {
                return Err("Gemini API key appears too short (expected ~39 characters).".to_string());
            }
        }
        "tavily" => {
            if !trimmed.starts_with("tvly-") {
                return Err("Tavily API key must start with 'tvly-'.".to_string());
            }
            if trimmed.len() < 16 {
                return Err("Tavily API key appears too short.".to_string());
            }
        }
        "evren" => {
            if !trimmed.starts_with("evren_") && !trimmed.starts_with("sk-") {
                return Err("TÜBİTAK EVREN API key usually starts with 'evren_' or 'sk-'.".to_string());
            }
            if trimmed.len() < 16 {
                return Err("EVREN API key appears too short.".to_string());
            }
        }
        _ => {
            if trimmed.len() < 8 {
                return Err(format!("{provider} key appears too short."));
            }
        }
    }

    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_gcp_project_id() {
        assert!(validate_gcp_project_id("butler-alfred").is_ok());
        assert!(validate_gcp_project_id("my-project-123").is_ok());
        assert!(validate_gcp_project_id("123-bad").is_err());
        assert!(validate_gcp_project_id("bad-").is_err());
        assert!(validate_gcp_project_id("short").is_err());
    }

    #[test]
    fn test_validate_email() {
        assert!(validate_email("owner@example.invalid").is_ok());
        assert!(validate_email("john.doe@gmail.com").is_ok());
        assert!(validate_email("invalid-email").is_err());
        assert!(validate_email("").is_err());
        // Blocked dummy and example domains
        assert!(validate_email("user@example.com").is_err());
        assert!(validate_email("user@test.com").is_err());
        assert!(validate_email("user@mailinator.com").is_err());
        // Blocked dummy localparts
        assert!(validate_email("test@gmail.com").is_err());
        assert!(validate_email("dummy@gmail.com").is_err());
        // Blocked profanity
        assert!(validate_email("fuckyou@example.com").is_err());
        assert!(validate_email("fuckyou@gmail.com").is_err());
        assert!(validate_email("amk@gmail.com").is_err());
    }

    #[test]
    fn test_validate_firebase_uid() {
        assert!(validate_firebase_uid("test-owner-uid-123456").is_ok());
        assert!(validate_firebase_uid("").is_ok()); // Optional for first-login auto-bind
        assert!(validate_firebase_uid("too-short").is_err());
    }

    #[test]
    fn test_validate_api_key() {
        assert!(validate_api_key("groq", "gsk_1234567890abcdef12345678").is_ok());
        assert!(validate_api_key("groq", "").is_ok()); // Optional
        assert!(validate_api_key("groq", "wrong_prefix_1234567890").is_err());
        assert!(validate_api_key("gemini", "AIzaSy1234567890abcdef1234567890abcdef").is_ok());
        assert!(validate_api_key("gemini", "").is_ok()); // Optional
        assert!(validate_api_key("gemini", "bad_prefix").is_err());
        assert!(validate_api_key("tavily", "tvly-1234567890abcdef").is_ok());
        assert!(validate_api_key("tavily", "").is_ok()); // Optional
        assert!(validate_api_key("evren", "evren_1234567890abcdef").is_ok());
        assert!(validate_api_key("evren", "").is_ok()); // Optional
    }
}
