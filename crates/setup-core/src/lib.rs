pub mod validator;
pub mod config_generator;
pub mod state;

use wasm_bindgen::prelude::*;
use crate::config_generator::SetupConfig;
use crate::state::SetupWizard;

#[wasm_bindgen]
pub fn wasm_validate_project_id(project_id: &str) -> Result<String, JsValue> {
    validator::validate_gcp_project_id(project_id)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn wasm_validate_email(email: &str) -> Result<String, JsValue> {
    validator::validate_email(email)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn wasm_validate_uid(uid: &str) -> Result<String, JsValue> {
    validator::validate_firebase_uid(uid)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn wasm_validate_api_key(provider: &str, key: &str) -> Result<JsValue, JsValue> {
    let outcome = validator::validate_api_key(provider, key)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_wasm_bindgen::to_value(&outcome)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

#[wasm_bindgen]
pub fn wasm_validate_ollama_url(url: &str) -> Result<String, JsValue> {
    validator::validate_ollama_url(url)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn wasm_generate_env(config_js: JsValue) -> Result<String, JsValue> {
    let config: SetupConfig = serde_wasm_bindgen::from_value(config_js)
        .map_err(|e| JsValue::from_str(&format!("Invalid configuration: {}", e)))?;
    Ok(config_generator::generate_env_file(&config))
}

#[wasm_bindgen]
pub fn wasm_generate_script(config_js: JsValue) -> Result<String, JsValue> {
    let config: SetupConfig = serde_wasm_bindgen::from_value(config_js)
        .map_err(|e| JsValue::from_str(&format!("Invalid configuration: {}", e)))?;
    Ok(config_generator::generate_cloud_shell_script(&config))
}

#[wasm_bindgen]
pub struct WasmWizard {
    inner: SetupWizard,
}

#[wasm_bindgen]
impl WasmWizard {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: SetupWizard::new(),
        }
    }

    #[wasm_bindgen]
    pub fn set_project_id(&mut self, val: &str) {
        self.inner.config.project_id = val.trim().to_string();
    }

    #[wasm_bindgen]
    pub fn set_allowed_email(&mut self, val: &str) {
        self.inner.config.allowed_email = val.trim().to_string();
    }

    #[wasm_bindgen]
    pub fn set_allowed_uid(&mut self, val: &str) {
        self.inner.config.allowed_uid = val.trim().to_string();
    }

    #[wasm_bindgen]
    pub fn set_groq_key(&mut self, val: &str) {
        self.inner.config.groq_api_key = val.trim().to_string();
    }

    #[wasm_bindgen]
    pub fn set_gemini_key(&mut self, val: &str) {
        self.inner.config.gemini_api_key = val.trim().to_string();
    }

    #[wasm_bindgen]
    pub fn set_tavily_key(&mut self, val: &str) {
        self.inner.config.tavily_api_key = val.trim().to_string();
    }

    #[wasm_bindgen]
    pub fn set_evren_key(&mut self, val: &str) {
        let trimmed = val.trim();
        self.inner.config.evren_api_key = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }

    #[wasm_bindgen]
    pub fn set_ollama_url(&mut self, val: &str) {
        let trimmed = val.trim();
        self.inner.config.ollama_url = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        };
    }

    #[wasm_bindgen]
    pub fn get_current_step(&self) -> usize {
        self.inner.current_step
    }

    #[wasm_bindgen]
    pub fn get_total_steps(&self) -> usize {
        self.inner.total_steps
    }

    #[wasm_bindgen]
    pub fn validate_current_step(&self) -> Result<JsValue, JsValue> {
        let status = self.inner.validate_step(self.inner.current_step);
        serde_wasm_bindgen::to_value(&status)
            .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))
    }

    #[wasm_bindgen]
    pub fn next_step(&mut self) -> Result<usize, JsValue> {
        self.inner.next_step().map_err(|e| JsValue::from_str(&e))
    }

    #[wasm_bindgen]
    pub fn prev_step(&mut self) -> usize {
        self.inner.prev_step()
    }

    #[wasm_bindgen]
    pub fn get_env_file(&self) -> String {
        config_generator::generate_env_file(&self.inner.config)
    }

    #[wasm_bindgen]
    pub fn get_provisioning_script(&self) -> String {
        config_generator::generate_cloud_shell_script(&self.inner.config)
    }
}
