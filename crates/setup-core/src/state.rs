use serde::{Deserialize, Serialize};
use crate::config_generator::SetupConfig;
use crate::validator::{validate_api_key, validate_email, validate_firebase_uid, validate_gcp_project_id};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WizardStep {
    ProjectSelection = 0,
    UserAuthorization = 1,
    ModelApiKeys = 2,
    ReviewAndDeploy = 3,
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

impl SetupWizard {
    pub fn new() -> Self {
        Self {
            current_step: 0,
            total_steps: 4,
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
                // Final review step: validate all prior steps
                for s in 0..3 {
                    let prior = self.validate_step(s);
                    if !prior.is_valid {
                        errors.extend(prior.errors);
                    }
                }
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wizard_navigation() {
        let mut wizard = SetupWizard::new();
        assert_eq!(wizard.current_step, 0);

        // Step 0 invalid initially
        assert!(!wizard.can_advance());
        assert!(wizard.next_step().is_err());

        // Fill step 0
        wizard.config.project_id = "butler-alfred".to_string();
        assert!(wizard.can_advance());
        assert_eq!(wizard.next_step().unwrap(), 1);

        // Prev step
        assert_eq!(wizard.prev_step(), 0);
    }
}
