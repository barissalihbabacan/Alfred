use serde::{Deserialize, Serialize};
use crate::config_generator::SetupConfig;
use crate::validator::{validate_api_key, validate_email, validate_firebase_uid, validate_gcp_project_id};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WizardStep {
    ProjectSelection = 0,
    UserAuthorization = 1,
    ModelApiKeys = 2,
    ReviewAndDeploy = 3,
    PostSetup = 4,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StepValidationStatus {
    pub is_valid: bool,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SetupWizard {
    pub current_step: usize,
    pub total_steps: usize,
    pub config: SetupConfig,
}

fn mask_secret(secret: &str) -> String {
    let s = secret.trim();
    if s.is_empty() {
        "Unset (Not configured)".to_string()
    } else if s.len() <= 6 {
        "******".to_string()
    } else {
        format!("{}...{}", &s[..3], &s[s.len() - 3..])
    }
}

impl SetupWizard {
    pub fn new() -> Self {
        Self {
            current_step: 0,
            total_steps: 5,
            config: SetupConfig::default(),
        }
    }

    pub fn validate_step(&self, step: usize) -> StepValidationStatus {
        let mut errors = Vec::new();

        match step {
            0 => {
                if let Err(e) = validate_gcp_project_id(&self.config.project_id) {
                    errors.push(e);
                }
            }
            1 => {
                if let Err(e) = validate_email(&self.config.allowed_email) {
                    errors.push(e);
                }
                if let Err(e) = validate_firebase_uid(&self.config.allowed_uid) {
                    errors.push(e);
                }
            }
            2 => {
                if let Err(e) = validate_api_key("groq", &self.config.groq_api_key) {
                    errors.push(e);
                }
                if let Err(e) = validate_api_key("gemini", &self.config.gemini_api_key) {
                    errors.push(e);
                }
                if let Err(e) = validate_api_key("tavily", &self.config.tavily_api_key) {
                    errors.push(e);
                }
                if let Some(ref evren) = self.config.evren_api_key {
                    if !evren.trim().is_empty() {
                        if let Err(e) = validate_api_key("evren", evren) {
                            errors.push(e);
                        }
                    }
                }
            }
            3 => {
                // Review & deploy step: ensure all input steps are valid
                for s in 0..3 {
                    let prior = self.validate_step(s);
                    if !prior.is_valid {
                        errors.extend(prior.errors);
                    }
                }
            }
            4 => {
                // Post-setup steps panel (always accessible after deploy)
            }
            _ => {
                errors.push("Invalid wizard step.".to_string());
            }
        }

        StepValidationStatus {
            is_valid: errors.is_empty(),
            errors,
        }
    }

    pub fn can_advance(&self) -> bool {
        self.validate_step(self.current_step).is_valid && self.current_step + 1 < self.total_steps
    }

    pub fn next_step(&mut self) -> Result<usize, String> {
        let status = self.validate_step(self.current_step);
        if !status.is_valid {
            return Err(status.errors.join("; "));
        }
        if self.current_step + 1 < self.total_steps {
            self.current_step += 1;
            Ok(self.current_step)
        } else {
            Ok(self.current_step)
        }
    }

    pub fn prev_step(&mut self) -> usize {
        if self.current_step > 0 {
            self.current_step -= 1;
        }
        self.current_step
    }

    pub fn get_summary(&self) -> String {
        format!(
            "Target GCP Project: {}\nFirestore Region: {}\nBilling Account: {}\nAllowed User: {}\nFirebase Auth UID: {}\nGroq API Key: {}\nGemini API Key: {}\nTavily API Key: {}\nEVREN API Key: {}\nOllama URL: {}",
            if self.config.project_id.is_empty() { "(not set)" } else { &self.config.project_id },
            self.config.firestore_region.as_deref().unwrap_or("europe-west1"),
            self.config.billing_account_id.as_deref().unwrap_or("(auto-link open account)"),
            if self.config.allowed_email.is_empty() { "(not set)" } else { &self.config.allowed_email },
            if self.config.allowed_uid.is_empty() { "(empty - verified email fallback)" } else { &self.config.allowed_uid },
            mask_secret(&self.config.groq_api_key),
            mask_secret(&self.config.gemini_api_key),
            mask_secret(&self.config.tavily_api_key),
            self.config.evren_api_key.as_deref().map(mask_secret).unwrap_or_else(|| "Unset (Not configured)".to_string()),
            self.config.ollama_url.as_deref().unwrap_or("http://localhost:11434")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wizard_navigation_and_steps() {
        let mut wizard = SetupWizard::new();
        assert_eq!(wizard.current_step, 0);
        assert_eq!(wizard.total_steps, 5);

        // Step 0 invalid initially
        assert!(!wizard.can_advance());
        assert!(wizard.next_step().is_err());

        // Fill step 0
        wizard.config.project_id = "alfred-custom-test".to_string();
        assert!(wizard.can_advance());
        assert_eq!(wizard.next_step().unwrap(), 1);

        // Step 1: User authorization
        assert!(!wizard.can_advance());
        wizard.config.allowed_email = "owner@example.com".to_string();
        assert!(wizard.can_advance());
        assert_eq!(wizard.next_step().unwrap(), 2);

        // Step 2: API keys (all optional)
        assert!(wizard.can_advance());
        assert_eq!(wizard.next_step().unwrap(), 3);

        // Step 3: Review & deploy
        assert!(wizard.can_advance());
        assert_eq!(wizard.next_step().unwrap(), 4);

        // Step 4: Post-setup
        assert_eq!(wizard.current_step, 4);
        assert!(!wizard.can_advance()); // at final step

        // Navigation back
        assert_eq!(wizard.prev_step(), 3);
        assert_eq!(wizard.prev_step(), 2);
    }

    #[test]
    fn test_get_summary_masks_secrets() {
        let mut wizard = SetupWizard::new();
        wizard.config.project_id = "test-project-123".to_string();
        wizard.config.allowed_email = "user@test.com".to_string();
        wizard.config.groq_api_key = "gsk_1234567890abcdef".to_string();
        wizard.config.gemini_api_key = "AIzaSy_1234567890abcdef".to_string();

        let summary = wizard.get_summary();
        assert!(summary.contains("Target GCP Project: test-project-123"));
        assert!(summary.contains("Allowed User: user@test.com"));

        // Secrets must be masked
        assert!(!summary.contains("gsk_1234567890abcdef"));
        assert!(!summary.contains("AIzaSy_1234567890abcdef"));
        assert!(summary.contains("gsk...def"));
        assert!(summary.contains("AIz...def"));
    }
}
