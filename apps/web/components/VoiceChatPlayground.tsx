"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

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

  // Extract <think> blocks
  const isThinkClosed = /<\/think>/i.test(text);
  const isOpen = !isThinkClosed;

  const thoughts: string[] = [];
  const mainText = text.replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, (_, thoughtContent) => {
    if (thoughtContent.trim() || !isThinkClosed) {
      thoughts.push(thoughtContent.trim());
    }
    return "";
  }).trim();

  let thoughtHtml = "";
  if (thoughts.length > 0) {
    thoughtHtml = thoughts.map(t => `
      <details class="thought-container"${isOpen ? " open" : ""}>
        <summary class="thought-header">
          <svg class="thought-chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          <span>Düşünce Süreci</span>
        </summary>
        <div class="thought-body">${escapeHtml(t)}</div>
      </details>
    `).join("");
  }

  if (!mainText) {
    return thoughtHtml;
  }

  let html = escapeHtml(mainText);

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
  html = html.replace(/\*\*\*([^\*]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold: **text**
  html = html.replace(/\*\*([^\*]+?)\*\*/g, "<strong>$1</strong>");
  // Italic: *text*
  html = html.replace(/\*([^\*]+?)\*/g, "<em>$1</em>");
  // Strikethrough: ~~text~~
  html = html.replace(/~~([^~]+?)~~/g, "<del>$1</del>");

  // Paragraphs
  html = html.split("\n\n").map(para => {
    const trimmed = para.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("§§CODEBLOCK")) return trimmed;
    return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
  }).join("");

  // Restore protected code blocks & inline codes
  html = html.replace(/§§INLINECODE(\d+)§§/g, (_m, idx) => inlineCodes[Number(idx)]);
  html = html.replace(/§§CODEBLOCK(\d+)§§/g, (_m, idx) => codeBlocks[Number(idx)]);

  return thoughtHtml + html;
}

export default function VoiceChatPlayground() {
  const [state, setState] = useState<AssistantState>("Idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sttLang, setSttLang] = useState("tr-TR");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);

  const toolsBtnRef = useRef<HTMLButtonElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentAudioElementRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, state, scrollToBottom]);

  // Load conversations list and restore active conversation from Firestore
  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/chat?userId=guest_default");
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.conversations)) {
          setConversations(data.conversations);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch conversation list:", err);
    }
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    try {
      setConversationId(id);
      localStorage.setItem("alfred_conversation_id", id);

      const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.messages)) {
          const loaded: Message[] = data.messages.map((m: any) => ({
            id: m.id || "msg-" + m.sequence,
            role: m.role,
            text: m.content,
            timestamp: m.createdAt
              ? new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
          }));
          setMessages(loaded);
        }
      }
    } catch (err) {
      console.warn("Failed to load conversation:", err);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    const savedConvId = localStorage.getItem("alfred_conversation_id");
    if (savedConvId) {
      loadConversation(savedConvId);
    }
  }, [fetchConversations, loadConversation]);

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

  const handleNewConversation = () => {
    setConversationId(null);
    localStorage.removeItem("alfred_conversation_id");
    setMessages([]);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleDeleteConversation = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm("Bu sohbeti silmek istediğinizden emin misiniz?")) return;

    try {
      const res = await fetch(`/api/chat?conversationId=${encodeURIComponent(id)}`, {
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

    const userMsg: Message = {
      id: "user-" + Date.now(),
      role: "user",
      text,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };

    const asstId = "asst-" + Date.now();
    const placeholderAsst: Message = {
      id: asstId,
      role: "assistant",
      text: "",
      isThinking: true,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };

    setMessages((prev) => [...prev, userMsg, placeholderAsst]);
    setState("Thinking");

    let accumulatedText = "";
    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream"
        },
        body: JSON.stringify({
          message: text,
          conversationId: conversationId || undefined,
          stream: true
        }),
        signal: abortControllerRef.current.signal
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Server responded with status ${res.status}`);
      }

      if (!res.body) {
        throw new Error("No response stream received.");
      }

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
                setConversationId(event.conversationId);
                localStorage.setItem("alfred_conversation_id", event.conversationId);
                fetchConversations();
              }
            } else if (event.type === "thinking") {
              setState("Thinking");
              setMessages((prev) =>
                prev.map((m) => (m.id === asstId ? { ...m, isThinking: true } : m))
              );
            } else if (event.type === "chunk") {
              setState("Streaming");
              accumulatedText += (event.text || "");
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === asstId
                    ? { ...m, text: accumulatedText, isThinking: false }
                    : m
                )
              );
            } else if (event.type === "done") {
              setState("Idle");
            } else if (event.type === "error") {
              throw new Error(event.error || "Streaming error occurred.");
            }
          } catch (parseErr: any) {
            if (parseErr.message && parseErr.message !== "Unexpected end of JSON input") {
              console.warn("Parse error:", parseErr);
            }
          }
        }
      }

      setState("Idle");
    } catch (err: any) {
      if (err.name === "AbortError") {
        setState("Idle");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstId
              ? { ...m, text: accumulatedText + "\n\n*(Yanıt durduruldu)*", isThinking: false }
              : m
          )
        );
      } else {
        setState("Error");
        setErrorMessage(err?.message || "Communication failed.");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstId
              ? { ...m, text: "İletişim sırasında bir hata oluştu.", isThinking: false }
              : m
          )
        );
      }
    } finally {
      abortControllerRef.current = null;
    }
  };

  const handleStopStreaming = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
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
    rec.lang = sttLang;
    rec.interimResults = false;

    rec.onstart = () => {
      setIsRecording(true);
      setState("Listening");
    };

    rec.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputText((prev) => {
        const next = prev ? prev + " " + transcript : transcript;
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
          textareaRef.current.focus();
        }
        return next;
      });
    };

    rec.onerror = () => {
      setIsRecording(false);
      setState("Idle");
    };

    rec.onend = () => {
      setIsRecording(false);
      setState("Idle");
    };

    rec.start();
  };

  const playVoice = (text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const isTurkish = /[çğıöşüÇĞİÖŞÜ]/i.test(text);
    utterance.lang = isTurkish ? "tr-TR" : "en-GB";
    utterance.rate = 1.0;
    setState("Speaking");
    utterance.onend = () => setState("Idle");
    utterance.onerror = () => setState("Idle");
    window.speechSynthesis.speak(utterance);
  };

  const isBusy = state === "Thinking" || state === "Streaming";

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
        .thought-container {
          margin-bottom: 12px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          overflow: hidden;
        }
        .thought-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          cursor: pointer;
          user-select: none;
          font-size: 13px;
          font-weight: 500;
          color: #8e8e8e;
          transition: background 0.15s ease, color 0.15s ease;
          list-style: none;
        }
        .thought-header::-webkit-details-marker {
          display: none;
        }
        .thought-header:hover {
          background: rgba(255, 255, 255, 0.05);
          color: #ececec;
        }
        .thought-chevron-icon {
          transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          flex-shrink: 0;
          color: #8e8e8e;
        }
        .thought-container[open] .thought-chevron-icon,
        .thought-container.open .thought-chevron-icon {
          transform: rotate(90deg);
          color: #c5a059;
        }
        .thought-body {
          padding: 10px 14px 14px 14px;
          font-size: 13px;
          line-height: 1.6;
          color: #9ca3af;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          white-space: pre-wrap;
          word-break: break-word;
          background: rgba(0, 0, 0, 0.15);
        }
        .thought-container:not(details):not(.open) .thought-body {
          display: none;
        }
        .thought-container:not(details).open .thought-body {
          display: block;
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

          {conversations.length === 0 ? (
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
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
              fontSize: "12px"
            }}>
              B
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "13px", fontWeight: 600 }}>Barış</span>
              <span style={{ fontSize: "11px", color: "#737373" }}>Systems Architect</span>
            </div>
          </div>
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
              <span>gemma4:12b-mlx</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
            {/* Empty / Welcome State */}
            {messages.length === 0 && (
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
            )}

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
                            whiteSpace: "pre-wrap",
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
                    {msg.isThinking ? (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: "#8e8e8e", fontSize: "14px", padding: "4px 0" }}>
                        <span style={{ display: "inline-flex", alignItems: "center", color: "#c5a059", marginRight: "2px" }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </span>
                        <span className="dot-bounce" style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#c5a059" }} />
                        <span className="dot-bounce" style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#c5a059", animationDelay: "-0.16s" }} />
                        <span className="dot-bounce" style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#c5a059", animationDelay: "-0.32s" }} />
                        <span>Düşünüyor...</span>
                      </div>
                    ) : (
                      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                    )}
                  </div>

                  {msg.role === "assistant" && !msg.isThinking && msg.text && (
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
              Alfred varsayılan olarak Tailscale özel ağınızdaki yerel <strong>Ollama (gemma4:12b-mlx)</strong> motorunu kullanır.
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
                  <span><strong>Ollama</strong> — gemma4:12b-mlx</span>
                </div>
                <span style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#10b981", fontWeight: 600 }}>
                  <span style={{ display: "inline-block", width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#10b981" }} />
                  Aktif
                </span>
              </div>
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
    </div>
  );
}
