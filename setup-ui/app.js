import init, {
  wasm_validate_project_id,
  wasm_validate_email,
  wasm_validate_uid,
  wasm_validate_api_key,
  wasm_generate_env,
  wasm_generate_script,
  WasmWizard
} from "./wasm/alfred_setup_core.js";

let wizard = null;
let wasmReady = false;

// DOM Elements
const stepPanels = [
  document.getElementById("step-0"),
  document.getElementById("step-1"),
  document.getElementById("step-2"),
  document.getElementById("step-3")
];
const stepNavItems = document.querySelectorAll(".step-item");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const footerStatus = document.getElementById("footer-status");

// Inputs
const inputProjectId = document.getElementById("project-id");
const btnGenerateProject = document.getElementById("btn-generate-project");
const inputAllowedEmail = document.getElementById("allowed-email");
const inputAllowedUid = document.getElementById("allowed-uid");
const inputGroqKey = document.getElementById("groq-key");
const inputGeminiKey = document.getElementById("gemini-key");
const inputTavilyKey = document.getElementById("tavily-key");
const inputEvrenKey = document.getElementById("evren-key");
const inputOllamaUrl = document.getElementById("ollama-url");

// Validation elements
const valProjectId = document.getElementById("val-project-id");
const valAllowedEmail = document.getElementById("val-allowed-email");
const valAllowedUid = document.getElementById("val-allowed-uid");
const valGroqKey = document.getElementById("val-groq-key");
const valGeminiKey = document.getElementById("val-gemini-key");
const valTavilyKey = document.getElementById("val-tavily-key");
const valEvrenKey = document.getElementById("val-evren-key");
const valOllamaUrl = document.getElementById("val-ollama-url");

// Review elements
const reviewSummary = document.getElementById("review-summary");
const scriptPreview = document.getElementById("script-preview");
const btnCopyScript = document.getElementById("btn-copy-script");
const btnDownloadEnv = document.getElementById("btn-download-env");
const btnExecuteProvision = document.getElementById("btn-execute-provision");
const executionStatus = document.getElementById("execution-status");

async function start() {
  try {
    await init();
    wasmReady = true;
    wizard = new WasmWizard();
    console.log("[Alfred Setup-UI] WebAssembly core initialized successfully.");
    bindEvents();
    renderStep();
  } catch (err) {
    console.error("[Alfred Setup-UI] Failed to initialize WASM module:", err);
    footerStatus.textContent = "Error initializing WebAssembly module.";
  }
}

function bindEvents() {
  // Auto-generate project ID
  if (btnGenerateProject) {
    btnGenerateProject.addEventListener("click", () => {
      const randomSuffix = Math.random().toString(36).substring(2, 8);
      const generatedId = `alfred-butler-${randomSuffix}`;
      inputProjectId.value = generatedId;
      wizard.set_project_id(generatedId);
      validateField(valProjectId, () => wasm_validate_project_id(generatedId));
      clearFooterStatus();
    });
  }

  // Input live validations via WASM
  inputProjectId.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    wizard.set_project_id(val);
    validateField(valProjectId, () => wasm_validate_project_id(val));
    clearFooterStatus();
  });

  inputAllowedEmail.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    wizard.set_allowed_email(val);
    validateField(valAllowedEmail, () => wasm_validate_email(val));
    clearFooterStatus();
  });

  inputAllowedUid.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    wizard.set_allowed_uid(val);
    if (!val) {
      valAllowedUid.className = "validation-message valid";
      valAllowedUid.textContent = "ℹ️ (Optional) Will auto-bind on first sign-in";
    } else {
      validateField(valAllowedUid, () => wasm_validate_uid(val));
    }
    clearFooterStatus();
  });

  inputGroqKey.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    wizard.set_groq_key(val);
    if (!val) {
      valGroqKey.className = "validation-message valid";
      valGroqKey.textContent = "ℹ️ (Optional) Can be configured later";
    } else {
      validateField(valGroqKey, () => wasm_validate_api_key("groq", val));
    }
    clearFooterStatus();
  });

  inputGeminiKey.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    wizard.set_gemini_key(val);
    if (!val) {
      valGeminiKey.className = "validation-message valid";
      valGeminiKey.textContent = "ℹ️ (Optional) Can be configured later";
    } else {
      validateField(valGeminiKey, () => wasm_validate_api_key("gemini", val));
    }
    clearFooterStatus();
  });

  inputTavilyKey.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    wizard.set_tavily_key(val);
    if (!val) {
      valTavilyKey.className = "validation-message valid";
      valTavilyKey.textContent = "ℹ️ (Optional) Can be configured later";
    } else {
      validateField(valTavilyKey, () => wasm_validate_api_key("tavily", val));
    }
    clearFooterStatus();
  });

  inputEvrenKey.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    wizard.set_evren_key(val);
    if (val.length > 0) {
      validateField(valEvrenKey, () => wasm_validate_api_key("evren", val));
    } else {
      clearValidation(valEvrenKey);
    }
  });

  inputOllamaUrl.addEventListener("input", (e) => {
    wizard.set_ollama_url(e.target.value.trim());
  });

  btnPrev.addEventListener("click", () => {
    if (!wizard) return;
    wizard.prev_step();
    renderStep();
  });

  btnNext.addEventListener("click", () => {
    if (!wizard) return;
    try {
      wizard.next_step();
      renderStep();
    } catch (err) {
      footerStatus.textContent = err.toString();
    }
  });

  // Action buttons on step 3
  btnCopyScript.addEventListener("click", async () => {
    if (!wizard) return;
    const script = wizard.get_provisioning_script();
    await navigator.clipboard.writeText(script);
    btnCopyScript.textContent = "✅ Copied to Clipboard!";
    setTimeout(() => {
      btnCopyScript.textContent = "📋 Copy Provisioning Script";
    }, 2000);
  });

  btnDownloadEnv.addEventListener("click", () => {
    if (!wizard) return;
    const envContent = wizard.get_env_file();
    const blob = new Blob([envContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ".env";
    a.click();
    URL.revokeObjectURL(url);
  });

  btnExecuteProvision.addEventListener("click", async () => {
    await executeProvisioning();
  });
}

function validateField(elem, validatorFn) {
  try {
    validatorFn();
    elem.className = "validation-message valid";
    elem.textContent = "✓ Valid";
  } catch (err) {
    elem.className = "validation-message error";
    elem.textContent = err.toString();
  }
}

function clearValidation(elem) {
  elem.className = "validation-message";
  elem.textContent = "";
}

function clearFooterStatus() {
  footerStatus.textContent = "";
}

function renderStep() {
  if (!wizard) return;
  const current = wizard.get_current_step();
  const total = wizard.get_total_steps();

  // Panels
  stepPanels.forEach((panel, idx) => {
    panel.classList.toggle("active", idx === current);
  });

  // Stepper
  stepNavItems.forEach((item, idx) => {
    item.classList.toggle("active", idx === current);
    item.classList.toggle("completed", idx < current);
  });

  // Buttons
  btnPrev.disabled = current === 0;
  if (current === total - 1) {
    btnNext.style.display = "none";
    populateReview();
  } else {
    btnNext.style.display = "inline-block";
    btnNext.textContent = "Next Step \u2192";
  }

  clearFooterStatus();
}

function populateReview() {
  if (!wizard) return;

  const script = wizard.get_provisioning_script();
  scriptPreview.textContent = script;

  const projectId = inputProjectId.value.trim();
  const allowedEmail = inputAllowedEmail.value.trim();
  const allowedUid = inputAllowedUid.value.trim();
  const groqKey = inputGroqKey.value.trim();
  const geminiKey = inputGeminiKey.value.trim();
  const tavilyKey = inputTavilyKey.value.trim();
  const evrenKey = inputEvrenKey.value.trim();

  const configuredProviders = [];
  if (groqKey) configuredProviders.push("Groq");
  if (geminiKey) configuredProviders.push("Gemini");
  if (tavilyKey) configuredProviders.push("Tavily");
  if (evrenKey) configuredProviders.push("TÜBİTAK EVREN");
  const providersText = configuredProviders.length > 0
    ? configuredProviders.join(" + ")
    : "Can be added later (Local Ollama active)";

  reviewSummary.innerHTML = `
    <div class="summary-card">
      <div class="summary-label">Target GCP Project</div>
      <div class="summary-value">${escapeHtml(projectId)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Allowed User</div>
      <div class="summary-value">${escapeHtml(allowedEmail)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Firebase Auth UID</div>
      <div class="summary-value">${allowedUid ? escapeHtml(allowedUid) : "<span style='color:var(--gold)'>Auto-bind on first sign-in</span>"}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Model Providers</div>
      <div class="summary-value">${escapeHtml(providersText)}</div>
    </div>
  `;
}

async function executeProvisioning() {
  if (!wizard) return;
  executionStatus.className = "execution-status info";
  executionStatus.textContent = "Running automated setup in Google Cloud Shell... Please wait.";
  btnExecuteProvision.disabled = true;

  try {
    const res = await fetch("/api/provision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: wizard.get_provisioning_script(),
        env: wizard.get_env_file(),
        projectId: inputProjectId.value.trim()
      })
    });

    if (res.ok) {
      const data = await res.json();
      executionStatus.className = "execution-status success";
      executionStatus.textContent = data.message || "Alfred was successfully provisioned and deployed!";
    } else {
      const err = await res.json();
      throw new Error(err.error || "Provisioning API returned an error.");
    }
  } catch (err) {
    executionStatus.className = "execution-status error";
    executionStatus.textContent = "Automated execution note: You can copy the bash script below and paste directly into your Cloud Shell terminal.";
  } finally {
    btnExecuteProvision.disabled = false;
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

start();
