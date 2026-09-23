"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../lib/AuthContext";
import { apiFetch, ensureOk } from "../lib/api";
import { createSseParser, stripThinking, ChatStreamEvent } from "../lib/sse";

export type AssistantState =
  | "Idle"
  | "Listening"
  | "Transcribing"
  | "Thinking"
  | "Streaming"
  | "Speaking"
  | "Error";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioUrl?: string;
  timestamp: string;
  isThinking?: boolean;
}

interface ConversationSummary {
  id: string;
  title: string;
  lastMessageAt?: string;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fallbackCopy(text: string) {
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

function renderMarkdown(text: string): string {
  if (!text) return "";

  // Completely remove <think>...</think> or unclosed <think>... from display
  const cleanText = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
  if (!cleanText) {
    return "";
  }

  let html = escapeHtml(cleanText);

  // Multi-line code blocks: ```lang ... ```
  const codeBlocks: string[] = [];
  html = html.replace(/```(?:([a-zA-Z0-9_-]+)\n)?([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    const cleanCode = code.replace(/^\n+|\n+$/g, "");
    const language = lang || "code";
    codeBlocks.push(`
      <div class="code-container">
        <div class="code-header">
          <span>${language}</span>
          <button class="copy-code-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(cleanCode)}')).then(()=>this.innerHTML='<span style=\\'color:#10b981;\\'>Kopyalandı</span>')"><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' style='margin-right:4px;'><rect x='9' y='9' width='13' height='13' rx='2' ry='2'/><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/></svg>Kopyala</button>
        </div>
        <pre class="code-content"><code>${cleanCode}</code></pre>
      </div>
    `);
    return `§§CODEBLOCK${idx}§§`;
  });

  // Inline code: `code`
  const inlineCodes: string[] = [];
  html = html.replace(/`([^`\n]+)`/g, (_m, c) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code class="inline-code">${c}</code>`);
    return `§§INLINECODE${idx}§§`;
  });

  // Bold + Italic: ***text***
  html = html.replace(/\*\*\*([^*]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold: **text**
  html = html.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  // Italic: *text*
  html = html.replace(/\*([^*]+?)\*/g, "<em>$1</em>");
  // Strikethrough: ~~text~~
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

const DEFAULT_MODEL_LABEL = "openai/gpt-oss-120b";
const CONVERSATION_KEY = "alfred_conversation_id";
// Eski surumlerin tarayiciya yazdigi anahtarlar. API anahtarlari artik yalnizca
// sunucuda (Secret Manager) tutuluyor; Ollama URL alani da artik yok.
const LEGACY_STORAGE_KEYS = ["alfred_groq_api_key", "alfred_gemini_api_key", "alfred_ollama_url"];

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Gizli sekme / engellenmis depolama: yok say.
  }
}

function formatTime(value?: string | number | Date): string {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Seslendirme icin `<think>` izlerini ve markdown isaretlerini temizler. */
function toSpeakableText(text: string): string {
  return stripThinking(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`~#>]/g, "")
    .trim();
}

interface HealthInfo {
  activeProvider: string;
}

interface ActiveTurn {
  id: number;
  controller: AbortController;
  /** `done`, `error` ya da iptal geldiyse true; sonrasinda gelen olaylar yok sayilir. */
  finished: boolean;
}

export default function VoiceChatPlayground() {
  const { user, logout } = useAuth();
  const currentUserId = user?.uid || null;

  const [state, setState] = useState<AssistantState>("Idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [sttLang, setSttLang] = useState("tr-TR");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [modelLabel, setModelLabel] = useState(DEFAULT_MODEL_LABEL);

  const toolsBtnRef = useRef<HTMLButtonElement | null>(null);
  const turnSeqRef = useRef(0);
  const activeTurnRef = useRef<ActiveTurn | null>(null);
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, state, scrollToBottom]);

  // Tamamlanmamis bir turu iptal eder (yeni sohbet / sohbet degistirme).
  // `done` gelmis ama sunucunun bellek kaydi icin acik tuttugu baglantiya
  // dokunulmaz; ekrandan bagimsiz olarak kapanmasi beklenir.
  const cancelActiveTurn = useCallback(() => {
    const turn = activeTurnRef.current;
    activeTurnRef.current = null;
    if (turn && !turn.finished) {
      turn.finished = true;
      turn.controller.abort();
    }
    setState("Idle");
  }, []);

  // Load conversations list (authenticated; this component only mounts once
  // Firebase has restored an allowed session).
  const fetchConversations = useCallback(async (showSkeleton = false) => {
    if (!currentUserId) return;
    if (showSkeleton) setConversationsLoading(true);
    try {
      const res = await apiFetch(`/chat?userId=${encodeURIComponent(currentUserId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.conversations)) {
          setConversations(data.conversations);
        }
      } else {
        console.warn("Failed to fetch conversation list:", res.status);
      }
    } catch (err) {
      console.warn("Failed to fetch conversation list:", err);
    } finally {
      setConversationsLoading(false);
    }
  }, [currentUserId]);

  const handleNewConversation = useCallback(() => {
    cancelActiveTurn();
    setConversationId(null);
    storageSet(CONVERSATION_KEY, null);
    setMessages([]);
    setErrorMessage(null);
    textareaRef.current?.focus();
  }, [cancelActiveTurn]);

  const loadConversation = useCallback(async (id: string) => {
    cancelActiveTurn();
    setErrorMessage(null);
    setConversationId(id);
    storageSet(CONVERSATION_KEY, id);
    setMessagesLoading(true);
    try {
      const res = await apiFetch(`/chat?conversationId=${encodeURIComponent(id)}`);
      if (res.status === 404) {
        // Silinmis (veya baska kullaniciya ait) sohbet: kayitli kimligi birak.
        setConversationId(null);
        storageSet(CONVERSATION_KEY, null);
        setMessages([]);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.messages)) {
          const loaded: Message[] = data.messages
            .filter((m: any) => m.role === "user" || m.role === "assistant")
            .map((m: any) => ({
              id: m.id || "msg-" + m.sequence,
              role: m.role,
              text: m.content,
              timestamp: formatTime(m.createdAt)
            }));
          setMessages(loaded);
        }
      }
    } catch (err) {
      console.warn("Failed to load conversation:", err);
    } finally {
      setMessagesLoading(false);
    }
  }, [cancelActiveTurn]);

  // Initial load: runs once the authenticated user is known.
  useEffect(() => {
    if (!currentUserId) return;
    for (const key of LEGACY_STORAGE_KEYS) storageSet(key, null);

    fetchConversations(true);
    const savedConvId = storageGet(CONVERSATION_KEY);
    if (savedConvId) {
      loadConversation(savedConvId);
    }
  }, [currentUserId, fetchConversations, loadConversation]);

  // Active provider (public /health endpoint, no token needed).
  useEffect(() => {
    let cancelled = false;
    apiFetch("/health", { anonymous: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.activeProvider) return;
        setHealth({ activeProvider: data.activeProvider });
        if (data.activeProvider === "groq") setModelLabel(DEFAULT_MODEL_LABEL);
        else if (data.activeProvider === "ollama") setModelLabel("gemma4:12b-mlx");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Cmd/Ctrl + K: new conversation.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        handleNewConversation();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleNewConversation]);

  // Stop recognition / speech when the component unmounts (e.g. sign-out).
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      const turn = activeTurnRef.current;
      if (turn && !turn.finished) turn.controller.abort();
    };
  }, []);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (toolsBtnRef.current && !toolsBtnRef.current.contains(e.target as Node)) {
        setToolsMenuOpen(false);
      }
    };
    if (toolsMenuOpen) {
      document.addEventListener("click", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [toolsMenuOpen]);

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Bu sohbeti silmek istediğinizden emin misiniz?")) return;

    try {
      const res = await apiFetch(`/chat?conversationId=${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        throw new Error("Sohbet silinemedi");
      }

      if (conversationId === id) {
        handleNewConversation();
      }
      await fetchConversations();
    } catch (err) {
      console.error("Delete conversation failed:", err);
      alert("Sohbet silinirken bir hata oluştu.");
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? inputText).trim();
    if (!text || state === "Thinking" || state === "Streaming" || state === "Transcribing") {
      return;
    }

    setErrorMessage(null);
    setInputText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const now = Date.now();
    const userMsg: Message = { id: "user-" + now, role: "user", text, timestamp: formatTime(now) };
    const asstId = "asst-" + now;
    const placeholderAsst: Message = {
      id: asstId,
      role: "assistant",
      text: "",
      isThinking: true,
      timestamp: formatTime(now)
    };

    setMessages((prev) => [...prev, userMsg, placeholderAsst]);
    setState("Thinking");

    // Onceki turun (done sonrasi hala acik) baglantisi varsa ona dokunulmaz; o
    // turun gec gelen olaylari `isCurrent()` kontrolu ile yok sayilir.
    const turn: ActiveTurn = { id: ++turnSeqRef.current, controller: new AbortController(), finished: false };
    activeTurnRef.current = turn;
    const isCurrent = () => activeTurnRef.current === turn;
    const updateAssistant = (patch: Partial<Message>) => {
      setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, ...patch } : m)));
    };

    // "done" geldiginde giris alani serbest birakilir; sunucu bellek kaydi icin
    // baglantiyi birkac saniye daha acik tutabilir. Yalnizca bu tur hala
    // aktifse durum sifirlanir, yeni bir turun durumu ezilmez.
    const finishTurn = () => {
      turn.finished = true;
      if (isCurrent()) setState("Idle");
    };

    let accumulatedText = "";

    try {
      const res = await apiFetch("/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream"
        },
        body: JSON.stringify({
          message: text,
          conversationId: conversationId || undefined,
          userId: currentUserId || undefined,
          stream: true
        }),
        signal: turn.controller.signal
      });
      await ensureOk(res);

      if (!res.body) {
        throw new Error("Yanıt akışı alınamadı.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser();

      const handleEvent = (event: ChatStreamEvent) => {
        if (turn.finished || !isCurrent()) return;
        switch (event.type) {
          case "start":
            if (event.model) setModelLabel(event.model);
            if (event.conversationId) {
              setConversationId(event.conversationId);
              storageSet(CONVERSATION_KEY, event.conversationId);
              fetchConversations();
            }
            setState("Thinking");
            break;
          case "thinking":
          case "tool_call":
          case "tool_result":
            setState("Thinking");
            break;
          case "chunk":
            accumulatedText += event.text || "";
            setState("Streaming");
            updateAssistant({ text: accumulatedText, isThinking: !stripThinking(accumulatedText) });
            break;
          case "done":
            updateAssistant({ text: accumulatedText || "*(Yanıt boş)*", isThinking: false });
            finishTurn();
            break;
          case "error":
            throw new Error(event.error || "Akış sırasında bir hata oluştu.");
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true })).forEach(handleEvent);
      }
      parser.push(decoder.decode()).forEach(handleEvent);
      parser.flush().forEach(handleEvent);

      // Akis `done` olmadan kapandi.
      if (!turn.finished && isCurrent()) {
        if (accumulatedText) {
          updateAssistant({ text: accumulatedText, isThinking: false });
        } else {
          throw new Error("Bağlantı yanıt tamamlanmadan kapandı.");
        }
      }
    } catch (err: any) {
      const wasFinished = turn.finished;
      turn.finished = true;
      if (!isCurrent() && err?.name === "AbortError") return;
      if (err?.name === "AbortError") {
        if (!wasFinished) {
          updateAssistant({
            text: accumulatedText
              ? accumulatedText + "\n\n*(Yanıt Barış tarafından durduruldu)*"
              : "*Yanıt durduruldu.*",
            isThinking: false
          });
        }
      } else if (!wasFinished) {
        const msg = err?.message || "İletişim sırasında bir hata oluştu.";
        if (isCurrent()) {
          setState("Error");
          setErrorMessage(msg);
        }
        updateAssistant({
          text: accumulatedText || "İletişim sırasında bir hata oluştu.",
          isThinking: false
        });
      }
    } finally {
      turn.finished = true;
      if (isCurrent()) {
        activeTurnRef.current = null;
        setState((s) => (s === "Error" ? s : "Idle"));
      }
    }
  };

  const handleStopStreaming = () => {
    const turn = activeTurnRef.current;
    if (turn && !turn.finished) {
      turn.controller.abort();
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      setIsRecording(false);
      setState("Idle");
      return;
    }

    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      alert("Tarayıcınız Web Speech API mikrofon girişini desteklemiyor.");
      return;
    }

    const rec = new SpeechRec();
    recognitionRef.current = rec;
    rec.lang = sttLang;
    rec.interimResults = false;

    rec.onstart = () => {
      setIsRecording(true);
      setState("Listening");
    };

    rec.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputText((prev) => (prev ? prev + " " + transcript : transcript));
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.style.height = "auto";
          ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
          ta.focus();
        }
      });
    };

    rec.onerror = (event: any) => {
      console.warn("Speech error:", event?.error);
      setIsRecording(false);
      setState("Idle");
    };

    rec.onend = () => {
      recognitionRef.current = null;
      setIsRecording(false);
      setState((s) => (s === "Listening" ? "Idle" : s));
    };

    rec.start();
  };

  const toggleSpeak = (msg: Message) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    if (speakingId === msg.id) {
      setSpeakingId(null);
      setState((s) => (s === "Speaking" ? "Idle" : s));
      return;
    }
    const text = toSpeakableText(msg.text);
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const isTurkish = /[çğıöşüÇĞİÖŞÜ]/i.test(text);
    utterance.lang = isTurkish ? "tr-TR" : "en-GB";
    utterance.rate = 1.0;
    const reset = () => {
      setSpeakingId((curr) => (curr === msg.id ? null : curr));
      setState((s) => (s === "Speaking" ? "Idle" : s));
    };
    utterance.onend = reset;
    utterance.onerror = reset;
    setSpeakingId(msg.id);
    setState((s) => (s === "Idle" || s === "Error" ? "Speaking" : s));
    window.speechSynthesis.speak(utterance);
  };

  const handleSignOut = async () => {
    setShowAccountModal(false);
    cancelActiveTurn();
    await logout();
  };

  const isBusy = state === "Thinking" || state === "Streaming";
  const displayName = user?.displayName || user?.email?.split("@")[0] || "Yönetici";
  const engineText =
    health?.activeProvider === "ollama"
      ? { name: "Ollama", detail: modelLabel, active: true }
      : health?.activeProvider === "offline"
        ? { name: "Çevrimdışı", detail: "Groq anahtarı yok, Ollama erişilemiyor", active: false }
        : { name: "Groq Cloud", detail: modelLabel, active: true };

  return (
    <div style={{
      display: "flex",
      height: "100vh",
      width: "100vw",
      backgroundColor: "#212121",
      color: "#ececec",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      overflow: "hidden"
    }}>
      <style>{`
        .code-container {
          margin: 14px 0;
          border-radius: 8px;
          overflow: hidden;
          background: #141414;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .code-header {
          background: #1e1e1e;
          padding: 6px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 11px;
          color: #8e8e8e;
          font-family: monospace;
          text-transform: uppercase;
        }
        .copy-code-btn {
          background: transparent;
          border: none;
          color: #b4b4b4;
          font-size: 11px;
          cursor: pointer;
        }
        .copy-code-btn:hover { color: #fff; }
        .code-content {
          padding: 14px;
          overflow-x: auto;
          font-family: monospace;
          font-size: 13px;
          line-height: 1.5;
          color: #e6edf3;
        }
        .inline-code {
          background: rgba(255, 255, 255, 0.1);
          padding: 2px 6px;
          border-radius: 4px;
          font-family: monospace;
          font-size: 13px;
          color: #f6d899;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.1); }
        }
        @keyframes dotBounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.35; }
          40% { transform: scale(1.1); opacity: 1; }
        }
        .dot-bounce { animation: dotBounce 1.4s infinite ease-in-out both; }
        .conv-item-wrap:hover .conv-item-del-btn { opacity: 0.7; }
        .conv-item-del-btn:hover { opacity: 1 !important; background-color: rgba(239, 68, 68, 0.15) !important; color: #ef4444 !important; }
        @keyframes skeletonShimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .skeleton-shimmer {
          background: linear-gradient(
            90deg,
            rgba(255, 255, 255, 0.04) 25%,
            rgba(255, 255, 255, 0.1) 50%,
            rgba(255, 255, 255, 0.04) 75%
          );
          background-size: 200% 100%;
          animation: skeletonShimmer 1.8s infinite ease-in-out;
          border-radius: 4px;
        }
        @keyframes copyPop {
          0% { transform: scale(0.85); opacity: 0; }
          50% { transform: scale(1.12); }
          100% { transform: scale(1); opacity: 1; }
        }
        .copied-anim {
          animation: copyPop 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }
      `}</style>

      {/* Sidebar */}
      <aside style={{
        width: sidebarOpen ? "260px" : "0px",
        minWidth: sidebarOpen ? "260px" : "0px",
        height: "100%",
        backgroundColor: "#171717",
        borderRight: sidebarOpen ? "1px solid rgba(255, 255, 255, 0.08)" : "none",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.35s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.35s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease",
        opacity: sidebarOpen ? 1 : 0,
        overflow: "hidden",
        whiteSpace: "nowrap",
        zIndex: 40,
        flexShrink: 0
      }}>
        {/* Sidebar Header */}
        <div style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
          {/* Top Horizon Bar (52px, matches main top-bar) */}
          <div style={{
            height: "52px",
            minHeight: "52px",
            padding: "0 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            backgroundColor: "#171717"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", flex: 1, userSelect: "none" }}>
              <div style={{
                width: "32px",
                height: "32px",
                borderRadius: "9px",
                background: "linear-gradient(135deg, rgba(197, 160, 89, 0.18) 0%, rgba(140, 109, 50, 0.08) 100%)",
                border: "1px solid rgba(197, 160, 89, 0.35)",
                color: "#c5a059",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
                flexShrink: 0
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 18h18" />
                  <path d="M6 18V8a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 8v10" />
                  <path d="M6 14.5h12" />
                </svg>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "1px", flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, letterSpacing: "0.06em", color: "#ececec" }}>B.U.T.L.E.R.</span>
                  <span style={{
                    fontSize: "9px",
                    padding: "1px 5px",
                    borderRadius: "9999px",
                    backgroundColor: "rgba(197, 160, 89, 0.15)",
                    color: "#c5a059",
                    border: "1px solid rgba(197, 160, 89, 0.35)",
                    fontWeight: 700,
                    letterSpacing: "0.04em"
                  }}>ALFRED</span>
                </div>
                <span style={{ fontSize: "10px", color: "#737373", fontWeight: 500, letterSpacing: "0.02em" }}>Executive Intelligence</span>
              </div>
            </div>
          </div>

          {/* Primary Action Button */}
          <div style={{ padding: "10px 12px 6px" }}>
            <button
              onClick={handleNewConversation}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                height: "38px",
                backgroundColor: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "10px",
                padding: "0 12px",
                color: "#ececec",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
                transition: "all 0.15s ease"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#ececec" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c5a059" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Yeni Sohbet</span>
              </div>
              <span style={{
                fontSize: "10px",
                color: "#737373",
                backgroundColor: "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "4px",
                padding: "2px 5px",
                fontWeight: 600
              }}>⌘K</span>
            </button>
          </div>
        </div>

        {/* Conversations List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#737373", padding: "10px 8px 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Geçmiş Sohbetler
          </div>

          {conversationsLoading ? (
            <>
              {[75, 60, 85, 70].map((w, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    height: "36px",
                    boxSizing: "border-box",
                    padding: "8px 10px",
                    borderRadius: "8px"
                  }}
                >
                  <div className="skeleton-shimmer" style={{ width: "14px", height: "14px", borderRadius: "3px", flexShrink: 0 }} />
                  <div className="skeleton-shimmer" style={{ height: "12px", width: `${w}%`, borderRadius: "4px" }} />
                </div>
              ))}
            </>
          ) : conversations.length === 0 ? (
            <div style={{ padding: "12px 8px", fontSize: "12px", color: "#737373" }}>
              Henüz kayıtlı sohbet bulunmuyor.
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className="conv-item-wrap"
                onClick={() => loadConversation(conv.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  height: "36px",
                  boxSizing: "border-box",
                  padding: "8px 10px",
                  borderRadius: "8px",
                  color: conv.id === conversationId ? "#ffffff" : "#b4b4b4",
                  backgroundColor: conv.id === conversationId ? "#2a2a2a" : "transparent",
                  fontSize: "13px",
                  cursor: "pointer",
                  userSelect: "none"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flex: 1 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: "#8e8e8e" }}>
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {conv.title || "Sohbet"}
                  </span>
                </div>
                <button
                  className="conv-item-del-btn"
                  onClick={(e) => handleDeleteConversation(e, conv.id)}
                  style={{
                    opacity: 0,
                    width: "24px",
                    height: "24px",
                    borderRadius: "6px",
                    border: "none",
                    background: "transparent",
                    color: "#8e8e8e",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.15s ease",
                    flexShrink: 0,
                    marginLeft: "6px"
                  }}
                  title="Sohbeti Sil"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                </button>
              </div>
            ))
          )}
        </div>

        {/* Sidebar Footer */}
        <div style={{
          padding: "12px 14px",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backgroundColor: "#171717"
        }}>
          <button
            onClick={() => setShowAccountModal(true)}
            title="Hesap Bilgileri"
            style={{ display: "flex", alignItems: "center", gap: "10px", background: "none", border: "none", color: "inherit", padding: 0, minWidth: 0, textAlign: "left" }}
          >
            <div style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #c5a059, #8c6d32)",
              color: "#121212",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: "12px",
              flexShrink: 0,
              overflow: "hidden"
            }}>
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={displayName}
                  referrerPolicy="no-referrer"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: "13px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</span>
              <span style={{ fontSize: "11px", color: "#737373" }}>Google ile Doğrulandı</span>
            </div>
          </button>
          <button
            onClick={() => setShowSettingsModal(true)}
            style={{ background: "none", border: "none", color: "#8e8e8e", cursor: "pointer", display: "flex", alignItems: "center", padding: "4px" }}
            title="Ayarlar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main style={{ flex: 1, height: "100%", display: "flex", flexDirection: "column", position: "relative", backgroundColor: "#212121" }}>
        {/* Top Bar */}
        <header style={{
          height: "52px",
          minHeight: "52px",
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              id="sidebarToggleBtn"
              onClick={() => setSidebarOpen((prev) => !prev)}
              style={{
                background: "transparent",
                border: "none",
                color: "#b4b4b4",
                cursor: "pointer",
                padding: "6px 8px",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background 0.15s, color 0.15s"
              }}
              title="Kenar Çubuğunu Aç/Kapat"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
            <div
              style={{ display: "flex", alignItems: "center", padding: "6px 10px", fontWeight: 600, fontSize: "14px", color: "#ececec", userSelect: "none" }}
            >
              <span>{modelLabel}</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <button
              onClick={handleSignOut}
              title="Güvenli Çıkış Yap"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: "transparent",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                color: "#b4b4b4",
                borderRadius: "6px",
                padding: "4px 10px",
                fontSize: "12px",
                cursor: "pointer"
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Çıkış</span>
            </button>

            <select
              value={sttLang}
              onChange={(e) => setSttLang(e.target.value)}
              style={{
                background: "#2f2f2f",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                color: "#b4b4b4",
                borderRadius: "6px",
                padding: "4px 8px",
                fontSize: "12px"
              }}
            >
              <option value="tr-TR">TR</option>
              <option value="en-GB">EN</option>
            </select>

            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "12px",
              color: "#b4b4b4",
              padding: "4px 10px",
              borderRadius: "9999px",
              backgroundColor: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.08)"
            }}>
              <span style={{
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                backgroundColor:
                  state === "Listening" ? "#ef4444" :
                  state === "Thinking" ? "#3b82f6" :
                  state === "Streaming" ? "#c5a059" :
                  state === "Speaking" ? "#10b981" :
                  state === "Error" ? "#ef4444" : "#10b981",
                animation: state !== "Idle" ? "pulse 1.2s infinite" : "none"
              }} />
              <span>{state === "Idle" ? "Ready" : state}</span>
            </div>
          </div>
        </header>

        {/* Scrollable Message List */}
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ maxWidth: "48rem", width: "100%", margin: "0 auto", padding: "24px 20px 140px", display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Message Skeleton Loading */}
            {messagesLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "24px", padding: "16px 0" }}>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div className="skeleton-shimmer" style={{ width: "180px", height: "42px", borderRadius: "20px 20px 4px 20px" }} />
                </div>
                <div style={{ display: "flex", gap: "14px", width: "100%" }}>
                  <div className="skeleton-shimmer" style={{ width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0 }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1, maxWidth: "550px" }}>
                    <div className="skeleton-shimmer" style={{ width: "85%", height: "14px", borderRadius: "4px" }} />
                    <div className="skeleton-shimmer" style={{ width: "70%", height: "14px", borderRadius: "4px" }} />
                    <div className="skeleton-shimmer" style={{ width: "45%", height: "14px", borderRadius: "4px" }} />
                  </div>
                </div>
              </div>
            ) : messages.length === 0 ? (
              /* Empty / Welcome State */
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", margin: "auto auto", padding: "40px 16px 20px" }}>
                <div style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "radial-gradient(circle at center, #d8b26e 0%, #a47e33 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "26px",
                  marginBottom: "20px",
                  boxShadow: "0 8px 24px rgba(197, 160, 89, 0.25)"
                }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#121212" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 18h18" />
                    <path d="M6 18V8a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 8v10" />
                    <path d="M6 14.5h12" />
                  </svg>
                </div>
                <h1 style={{ fontSize: "24px", fontWeight: 600, marginBottom: "8px" }}>İyi günler, efendim.</h1>
                <p style={{ fontSize: "14px", color: "#b4b4b4" }}>
                  B.U.T.L.E.R. Alfred hizmetinizde. Bugün ne üzerinde çalışıyoruz?
                </p>
              </div>
            ) : null}

            {/* Render Messages */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  display: "flex",
                  width: "100%",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  gap: "14px"
                }}
              >
                {msg.role === "assistant" && (
                  <div style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    background: "radial-gradient(circle at center, #c5a059 0%, #8c6d32 100%)",
                    color: "#121212",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "15px",
                    flexShrink: 0,
                    marginTop: "2px"
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#121212" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 18h18" />
                      <path d="M6 18V8a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 8v10" />
                      <path d="M6 14.5h12" />
                    </svg>
                  </div>
                )}

                <div style={{
                  maxWidth: msg.role === "user" ? "78%" : "100%",
                  flex: msg.role === "assistant" ? 1 : undefined
                }}>
                  {msg.role === "assistant" && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 600, color: "#c5a059", marginBottom: "4px" }}>
                      <span>ALFRED</span>
                      <span style={{ color: "#737373", fontWeight: "normal" }}>•</span>
                      <span style={{ color: "#737373", fontWeight: "normal" }}>{msg.timestamp}</span>
                    </div>
                  )}

                  <div
                    style={
                      msg.role === "user"
                        ? {
                            backgroundColor: "#2f2f2f",
                            color: "#ececec",
                            padding: "12px 18px",
                            borderRadius: "20px 20px 4px 20px",
                            fontSize: "15px",
                            lineHeight: "1.55",
                            wordBreak: "break-word"
                          }
                        : {
                            fontSize: "15px",
                            lineHeight: "1.68",
                            color: "#ececec",
                            wordBreak: "break-word"
                          }
                    }
                  >
                    {msg.isThinking || !renderMarkdown(msg.text) ? (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#8e8e8e", fontSize: "14px", padding: "4px 0" }}>
                        <span className="dot-bounce" style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#c5a059" }} />
                        <span className="dot-bounce" style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#c5a059", animationDelay: "-0.16s" }} />
                        <span className="dot-bounce" style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#c5a059", animationDelay: "-0.32s" }} />
                        <span>Düşünüyor...</span>
                      </div>
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                    )}
                  </div>

                  {msg.role === "assistant" && !msg.isThinking && renderMarkdown(msg.text) && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", opacity: 0.8 }}>
                      <button
                        onClick={() => {
                          const clean = msg.text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim() || msg.text;
                          const doCopy = () => {
                            setCopiedId(msg.id);
                            setTimeout(() => {
                              setCopiedId(curr => (curr === msg.id ? null : curr));
                            }, 2000);
                          };
                          if (navigator.clipboard && window.isSecureContext) {
                            navigator.clipboard.writeText(clean).then(doCopy).catch(() => {
                              fallbackCopy(clean);
                              doCopy();
                            });
                          } else {
                            fallbackCopy(clean);
                            doCopy();
                          }
                        }}
                        style={{ background: "none", border: "none", color: "#8e8e8e", cursor: "pointer", fontSize: "12px", padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                        title="Kopyala"
                      >
                        {copiedId === msg.id ? (
                          <span className="copied-anim" style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "#10b981" }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>Kopyalandı</span>
                          </span>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                            <span>Kopyala</span>
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => toggleSpeak(msg)}
                        style={{ background: "none", border: "none", color: speakingId === msg.id ? "#10b981" : "#8e8e8e", cursor: "pointer", fontSize: "12px", padding: "2px 6px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                        title={speakingId === msg.id ? "Seslendirmeyi Durdur" : "Seslendir"}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                        <span>{speakingId === msg.id ? "Durdur" : "Seslendir"}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {errorMessage && (
              <div style={{
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                border: "1px solid #ef4444",
                color: "#fca5a5",
                padding: "10px 16px",
                borderRadius: "8px",
                fontSize: "13px",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>{errorMessage}</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Floating Bottom Input Dock */}
        <div style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: "linear-gradient(180deg, rgba(33, 33, 33, 0) 0%, rgba(33, 33, 33, 0.95) 25%, #212121 100%)",
          padding: "16px 20px 20px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          pointerEvents: "none"
        }}>
          <div style={{
            maxWidth: "48rem",
            width: "100%",
            backgroundColor: "#2f2f2f",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: "26px",
            padding: "10px 14px 10px 16px",
            display: "flex",
            alignItems: "flex-end",
            gap: "10px",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
            pointerEvents: "auto"
          }}>
            <button
              ref={toolsBtnRef}
              onClick={(e) => {
                e.stopPropagation();
                setToolsMenuOpen((prev) => !prev);
              }}
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: "transparent",
                border: "none",
                color: toolsMenuOpen ? "#ececec" : "#b4b4b4",
                fontSize: "17px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                marginBottom: "2px",
                transition: "background 0.15s, color 0.15s"
              }}
              title="Araçlar"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: toolsMenuOpen ? "rotate(45deg)" : "rotate(0deg)",
                  transformOrigin: "center",
                  transition: "transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), color 0.2s ease"
                }}
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>

            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Alfred'e mesaj yazın..."
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "#ececec",
                fontSize: "15px",
                lineHeight: "1.5",
                fontFamily: "inherit",
                resize: "none",
                maxHeight: "160px",
                minHeight: "24px",
                padding: "6px 0"
              }}
            />

            <button
              onClick={toggleRecording}
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: isRecording ? "#ef4444" : "transparent",
                border: "none",
                color: isRecording ? "#fff" : "#b4b4b4",
                fontSize: "17px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                marginBottom: "2px",
                animation: isRecording ? "pulse 1s infinite" : "none",
                transition: "background 0.15s, color 0.15s"
              }}
              title="Sesli Konuşma"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>

            {isBusy ? (
              <button
                onClick={handleStopStreaming}
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  backgroundColor: "transparent",
                  border: "none",
                  color: "#ef4444",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  marginBottom: "2px",
                  transition: "background 0.15s, color 0.15s"
                }}
                title="Durdur"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
              </button>
            ) : (
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim()}
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  backgroundColor: "transparent",
                  border: "none",
                  color: inputText.trim() ? "#ececec" : "#737373",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: inputText.trim() ? "pointer" : "not-allowed",
                  transition: "all 0.15s ease",
                  marginBottom: "2px"
                }}
                title="Gönder"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}
          </div>

          <p style={{ fontSize: "11px", color: "#737373", marginTop: "8px", textAlign: "center", pointerEvents: "auto" }}>
            B.U.T.L.E.R. Alfred — Barış's Unified Task, Logic, Execution &amp; Reasoning
          </p>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div
          onClick={() => setShowSettingsModal(false)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "16px"
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "#262626",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "16px",
              width: "100%",
              maxWidth: "460px",
              padding: "24px",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: 600 }}>Sistem &amp; Model Yapılandırması</h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                style={{ background: "none", border: "none", color: "#8e8e8e", cursor: "pointer", display: "flex", alignItems: "center" }}
                title="Kapat"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <p style={{ fontSize: "13px", color: "#b4b4b4", lineHeight: "1.5", marginBottom: "16px" }}>
              Etkin motor sunucu tarafında (Cloud Functions, <code className="inline-code">ALFRED_LLM_PROVIDER</code>) seçilir; bu bilgi <code className="inline-code">/api/health</code> uç noktasından okunur.
            </p>

            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#b4b4b4", marginBottom: "6px" }}>
                Aktif Motor:
              </label>
              <div style={{
                padding: "10px 12px",
                background: "rgba(197, 160, 89, 0.1)",
                border: "1px solid #c5a059",
                borderRadius: "8px",
                fontSize: "13px",
                color: "#c5a059",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                    <rect x="9" y="9" width="6" height="6" />
                    <line x1="9" y1="1" x2="9" y2="4" />
                    <line x1="15" y1="1" x2="15" y2="4" />
                    <line x1="9" y1="20" x2="9" y2="23" />
                    <line x1="15" y1="20" x2="15" y2="23" />
                    <line x1="20" y1="9" x2="23" y2="9" />
                    <line x1="20" y1="14" x2="23" y2="14" />
                    <line x1="1" y1="9" x2="4" y2="9" />
                    <line x1="1" y1="14" x2="4" y2="14" />
                  </svg>
                  <span><strong>{engineText.name}</strong> — {engineText.detail}</span>
                </div>
                <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: engineText.active ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                  <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: engineText.active ? "#10b981" : "#ef4444" }} />
                  {health ? (engineText.active ? "Aktif" : "Kapalı") : "Bilinmiyor"}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#b4b4b4", marginBottom: "6px" }}>
                API Anahtarları:
              </label>
              <p style={{ margin: 0, fontSize: "12px", color: "#8e8e8e", lineHeight: 1.5 }}>
                Groq ve Gemini anahtarları sunucuda Google Secret Manager&apos;da tutulur; tarayıcıda saklanmaz.
              </p>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px" }}>
              <button
                onClick={() => setShowSettingsModal(false)}
                style={{
                  backgroundColor: "#c5a059",
                  border: "none",
                  color: "#000",
                  padding: "8px 18px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer"
                }}
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account Modal */}
      {showAccountModal && (
        <div
          onClick={() => setShowAccountModal(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "16px"
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: "#262626",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: "16px",
              width: "100%",
              maxWidth: "420px",
              padding: "24px",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.6)"
            }}
          >
            <h3 style={{ fontSize: "16px", fontWeight: 600, marginBottom: "14px" }}>Hesap Bilgileri</h3>
            <div style={{
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: "10px",
              padding: "14px",
              marginBottom: "18px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px"
            }}>
              <span style={{ fontSize: "13px", color: "#b4b4b4" }}>Aktif Kullanıcı:</span>
              <strong style={{ fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis" }}>{user?.email || "-"}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px" }}>
              <button
                onClick={handleSignOut}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#ef4444",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  cursor: "pointer"
                }}
              >
                Oturumu Kapat
              </button>
              <button
                onClick={() => setShowAccountModal(false)}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255, 255, 255, 0.12)",
                  color: "#ececec",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  cursor: "pointer"
                }}
              >
                Kapat
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
