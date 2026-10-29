import init, {
  wasm_validate_project_id,
  wasm_validate_email,
  wasm_validate_uid,
  wasm_validate_api_key,
  wasm_validate_ollama_url,
  wasm_generate_env,
  wasm_generate_script,
  wasm_get_summary,
  WasmWizard
} from "./wasm/alfred_setup_core.js";

let wizard = null;
let wasmReady = false;

// DOM Elements
const stepPanels = [
  document.getElementById("step-0"),
  document.getElementById("step-1"),
  document.getElementById("step-2"),
  document.getElementById("step-3"),
  document.getElementById("step-4")
];
const stepNavItems = document.querySelectorAll(".step-item");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const footerStatus = document.getElementById("footer-status");

// Inputs
const inputProjectId = document.getElementById("project-id");
const btnGenerateProject = document.getElementById("btn-generate-project");
const selectBillingAccount = document.getElementById("billing-account");
const selectFirestoreRegion = document.getElementById("firestore-region");
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

// Post-setup elements
const linkFirebaseAuth = document.getElementById("link-firebase-auth");
const linkFirebaseAppCheck = document.getElementById("link-firebase-appcheck");
const linkDeployedApp = document.getElementById("link-deployed-app");

// Live Terminal Console Elements
const liveConsoleContainer = document.getElementById("live-console-container");
const consoleOutput = document.getElementById("console-output");
const consoleStageText = document.getElementById("console-stage-text");
const consoleTimer = document.getElementById("console-timer");
const consoleDot = document.getElementById("console-dot");
let timerInterval = null;

async function start() {
  try {
    await init();
    wasmReady = true;
    wizard = new WasmWizard();
    console.log("[Alfred Setup-UI] WebAssembly core initialized successfully.");
    bindEvents();
    renderStep();
    await loadBillingAccounts();
  } catch (err) {
    console.error("[Alfred Setup-UI] Failed to initialize WASM module:", err);
    footerStatus.textContent = "Error initializing WebAssembly module.";
  }
}

async function loadBillingAccounts() {
  if (!selectBillingAccount) return;
  try {
    const setupToken = document.querySelector('meta[name="setup-token"]')?.getAttribute("content") || "";
    const res = await fetch("/api/billing-accounts", {
      headers: { "X-Setup-Token": setupToken }
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.accounts) && data.accounts.length > 0) {
        selectBillingAccount.innerHTML = `<option value="">⚡ Auto-link first available open billing account</option>`;
        data.accounts.forEach(acc => {
          const opt = document.createElement("option");
          opt.value = acc.id;
          opt.textContent = `${acc.displayName} (${acc.id})`;
          selectBillingAccount.appendChild(opt);
        });
      }
    }
  } catch (err) {
    console.warn("[Alfred Setup-UI] Could not fetch billing accounts:", err);
  }
}

function updatePostSetupLinks(projectId) {
  const id = projectId || inputProjectId.value.trim() || "your-project";
  if (linkFirebaseAuth) {
    linkFirebaseAuth.href = `https://console.firebase.google.com/project/${id}/authentication/providers`;
  }
  if (linkFirebaseAppCheck) {
    linkFirebaseAppCheck.href = `https://console.firebase.google.com/project/${id}/appcheck`;
  }
  if (linkDeployedApp) {
    linkDeployedApp.href = `https://${id}.web.app`;
  }
  document.querySelectorAll(".project-domain-preview").forEach(el => {
    el.textContent = id;
  });
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
      updatePostSetupLinks(generatedId);
      clearFooterStatus();
    });
  }

  // Input live validations via WASM
  inputProjectId.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    wizard.set_project_id(val);
    validateField(valProjectId, () => wasm_validate_project_id(val));
    updatePostSetupLinks(val);
    clearFooterStatus();
  });

  if (selectBillingAccount) {
    selectBillingAccount.addEventListener("change", (e) => {
      wizard.set_billing_account_id(e.target.value.trim());
    });
  }

  if (selectFirestoreRegion) {
    selectFirestoreRegion.addEventListener("change", (e) => {
      wizard.set_firestore_region(e.target.value.trim());
    });
  }

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
      valAllowedUid.textContent = "ℹ️ (Optional) UID boşsa yetki doğrulanmış e-posta ile verilir";
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
    if (!val) {
      valEvrenKey.className = "validation-message valid";
      valEvrenKey.textContent = "ℹ️ (Optional) Can be configured later";
    } else {
      validateField(valEvrenKey, () => wasm_validate_api_key("evren", val));
    }
    clearFooterStatus();
  });

  inputOllamaUrl.addEventListener("input", (e) => {
    const val = e.target.value.trim();
    wizard.set_ollama_url(val);
    if (!val) {
      valOllamaUrl.className = "validation-message valid";
      valOllamaUrl.textContent = "ℹ️ (Optional) Defaults to http://localhost:11434";
    } else {
      validateField(valOllamaUrl, () => wasm_validate_ollama_url(val));
    }
    clearFooterStatus();
  });

  // Navigation Buttons
  btnNext.addEventListener("click", () => {
    if (!wizard) return;
    try {
      wizard.next_step();
      renderStep();
    } catch (err) {
      footerStatus.textContent = err.toString();
    }
  });

  btnPrev.addEventListener("click", () => {
    if (!wizard) return;
    wizard.prev_step();
    renderStep();
  });

  // Direct Stepper Nav Clicking
  stepNavItems.forEach((item) => {
    item.addEventListener("click", () => {
      const targetStep = parseInt(item.getAttribute("data-step"), 10);
      const current = wizard.get_current_step();
      if (targetStep < current) {
        while (wizard.get_current_step() > targetStep) {
          wizard.prev_step();
        }
        renderStep();
      } else if (targetStep > current) {
        while (wizard.get_current_step() < targetStep) {
          try {
            wizard.next_step();
          } catch {
            break;
          }
        }
        renderStep();
      }
    });
  });

  // Action Buttons
  btnCopyScript.addEventListener("click", () => {
    if (!wizard) return;
    const script = wizard.get_provisioning_script();
    navigator.clipboard.writeText(script).then(() => {
      btnCopyScript.textContent = "✓ Copied!";
      setTimeout(() => {
        btnCopyScript.textContent = "📋 Copy Provisioning Script";
      }, 2000);
    });
  });

  btnDownloadEnv.addEventListener("click", () => {
    if (!wizard) return;
    const envContent = wizard.get_env_file();
    const blob = new Blob([envContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ".env";
    a.click();
    URL.revokeObjectURL(url);
  });

  btnExecuteProvision.addEventListener("click", () => {
    executeProvisioning();
  });
}

function validateField(elem, validationFn) {
  try {
    const outcome = validationFn();
    const warnings = Array.isArray(outcome?.warnings) ? outcome.warnings : [];
    if (warnings.length > 0) {
      elem.className = "validation-message warning";
      elem.textContent = warnings.join("; ");
    } else {
      elem.className = "validation-message valid";
      elem.textContent = "✓ Valid";
    }
  } catch (err) {
    elem.className = "validation-message invalid";
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
    if (panel) {
      panel.classList.toggle("active", idx === current);
    }
  });

  // Stepper
  stepNavItems.forEach((item, idx) => {
    item.classList.toggle("active", idx === current);
    item.classList.toggle("completed", idx < current);
  });

  // Buttons
  btnPrev.disabled = current === 0;
  if (current === total - 1) {
    // Step 5: Post-setup checklist
    btnNext.style.display = "none";
    updatePostSetupLinks();
  } else if (current === 3) {
    // Step 4: Review & Deploy
    btnNext.style.display = "inline-block";
    btnNext.textContent = "Next: Post-Setup \u2192";
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
  if (scriptPreview) {
    scriptPreview.textContent = script;
  }

  const projectId = inputProjectId.value.trim();
  const region = selectFirestoreRegion?.value || "europe-west1";
  const billingAcc = selectBillingAccount?.value
    ? (selectBillingAccount.options[selectBillingAccount.selectedIndex]?.text || selectBillingAccount.value)
    : "Auto-link first open account";
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
      <div class="summary-label">Firestore Region</div>
      <div class="summary-value">${escapeHtml(region)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Billing Account</div>
      <div class="summary-value">${escapeHtml(billingAcc)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Allowed User</div>
      <div class="summary-value">${escapeHtml(allowedEmail)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Firebase Auth UID</div>
      <div class="summary-value">${allowedUid ? escapeHtml(allowedUid) : "<span style='color:var(--gold)'>UID boşsa yetki doğrulanmış e-posta ile verilir</span>"}</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Model Providers</div>
      <div class="summary-value">${escapeHtml(providersText)}</div>
    </div>
  `;
}

async function executeProvisioning() {
  if (!wizard) return;
  const projectId = inputProjectId.value.trim();

  // Reset and show console
  liveConsoleContainer.classList.remove("hidden");
  consoleOutput.textContent = "";
  consoleStageText.textContent = "Starting provisioning engine...";
  consoleDot.className = "live-dot";
  executionStatus.className = "execution-status hidden";
  executionStatus.textContent = "";
  btnExecuteProvision.disabled = true;

  // Start timer
  const startTime = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    const m = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
    const s = String(elapsedSec % 60).padStart(2, "0");
    consoleTimer.textContent = `${m}:${s}`;
  }, 1000);

  try {
    const setupToken = document.querySelector('meta[name="setup-token"]')?.getAttribute("content") || "";

    const res = await fetch("/api/provision", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Setup-Token": setupToken
      },
      body: JSON.stringify({
        config: {
          project_id: projectId,
          firestore_region: selectFirestoreRegion?.value || "europe-west1",
          billing_account_id: selectBillingAccount?.value || null,
          allowed_email: inputAllowedEmail.value.trim(),
          allowed_uid: inputAllowedUid.value.trim(),
          groq_api_key: inputGroqKey.value.trim(),
          gemini_api_key: inputGeminiKey.value.trim(),
          tavily_api_key: inputTavilyKey.value.trim(),
          evren_api_key: inputEvrenKey.value.trim() || null,
          ollama_url: inputOllamaUrl.value.trim() || null
        }
      })
    });

    if (!res.ok) {
      let errText = `Server returned HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson?.error) errText = errJson.error;
      } catch {}
      throw new Error(errText);
    }

    if (!res.body) {
      throw new Error("Readable stream is not supported in this browser.");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";
    let resultJson = null;

    function processLine(rawLine) {
      const line = rawLine.trim();
      if (!line) return;

      if (line.startsWith("__ALFRED_RESULT__")) {
        try {
          resultJson = JSON.parse(line.slice("__ALFRED_RESULT__".length).trim());
        } catch {}
        return;
      }

      if (line.includes("Deploying to Firebase")) {
        consoleStageText.textContent = "🚀 Deploying Web App & Cloud Functions...";
      } else if (line.includes("Building Next.js web application")) {
        consoleStageText.textContent = "🏗️ Building Next.js 16 Web Application...";
      } else if (line.includes("Installing dependencies")) {
        consoleStageText.textContent = "📦 Installing npm dependencies...";
      } else if (line.includes("Provisioning Secret Manager vault")) {
        consoleStageText.textContent = "🛡️ Writing Secret Manager credentials...";
      } else if (line.includes("Ensuring Firebase is enabled") || line.includes("Adding Firebase resources")) {
        consoleStageText.textContent = "🔥 Configuring Firebase project...";
      } else if (line.includes("Enabling required Google Cloud")) {
        consoleStageText.textContent = "🔑 Enabling Cloud APIs & Firestore...";
      } else if (line.includes("Linking") || line.includes("billing account")) {
        consoleStageText.textContent = "💳 Linking Google Cloud billing account...";
      } else if (line.includes("Creating it in Google Cloud") || line.includes("Create in progress")) {
        consoleStageText.textContent = "🚀 Creating Google Cloud project...";
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      consoleOutput.textContent += chunk;
      consoleOutput.scrollTop = consoleOutput.scrollHeight;

      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() || "";
      for (const line of lines) {
        processLine(line);
      }
    }

    // Flush any remaining decoder stream bytes and buffer
    lineBuffer += decoder.decode();
    if (lineBuffer) {
      const lines = lineBuffer.split("\n");
      for (const line of lines) {
        processLine(line);
      }
    }

    // Determine completion strictly from __ALFRED_RESULT__
    const isSuccess = resultJson?.ok === true;

    if (isSuccess) {
      consoleDot.className = "live-dot done";
      consoleStageText.textContent = "✨ Setup & Deployment Completed!";
      executionStatus.className = "execution-status success";
      const appUrl = resultJson?.url || `https://${escapeHtml(projectId)}.web.app`;
      updatePostSetupLinks(projectId);
      executionStatus.innerHTML = `🎉 <strong>Alfred is live!</strong> Open your application: <a href="${escapeHtml(appUrl)}" target="_blank" style="color:var(--gold); text-decoration:underline;">${escapeHtml(appUrl)}</a><div style="margin-top:12px;"><button type="button" class="btn btn-gold btn-sm" id="btn-goto-postsetup">View Post-Deployment Checklist &rarr;</button></div>`;
      document.getElementById("btn-goto-postsetup")?.addEventListener("click", () => {
        wizard.next_step();
        renderStep();
      });
    } else {
      consoleDot.className = "live-dot error";
      consoleStageText.textContent = "⚠️ Deployment encountered an error";
      executionStatus.className = "execution-status error";
      const errDetail = resultJson?.exitCode !== undefined
        ? ` (script exit code: ${resultJson.exitCode})`
        : (resultJson?.error ? `: ${resultJson.error}` : "");
      executionStatus.textContent = `Setup failed${errDetail}. Inspect the terminal output above for details.`;
    }
  } catch (err) {
    consoleDot.className = "live-dot error";
    consoleStageText.textContent = "❌ Connection or Execution Error";
    executionStatus.className = "execution-status error";
    const msg = err instanceof Error ? err.message : String(err);
    executionStatus.textContent = `Error: ${msg}`;
  } finally {
    if (timerInterval) clearInterval(timerInterval);
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
