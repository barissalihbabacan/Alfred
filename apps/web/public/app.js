// State Management
let isGenerating = false;
let isRecording = false;
let recognition = null;
let abortController = null;
let currentConversationId = localStorage.getItem("alfred_conversation_id") || null;

async function getAuthHeader() {
  if (window.firebaseAuth && window.firebaseAuth.currentUser) {
    try {
      const token = await window.firebaseAuth.currentUser.getIdToken();
      if (token) return { "Authorization": `Bearer ${token}` };
    } catch (e) {
      console.warn("[Auth] Failed to obtain ID token:", e);
    }
  }
  return {};
}

// ALLOWED_UID is defined once, in firebase-app.js (as window.ALLOWED_UID).
// That module script executes after this deferred classic script, so read it
// lazily at call time, never at top level. Callers run after DOMContentLoaded
// or on user action, by which point the module has run.
function getCurrentUserId() {
  return window.firebaseAuth?.currentUser?.uid || window.ALLOWED_UID;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SVG_ICONS = {
  hat: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#121212" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M6 18V8a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 8v10"/><path d="M6 14.5h12"/></svg>`,
  copy: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  check: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  speaker: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`,
  chat: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px; flex-shrink: 0; color: var(--text-muted);"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  alert: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  trash: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
  chevron: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`
};

function renderMarkdown(text) {
  if (!text) return "";

  // Completely remove <think>...</think> or unclosed <think>... from display
  const cleanText = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
  if (!cleanText) {
    return "";
  }

  let html = escapeHtml(cleanText);

  // Multi-line code blocks: ```lang ... ```
  const codeBlocks = [];
  html = html.replace(/```(?:([a-zA-Z0-9_-]+)\n)?([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    const cleanCode = code.replace(/^\n+|\n+$/g, "");
    const language = lang || "code";
    codeBlocks.push(`
      <div class="code-container">
        <div class="code-header">
          <span>${language}</span>
          <button class="copy-btn" onclick="copyCode(this)">
            <span>${SVG_ICONS.copy} <span>Kopyala</span></span>
          </button>
        </div>
        <pre class="code-content"><code>${cleanCode}</code></pre>
      </div>
    `);
    return `§§CODEBLOCK${idx}§§`;
  });

  // Inline code: `code`
  const inlineCodes = [];
  html = html.replace(/`([^`\n]+)`/g, (_m, c) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code class="inline-code">${c}</code>`);
    return `§§INLINECODE${idx}§§`;
  });

  // Bold + Italic
  html = html.replace(/\*\*\*([^\*]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*([^\*]+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^\*]+?)\*/g, "<em>$1</em>");
  html = html.replace(/~~([^~]+?)~~/g, "<del>$1</del>");

  // Paragraphs & Lists
  html = html.split("\n\n").map(para => {
    const trimmed = para.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("§§CODEBLOCK")) return trimmed;

    // Check if paragraph is an unordered list
    if (/^[-*]\s+/m.test(trimmed)) {
      const lines = trimmed.split("\n");
      let listHtml = "";
      let inUl = false;
      for (const line of lines) {
        const m = line.match(/^[-*]\s+(.*)$/);
        if (m) {
          if (!inUl) { listHtml += "<ul>"; inUl = true; }
          listHtml += `<li>${m[1]}</li>`;
        } else {
          if (inUl) { listHtml += "</ul>"; inUl = false; }
          if (line.trim()) listHtml += `<p>${line.trim()}</p>`;
        }
      }
      if (inUl) listHtml += "</ul>";
      return listHtml;
    }

    // Check if paragraph is an ordered list
    if (/^\d+\.\s+/m.test(trimmed)) {
      const lines = trimmed.split("\n");
      let listHtml = "";
      let inOl = false;
      for (const line of lines) {
        const m = line.match(/^\d+\.\s+(.*)$/);
        if (m) {
          if (!inOl) { listHtml += "<ol>"; inOl = true; }
          listHtml += `<li>${m[1]}</li>`;
        } else {
          if (inOl) { listHtml += "</ol>"; inOl = false; }
          if (line.trim()) listHtml += `<p>${line.trim()}</p>`;
        }
      }
      if (inOl) listHtml += "</ol>";
      return listHtml;
    }

    return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
  }).join("");

  // Restore protected code blocks & inline codes
  html = html.replace(/§§INLINECODE(\d+)§§/g, (_m, idx) => inlineCodes[Number(idx)]);
  html = html.replace(/§§CODEBLOCK(\d+)§§/g, (_m, idx) => codeBlocks[Number(idx)]);

  return html;
}

function copyAssistantMessage(btn) {
  const body = btn.closest(".assistant-body");
  if (!body) return;
  const textEl = body.querySelector(".assistant-text");
  if (!textEl) return;

  const textToCopy = textEl.innerText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
  copyTextToClipboard(textToCopy, btn);
}

function copyTextToClipboard(text, btn) {
  const applySuccess = () => {
    btn.innerHTML = `<span class="copied-anim">${SVG_ICONS.check} <span>Kopyalandı</span></span>`;
    setTimeout(() => {
      btn.innerHTML = `${SVG_ICONS.copy} <span>Kopyala</span>`;
    }, 2000);
  };

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(applySuccess).catch(() => {
      fallbackCopy(text);
      applySuccess();
    });
  } else {
    fallbackCopy(text);
    applySuccess();
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "-9999px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
  } catch (e) {
    console.warn("Fallback copy failed:", e);
  }
  document.body.removeChild(ta);
}

function copyCode(btn) {
  const container = btn.closest(".code-container");
  const code = container.querySelector("code").innerText;
  copyTextToClipboard(code, btn);
}

function speakText(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const isTurkish = /[çğıöşüÇĞİÖŞÜ]/i.test(text);
  utterance.lang = isTurkish ? "tr-TR" : "en-GB";
  utterance.rate = 1.0;
  window.speechSynthesis.speak(utterance);
}

// UI Status Helpers
function setStatus(status, text) {
  const dot = document.getElementById("statusDot");
  const label = document.getElementById("statusText");
  dot.className = "status-dot " + (status || "");
  label.innerText = text;
}

// Sidebar Toggle
function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebar.classList.toggle("collapsed");
}

// Textarea Auto-expand & Send Button State
function handleTextareaInput(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = Math.min(textarea.scrollHeight, 160) + "px";

  const sendBtn = document.getElementById("sendBtn");
  if (textarea.value.trim().length > 0 && !isGenerating) {
    sendBtn.classList.add("active");
  } else if (!isGenerating) {
    sendBtn.classList.remove("active");
  }
}

function handleKeyDown(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    handleSendClick();
  }
}

function handleSendClick() {
  if (isGenerating) {
    // Cancel/Stop generation
    if (abortController) {
      abortController.abort();
    }
    return;
  }

  const input = document.getElementById("userInput");
  const text = input.value.trim();
  if (!text) return;

  input.value = "";
  input.style.height = "auto";
  document.getElementById("sendBtn").classList.remove("active");
  sendMessage(text);
}

function scrollToBottom() {
  const scrollArea = document.getElementById("chatScrollArea");
  scrollArea.scrollTop = scrollArea.scrollHeight;
}

function hideWelcomeScreen() {
  const welcome = document.getElementById("welcomeScreen");
  if (welcome) welcome.style.display = "none";
}

function showWelcomeScreen() {
  const welcome = document.getElementById("welcomeScreen");
  if (welcome) welcome.style.display = "flex";
}

// Append Message to UI
function appendUserMessage(text) {
  hideWelcomeScreen();
  const list = document.getElementById("messagesList");
  const row = document.createElement("div");
  row.className = "message-row user";
  row.innerHTML = `<div class="user-bubble">${renderMarkdown(text)}</div>`;
  list.appendChild(row);
  scrollToBottom();
}

function appendAssistantMessagePlaceholder() {
  hideWelcomeScreen();
  const list = document.getElementById("messagesList");
  const row = document.createElement("div");
  row.className = "message-row assistant";

  const avatar = `<div class="assistant-avatar">${SVG_ICONS.hat}</div>`;
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  row.innerHTML = `
    ${avatar}
    <div class="assistant-body">
      <div class="assistant-meta">
        <span>ALFRED</span>
        <span style="color: var(--text-muted); font-weight: normal;">•</span>
        <span style="color: var(--text-muted); font-weight: normal;">${timeStr}</span>
      </div>
      <div class="assistant-text">
        <div class="thinking-bubble">
          <span class="thinking-dot"></span>
          <span class="thinking-dot"></span>
          <span class="thinking-dot"></span>
          <span>Düşünüyor...</span>
        </div>
      </div>
      <div class="assistant-actions" style="display: none;"></div>
    </div>
  `;

  list.appendChild(row);
  scrollToBottom();

  const textContainer = row.querySelector(".assistant-text");
  const actionsContainer = row.querySelector(".assistant-actions");

  return {
    update(fullText) {
      const rendered = renderMarkdown(fullText);
      if (rendered) {
        textContainer.innerHTML = rendered;
      } else {
        textContainer.innerHTML = `
          <div class="thinking-bubble">
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
            <span class="thinking-dot"></span>
            <span>Düşünüyor...</span>
          </div>
        `;
      }
      scrollToBottom();
    },
    finish(fullText) {
      const rendered = renderMarkdown(fullText);
      textContainer.innerHTML = rendered || "<em>(Yanıt boş)</em>";
      actionsContainer.style.display = "flex";
      actionsContainer.innerHTML = `
        <button class="assistant-action-btn" onclick="copyAssistantMessage(this)">${SVG_ICONS.copy} <span>Kopyala</span></button>
      `;
      scrollToBottom();
    },
    error(errText) {
      textContainer.innerHTML = `<span style="color: var(--danger);">${SVG_ICONS.alert} ${escapeHtml(errText)}</span>`;
      scrollToBottom();
    }
  };
}

// Google reCAPTCHA Enterprise Token Generator
async function getRecaptchaToken(action = "CHAT") {
  try {
    if (window.grecaptcha && window.grecaptcha.enterprise) {
      return await new Promise((resolve) => {
        grecaptcha.enterprise.ready(async () => {
          try {
            const token = await grecaptcha.enterprise.execute("6Lfkr68tAAAAAKOEJoZyf11tapRzOI1LP4Er6AmL", { action });
            resolve(token);
          } catch (e) {
            console.warn("[reCAPTCHA] Execution failed:", e);
            resolve(null);
          }
        });
      });
    }
  } catch (err) {
    console.warn("[reCAPTCHA] Unavailable:", err);
  }
  return null;
}

// Send Message with SSE Streaming
async function sendMessage(text) {
  appendUserMessage(text);

  isGenerating = true;
  const sendBtn = document.getElementById("sendBtn");
  sendBtn.classList.add("stop");
  sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>`;
  setStatus("thinking", "Thinking...");

  const placeholder = appendAssistantMessagePlaceholder();
  let accumulatedText = "";
  abortController = new AbortController();
  const turnController = abortController;
  // Sunucu "done" sonrasi bellek kaydi icin baglantiyi birkac saniye acik
  // tutabilir; giris alani "done" gelince serbest birakilir. Yalnizca bu tur
  // hala aktifse sifirla, yeni bir turun durumunu ezme.
  const releaseComposer = () => {
    if (abortController !== turnController) return;
    isGenerating = false;
    abortController = null;
    sendBtn.classList.remove("stop");
    sendBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
    handleTextareaInput(document.getElementById("userInput"));
    setStatus("ready", "Ready");
  };

  try {
    const requestHeaders = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream"
    };

    const recaptchaToken = await getRecaptchaToken("CHAT");
    if (recaptchaToken) {
      requestHeaders["x-recaptcha-token"] = recaptchaToken;
    }

    if (typeof window.getAppCheckToken === "function") {
      const appCheckToken = await window.getAppCheckToken().catch(() => null);
      if (appCheckToken) {
        requestHeaders["X-Firebase-AppCheck"] = appCheckToken;
      }
    }

    const authHeaders = await getAuthHeader();
    Object.assign(requestHeaders, authHeaders);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        message: text,
        conversationId: currentConversationId || undefined,
        userId: getCurrentUserId(),
        stream: true,
        recaptchaToken: recaptchaToken || undefined
      }),
      signal: abortController.signal
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Sunucu hatası (${res.status})`);
    }

    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          const trimmed = block.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.replace(/^data:\s*/, "");
          try {
            const event = JSON.parse(dataStr);
            if (event.type === "start") {
              if (event.conversationId) {
                currentConversationId = event.conversationId;
                localStorage.setItem("alfred_conversation_id", event.conversationId);
                updateCurrentConvItemTitle(text);
                refreshConversationsList();
              }
              setStatus("thinking", "Thinking...");
            } else if (event.type === "thinking") {
              setStatus("thinking", "Thinking...");
            } else if (event.type === "chunk") {
              setStatus("streaming", "Responding...");
              accumulatedText += (event.text || "");
              placeholder.update(accumulatedText);
            } else if (event.type === "done") {
              placeholder.finish(accumulatedText);
              releaseComposer();
            } else if (event.type === "error") {
              throw new Error(event.error || "Streaming hatası oluştu.");
            }
          } catch (parseErr) {
            if (parseErr.message && parseErr.message !== "Unexpected end of JSON input") {
              console.warn("Parse error:", parseErr);
            }
          }
        }
      }

      if (accumulatedText) {
        placeholder.finish(accumulatedText);
      }
    }
  } catch (err) {
    if (err.name === "AbortError") {
      placeholder.finish(accumulatedText ? accumulatedText + "\n\n*(Yanıt Barış tarafından durduruldu)*" : "Yanıt durduruldu.");
    } else {
      placeholder.error(err.message || "İletişim sırasında bir hata oluştu.");
    }
  } finally {
    releaseComposer();
  }
}

// Conversation Management
function startNewConversation() {
  currentConversationId = null;
  localStorage.removeItem("alfred_conversation_id");
  document.getElementById("messagesList").innerHTML = "";
  showWelcomeScreen();
  const currentItem = document.getElementById("currentConvItem");
  if (currentItem) {
    currentItem.classList.add("active");
    currentItem.querySelector(".conv-item-title").innerText = "Yeni Sohbet";
  }
  setStatus("ready", "Ready");
}

function updateCurrentConvItemTitle(title) {
  const currentItem = document.getElementById("currentConvItem");
  if (currentItem) {
    const shortTitle = title.length > 25 ? title.slice(0, 23) + "..." : title;
    currentItem.querySelector(".conv-item-title").innerText = shortTitle;
  }
}

function renderConversationsSkeleton() {
  const container = document.getElementById("conversationsContainer");
  if (!container) return;
  container.innerHTML = `
    <div class="conv-skeleton-item">
      <div class="skeleton-shimmer conv-skeleton-icon"></div>
      <div class="skeleton-shimmer conv-skeleton-text" style="width: 75%;"></div>
    </div>
    <div class="conv-skeleton-item">
      <div class="skeleton-shimmer conv-skeleton-icon"></div>
      <div class="skeleton-shimmer conv-skeleton-text" style="width: 60%;"></div>
    </div>
    <div class="conv-skeleton-item">
      <div class="skeleton-shimmer conv-skeleton-icon"></div>
      <div class="skeleton-shimmer conv-skeleton-text" style="width: 85%;"></div>
    </div>
    <div class="conv-skeleton-item">
      <div class="skeleton-shimmer conv-skeleton-icon"></div>
      <div class="skeleton-shimmer conv-skeleton-text" style="width: 70%;"></div>
    </div>
  `;
}

function renderMessagesSkeleton() {
  const list = document.getElementById("messagesList");
  if (!list) return;
  list.innerHTML = `
    <div class="message-skeleton-wrap">
      <div class="message-skeleton-row user">
        <div class="skeleton-shimmer message-skeleton-user-pill"></div>
      </div>
      <div class="message-skeleton-row">
        <div class="skeleton-shimmer message-skeleton-avatar"></div>
        <div class="message-skeleton-body">
          <div class="skeleton-shimmer message-skeleton-line" style="width: 85%;"></div>
          <div class="skeleton-shimmer message-skeleton-line" style="width: 70%;"></div>
          <div class="skeleton-shimmer message-skeleton-line" style="width: 45%;"></div>
        </div>
      </div>
    </div>
  `;
}

async function loadConversation(id) {
  if (!id) return;
  try {
    currentConversationId = id;
    localStorage.setItem("alfred_conversation_id", id);
    highlightActiveConversation(id);
    hideWelcomeScreen();
    renderMessagesSkeleton();

    const authHeaders = await getAuthHeader();
    const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`, {
      headers: authHeaders
    });
    if (!res.ok) return;
    const data = await res.json();

    if (data.success && Array.isArray(data.messages)) {
      hideWelcomeScreen();
      const list = document.getElementById("messagesList");
      list.innerHTML = "";

      for (const msg of data.messages) {
        if (msg.role === "user") {
          const row = document.createElement("div");
          row.className = "message-row user";
          row.innerHTML = `<div class="user-bubble">${renderMarkdown(msg.content)}</div>`;
          list.appendChild(row);
        } else if (msg.role === "assistant") {
          const row = document.createElement("div");
          row.className = "message-row assistant";
          const timeStr = msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
          row.innerHTML = `
            <div class="assistant-avatar">${SVG_ICONS.hat}</div>
            <div class="assistant-body">
              <div class="assistant-meta">
                <span>ALFRED</span>
                <span style="color: var(--text-muted); font-weight: normal;">•</span>
                <span style="color: var(--text-muted); font-weight: normal;">${timeStr}</span>
              </div>
              <div class="assistant-text">${renderMarkdown(msg.content)}</div>
              <div class="assistant-actions">
                <button class="assistant-action-btn" onclick="copyAssistantMessage(this)">${SVG_ICONS.copy} <span>Kopyala</span></button>
              </div>
            </div>
          `;
          list.appendChild(row);
        }
      }
      scrollToBottom();
      highlightActiveConversation(id);
    }
  } catch (err) {
    console.warn("Could not load conversation:", err);
  }
}

function highlightActiveConversation(id) {
  const items = document.querySelectorAll(".conv-item");
  items.forEach(el => {
    if (el.dataset.id === id) {
      el.classList.add("active");
    } else {
      el.classList.remove("active");
    }
  });
}

async function refreshConversationsList(showSkeleton = false) {
  const container = document.getElementById("conversationsContainer");
  if (showSkeleton && container) {
    renderConversationsSkeleton();
  }
  try {
    const authHeaders = await getAuthHeader();
    const res = await fetch(`/api/chat?userId=${encodeURIComponent(getCurrentUserId())}`, {
      headers: authHeaders
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.success && Array.isArray(data.conversations)) {
      if (!container) return;
      container.innerHTML = "";

      if (data.conversations.length === 0) {
        container.innerHTML = `<div style="padding: 12px 10px; font-size: 12px; color: var(--text-muted);">Henüz kayıtlı sohbet bulunmuyor.</div>`;
        return;
      }

      for (const conv of data.conversations) {
        const item = document.createElement("div");
        item.className = "conv-item" + (conv.id === currentConversationId ? " active" : "");
        item.dataset.id = conv.id;
        item.onclick = (e) => {
          if (e.target.closest(".conv-item-delete")) return;
          loadConversation(conv.id);
        };
        item.innerHTML = `
          <div style="display: flex; align-items: center; min-width: 0; flex: 1;">
            ${SVG_ICONS.chat}
            <span class="conv-item-title">${escapeHtml(conv.title || "Sohbet")}</span>
          </div>
          <button class="conv-item-delete" onclick="handleDeleteConversation(event, '${escapeHtml(conv.id)}')" title="Sohbeti Sil">
            ${SVG_ICONS.trash}
          </button>
        `;
        container.appendChild(item);
      }
    }
  } catch (err) {
    console.warn("Could not load conversations list:", err);
  }
}

async function handleDeleteConversation(event, id) {
  event.stopPropagation();
  if (!confirm("Bu sohbeti silmek istediğinizden emin misiniz?")) return;

  try {
    const authHeaders = await getAuthHeader();
    const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: authHeaders
    });
    if (!res.ok) {
      throw new Error("Sohbet silinemedi");
    }

    if (currentConversationId === id) {
      startNewConversation();
    }
    await refreshConversationsList();
  } catch (err) {
    console.error("Delete conversation failed:", err);
    alert("Sohbet silinirken bir hata oluştu.");
  }
}

// STT Microphone Control
function toggleMicrophone() {
  if (isRecording) {
    if (recognition) recognition.stop();
    isRecording = false;
    document.getElementById("micBtn").classList.remove("active");
    setStatus("ready", "Ready");
    return;
  }

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    alert("Tarayıcınız Web Speech API mikrofon girişini desteklemiyor.");
    return;
  }

  recognition = new SpeechRec();
  const lang = document.getElementById("sttLangSelect").value;
  recognition.lang = lang;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecording = true;
    document.getElementById("micBtn").classList.add("active");
    setStatus("listening", "Dinleniyor (" + (lang === "tr-TR" ? "Türkçe" : "English") + ")...");
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    const input = document.getElementById("userInput");
    const existingVal = input.value;
    input.value = existingVal ? existingVal + " " + transcript : transcript;
    handleTextareaInput(input);
    input.focus();
  };

  recognition.onerror = (event) => {
    console.warn("Speech error:", event.error);
    isRecording = false;
    document.getElementById("micBtn").classList.remove("active");
    setStatus("ready", "Ready");
  };

  recognition.onend = () => {
    isRecording = false;
    document.getElementById("micBtn").classList.remove("active");
    setStatus("ready", "Ready");
  };

  recognition.start();
}

// Provider Modal Control
function openProviderModal() {
  const ollamaUrl = localStorage.getItem("alfred_ollama_url") || "http://100.64.0.53:11434";
  const ollamaEl = document.getElementById("ollamaUrlInput");
  if (ollamaEl) ollamaEl.value = ollamaUrl;
  document.getElementById("providerModal").classList.add("open");
}

function closeProviderModal() {
  document.getElementById("providerModal").classList.remove("open");
}

function saveProviderSettings() {
  const ollamaUrl = document.getElementById("ollamaUrlInput").value.trim();
  if (ollamaUrl) localStorage.setItem("alfred_ollama_url", ollamaUrl);
  closeProviderModal();
}

// Tools Menu Toggle (+ rotates to x)
function toggleToolsMenu(e) {
  if (e) e.stopPropagation();
  const btn = document.getElementById("toolsBtn");
  if (btn) {
    btn.classList.toggle("active");
  }
}

// Initialization
// firebase-app.js, yetkili kullanici dogrulaninca bu olayi yayinlar. app.js
// ondan once yuklendigi icin dinleyici her zaman hazirdir.
window.addEventListener("alfred:authenticated", () => {
  refreshConversationsList();
  if (currentConversationId) {
    loadConversation(currentConversationId);
  }
});

window.addEventListener("DOMContentLoaded", () => {
  // API anahtarlari artik yalnizca sunucuda (Secret Manager) tutuluyor;
  // eski surumlerin tarayiciya kaydettigi kopyalari temizle.
  localStorage.removeItem("alfred_groq_api_key");
  localStorage.removeItem("alfred_gemini_api_key");
  setStatus("ready", "Ready");

  // Check active provider from server
  fetch("/api/health")
    .then(r => r.json())
    .then(data => {
      if (data && data.activeProvider === "groq") {
        const topEl = document.getElementById("topModelLabel");
        if (topEl) topEl.textContent = "openai/gpt-oss-120b";
      }
    })
    .catch(() => {});

  // Konusma listesi ve son konusma, oturum dogrulaninca yuklenir
  // ("alfred:authenticated"); API artik token'siz istekleri reddediyor.
  if (!currentConversationId) {
    showWelcomeScreen();
  }

  // Close tools menu when clicking anywhere outside
  document.addEventListener("click", (e) => {
    const btn = document.getElementById("toolsBtn");
    if (btn && btn.classList.contains("active") && !btn.contains(e.target)) {
      btn.classList.remove("active");
    }
  });

  // Keyboard shortcut: Cmd/Ctrl + K for new chat
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      startNewConversation();
    }
  });
});
