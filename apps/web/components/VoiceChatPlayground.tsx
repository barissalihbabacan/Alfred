"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../lib/AuthContext";
import { apiFetch, ensureOk, ChatStreamError } from "../lib/api";
import { createSseParser, stripThinking, ChatStreamEvent } from "../lib/sse";
import { errorMessage as messageOf, isAbortError } from "../lib/errors";
import { formatRateLimitStatus, normalizeRateLimitWaitMs } from "../lib/rate-limit";
import { formatProviderFallbackStatus, providerDisplayName } from "../lib/providers";
import { renderMarkdown } from "../lib/markdown";

export type AssistantState =
  | "Idle"
  | "Listening"
  | "Transcribing"
  | "Thinking"
  | "Streaming"
  | "Error";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioUrl?: string;
  timestamp: string;
  isThinking?: boolean;
  /** 429 beklemesi: sunucunun yeniden deneyecegi an (Date.now() cinsinden). */
  rateLimitUntil?: number;
  /** Beklemedeki saglayici (`rate_limited.provider`). */
  rateLimitProvider?: string;
  /** Saglayici degisimi durumu, or. "Groq sınıra ulaştı, Gemini'ye geçiliyor…". */
  providerNotice?: string;
}

interface ConversationSummary {
  id: string;
  title: string;
  lastMessageAt?: string;
}

/** A message as returned by `GET /chat?conversationId=...` (functions/index.js). */
interface StoredMessageDto {
  id?: string;
  sequence?: number;
  role: string;
  content: string;
  createdAt?: string | number | Date;
}

// Minimal Web Speech API typings: TypeScript's DOM lib does not ship
// SpeechRecognition (it is still prefixed as webkitSpeechRecognition in Chrome).
interface SpeechRecognitionResultEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
}

/** "Düşünüyor..." yerine gosterilen, saniyede bir guncellenen Groq bekleme durumu. */
function RateLimitNotice({ until, provider }: { until: number; provider?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [until]);
  return <span role="status">{formatRateLimitStatus(until - now, provider)}</span>;
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

const DEFAULT_MODEL_LABEL = "openai/gpt-oss-120b";
const CONVERSATION_KEY = "alfred_conversation_id";
// Must match the `mobile` custom variant in apps/web/app/globals.css.
const MOBILE_QUERY = "(max-width: 768px)";
// Eski surumlerin tarayiciya yazdigi anahtarlar. API anahtarlari artik yalnizca
// sunucuda (Secret Manager) tutuluyor; Ollama URL alani da artik yok.
const LEGACY_STORAGE_KEYS = ["alfred_groq_api_key", "alfred_gemini_api_key", "alfred_ollama_url"];

/** Joins class names, skipping falsy entries. Pass complete Tailwind classes only. */
function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** Loading placeholder: a light band sweeping across a dim bar. */
const SHIMMER =
  "animate-shimmer bg-size-[200%_100%] bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_25%,rgba(255,255,255,0.1)_50%,rgba(255,255,255,0.04)_75%)]";

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
  const [sttLang, setSttLang] = useState("tr-TR");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [modelLabel, setModelLabel] = useState(DEFAULT_MODEL_LABEL);
  // Son turu cevaplayan saglayici (`start` / `provider_fallback`); null: /health'e gore.
  const [chatProvider, setChatProvider] = useState<string | null>(null);

  const toolsBtnRef = useRef<HTMLButtonElement | null>(null);
  const turnSeqRef = useRef(0);
  const activeTurnRef = useRef<ActiveTurn | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
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

  // Phones: the sidebar is a drawer over the chat, so it starts closed and
  // closes again once a conversation is picked (the `mobile:` classes on the aside).
  useEffect(() => {
    if (window.matchMedia(MOBILE_QUERY).matches) setSidebarOpen(false);
  }, []);
  const closeSidebarOnMobile = useCallback(() => {
    if (window.matchMedia(MOBILE_QUERY).matches) setSidebarOpen(false);
  }, []);

  // Bumped on every conversation switch; a load whose number is no longer the
  // latest applies nothing (the user moved on while it was in flight).
  const loadSeqRef = useRef(0);

  const handleNewConversation = useCallback(() => {
    cancelActiveTurn();
    loadSeqRef.current++;
    setMessagesLoading(false);
    setConversationId(null);
    storageSet(CONVERSATION_KEY, null);
    setMessages([]);
    setErrorMessage(null);
    textareaRef.current?.focus();
  }, [cancelActiveTurn]);

  const loadConversation = useCallback(async (id: string) => {
    cancelActiveTurn();
    const seq = ++loadSeqRef.current;
    const isLatest = () => seq === loadSeqRef.current;
    setErrorMessage(null);
    setConversationId(id);
    storageSet(CONVERSATION_KEY, id);
    setMessagesLoading(true);
    try {
      const res = await apiFetch(`/chat?conversationId=${encodeURIComponent(id)}`);
      if (!isLatest()) return;
      if (res.status === 404) {
        // Silinmis (veya baska kullaniciya ait) sohbet: kayitli kimligi birak.
        setConversationId(null);
        storageSet(CONVERSATION_KEY, null);
        setMessages([]);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        if (!isLatest()) return;
        if (data.success && Array.isArray(data.messages)) {
          const loaded: Message[] = (data.messages as StoredMessageDto[])
            .filter(
              (m): m is StoredMessageDto & { role: Message["role"] } =>
                m.role === "user" || m.role === "assistant"
            )
            .map((m) => ({
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
      if (isLatest()) setMessagesLoading(false);
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
        if (typeof data.model === "string" && data.model) setModelLabel(data.model);
        else if (data.activeProvider === "groq") setModelLabel(DEFAULT_MODEL_LABEL);
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

  // Stop recognition when the component unmounts (e.g. sign-out).
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
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
    // While a conversation loads, its messages would replace this turn's.
    if (!text || messagesLoading || state === "Thinking" || state === "Streaming" || state === "Transcribing") {
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
            if (event.provider) setChatProvider(event.provider);
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
            updateAssistant({ rateLimitUntil: undefined });
            break;
          case "rate_limited":
            // Sunucu gercekten `waitMs` bekleyip yeniden deneyecek (sigmayan beklemede
            // bu olay gelmez, dogrudan `error` gelir); bekleme bitince "thinking" gelir.
            setState("Thinking");
            updateAssistant({
              rateLimitUntil: Date.now() + normalizeRateLimitWaitMs(event.waitMs),
              rateLimitProvider: event.provider,
              providerNotice: undefined
            });
            break;
          case "provider_fallback":
            // Sunucu turu bir sonraki saglayicida bastan calistiriyor.
            if (event.model) setModelLabel(event.model);
            if (event.to) setChatProvider(event.to);
            setState("Thinking");
            updateAssistant({
              rateLimitUntil: undefined,
              providerNotice: formatProviderFallbackStatus(event.from, event.to, event.reason)
            });
            break;
          case "chunk":
            accumulatedText += event.text || "";
            setState("Streaming");
            updateAssistant({
              text: accumulatedText,
              isThinking: !stripThinking(accumulatedText),
              rateLimitUntil: undefined,
              providerNotice: undefined
            });
            break;
          case "done":
            updateAssistant({ text: accumulatedText || "*(Yanıt boş)*", isThinking: false, rateLimitUntil: undefined, providerNotice: undefined });
            finishTurn();
            break;
          case "error":
            throw new ChatStreamError(
              event.error || "Akış sırasında bir hata oluştu.",
              event.code,
              event.retryAfterMs,
              event.limitType
            );
          default:
            // Bilinmeyen olaylar (sse.ts zaten eler) yok sayilir.
            break;
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
    } catch (err: unknown) {
      const wasFinished = turn.finished;
      turn.finished = true;
      if (!isCurrent() && isAbortError(err)) return;
      if (isAbortError(err)) {
        if (!wasFinished) {
          updateAssistant({
            text: accumulatedText
              ? accumulatedText + "\n\n*(Yanıt Barış tarafından durduruldu)*"
              : "*Yanıt durduruldu.*",
            isThinking: false,
            rateLimitUntil: undefined
          });
        }
      } else if (!wasFinished) {
        const msg = messageOf(err, "İletişim sırasında bir hata oluştu.");
        if (isCurrent()) {
          setState("Error");
          setErrorMessage(msg);
        }
        // Groq sinirinda sunucunun kisa mesaji balonda da gosterilir.
        const rateLimited = err instanceof ChatStreamError && err.code === "rate_limited";
        updateAssistant({
          text: accumulatedText || (rateLimited ? msg : "İletişim sırasında bir hata oluştu."),
          isThinking: false,
          rateLimitUntil: undefined,
          providerNotice: undefined
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

    const SpeechRec = getSpeechRecognitionCtor();
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

    rec.onresult = (event) => {
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

    rec.onerror = (event) => {
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

  const handleSignOut = async () => {
    setShowAccountModal(false);
    cancelActiveTurn();
    await logout();
  };

  const isBusy = state === "Thinking" || state === "Streaming";
  const displayName = user?.displayName || user?.email?.split("@")[0] || "Yönetici";
  // The provider of the last turn wins; before the first turn, the one /health
  // says the next turn starts on (a fallback provider when Groq has no key).
  const engineProvider = chatProvider ?? health?.activeProvider ?? null;
  const engineText =
    health?.activeProvider === "ollama"
      ? { name: "Ollama", detail: modelLabel, active: true }
      : health?.activeProvider === "offline" && !chatProvider
        ? { name: "Çevrimdışı", detail: "Kullanılabilir yapay zeka sağlayıcısı yok", active: false }
        : engineProvider && engineProvider !== "groq"
          ? { name: providerDisplayName(engineProvider), detail: modelLabel, active: true }
          : { name: "Groq Cloud", detail: modelLabel, active: true };

  return (
    <div className="flex h-screen-safe w-full overflow-hidden bg-chat-bg font-sans leading-[normal] text-chat-text">
      {/* Sidebar */}
      {sidebarOpen && (
        <div className="hidden mobile:fixed mobile:inset-0 mobile:z-55 mobile:block mobile:bg-black/55" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}
      <aside className={cx(
        "z-40 flex h-full shrink-0 flex-col overflow-hidden whitespace-nowrap bg-chat-sidebar",
        "[transition:width_0.35s_cubic-bezier(0.4,0,0.2,1),min-width_0.35s_cubic-bezier(0.4,0,0.2,1),opacity_0.3s_ease]",
        // Phones: a drawer over the chat instead of squeezing it.
        "mobile:fixed mobile:left-0 mobile:top-0 mobile:z-60 mobile:h-screen-safe mobile:w-[min(85vw,300px)] mobile:min-w-0 mobile:border-r mobile:border-white/8 mobile:pb-[env(safe-area-inset-bottom,0px)] mobile:pt-[env(safe-area-inset-top,0px)] mobile:opacity-100 mobile:[transition:transform_0.3s_cubic-bezier(0.4,0,0.2,1)]",
        sidebarOpen
          ? "w-[260px] min-w-[260px] border-r border-white/8 opacity-100 mobile:translate-x-0 mobile:shadow-[12px_0_32px_rgba(0,0,0,0.45)]"
          : "w-0 min-w-0 opacity-0 mobile:-translate-x-full"
      )}>
        {/* Sidebar Header */}
        <div className="flex shrink-0 flex-col">
          {/* Top Horizon Bar (52px, matches main top-bar) */}
          <div className="flex h-[52px] min-h-[52px] items-center justify-between border-b border-white/8 bg-chat-sidebar px-3.5">
            <div className="flex w-full flex-1 select-none items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-gold/35 bg-[linear-gradient(135deg,rgba(197,160,89,0.18)_0%,rgba(140,109,50,0.08)_100%)] text-gold shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 18h18" />
                  <path d="M6 18V8a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 8v10" />
                  <path d="M6 14.5h12" />
                </svg>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-px">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-bold tracking-[0.06em] text-chat-text">B.U.T.L.E.R.</span>
                  <span className="rounded-full border border-gold/35 bg-gold/15 px-[5px] py-px text-[9px] font-bold tracking-[0.04em] text-gold">ALFRED</span>
                </div>
                <span className="text-[10px] font-medium tracking-[0.02em] text-chat-faint">Executive Intelligence</span>
              </div>
            </div>
          </div>

          {/* Primary Action Button */}
          <div className="px-3 pb-1.5 pt-2.5">
            <button
              onClick={() => {
                handleNewConversation();
                closeSidebarOnMobile();
              }}
              className="flex h-[38px] w-full cursor-pointer items-center justify-between rounded-[10px] border border-white/10 bg-white/4 px-3 text-[13px] font-medium text-chat-text [transition:all_0.15s_ease]"
            >
              <div className="flex items-center gap-2 text-chat-text">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c5a059" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>Yeni Sohbet</span>
              </div>
              {/* No ⌘K hint on phones or touch screens. */}
              <span className="rounded-sm border border-white/10 bg-white/6 px-[5px] py-0.5 text-[10px] font-semibold text-chat-faint mobile:hidden touch:hidden">⌘K</span>
            </button>
          </div>
        </div>

        {/* Conversations List */}
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-2.5 py-2">
          <div className="px-2 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-chat-faint">
            Geçmiş Sohbetler
          </div>

          {conversationsLoading ? (
            <>
              {[75, 60, 85, 70].map((w, idx) => (
                <div
                  key={idx}
                  className="box-border flex h-9 items-center gap-2 rounded-lg px-2.5 py-2"
                >
                  <div className={cx(SHIMMER, "h-3.5 w-3.5 shrink-0 rounded-[3px]")} />
                  <div className={cx(SHIMMER, "h-3 rounded-sm")} style={{ width: `${w}%` }} />
                </div>
              ))}
            </>
          ) : conversations.length === 0 ? (
            <div className="px-2 py-3 text-[12px] text-chat-faint">
              Henüz kayıtlı sohbet bulunmuyor.
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => {
                  loadConversation(conv.id);
                  closeSidebarOnMobile();
                }}
                className={cx(
                  "group box-border flex h-9 cursor-pointer select-none items-center justify-between rounded-lg px-2.5 py-2 text-[13px]",
                  conv.id === conversationId ? "bg-chat-active text-white" : "bg-transparent text-chat-muted"
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-chat-subtle">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                  <span className="truncate">
                    {conv.title || "Sohbet"}
                  </span>
                </div>
                {/* Hidden until the row is hovered; touch screens have no hover, so it stays visible there. */}
                <button
                  onClick={(e) => handleDeleteConversation(e, conv.id)}
                  className="ml-1.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-chat-subtle opacity-0 [transition:all_0.15s_ease] hover:bg-danger/15! hover:text-danger! hover:opacity-100! group-hover:opacity-70 touch:opacity-70"
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
        <div className="flex items-center justify-between border-t border-white/8 bg-chat-sidebar px-3.5 py-3">
          <button
            onClick={() => setShowAccountModal(true)}
            title="Hesap Bilgileri"
            className="flex min-w-0 items-center gap-2.5 border-none bg-transparent p-0 text-left text-inherit"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(135deg,#c5a059,#8c6d32)] text-[12px] font-bold text-chat-ink">
              {user?.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={displayName}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              ) : (
                displayName.charAt(0).toUpperCase()
              )}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="overflow-hidden text-ellipsis text-[13px] font-semibold">{displayName}</span>
              <span className="text-[11px] text-chat-faint">Google ile Doğrulandı</span>
            </div>
          </button>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex cursor-pointer items-center border-none bg-transparent p-1 text-chat-subtle"
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
      <main className="relative flex h-full min-w-0 flex-1 flex-col bg-chat-bg">
        {/* Top Bar */}
        <header className="box-content flex h-[52px] min-h-[52px] items-center justify-between border-b border-white/8 px-4 mobile:pl-1 mobile:pr-2 mobile:pt-[env(safe-area-inset-top,0px)]">
          <div className="flex min-w-0 items-center gap-3 mobile:gap-1.5">
            <button
              id="sidebarToggleBtn"
              onClick={() => setSidebarOpen((prev) => !prev)}
              className="flex cursor-pointer items-center justify-center rounded-lg border-none bg-transparent px-2 py-1.5 text-chat-muted [transition:background_0.15s,color_0.15s]"
              title="Kenar Çubuğunu Aç/Kapat"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
            <div
              className="flex min-w-0 select-none items-center px-2.5 py-1.5 text-[14px] font-semibold text-chat-text"
            >
              <span className="min-w-0 truncate">{modelLabel}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2.5 mobile:gap-1.5">
            <button
              onClick={handleSignOut}
              title="Güvenli Çıkış Yap"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-white/10 bg-transparent px-2.5 py-1 text-[12px] text-chat-muted"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="mobile:hidden">Çıkış</span>
            </button>

            <select
              value={sttLang}
              onChange={(e) => setSttLang(e.target.value)}
              className="rounded-md border border-white/10 bg-chat-surface px-2 py-1 text-[12px] text-chat-muted"
            >
              <option value="tr-TR">TR</option>
              <option value="en-GB">EN</option>
            </select>

            <div className="flex items-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-2.5 py-1 text-[12px] text-chat-muted">
              <span className={cx(
                "h-[7px] w-[7px] rounded-full",
                state === "Listening" ? "bg-danger" :
                state === "Thinking" ? "bg-status-thinking" :
                state === "Streaming" ? "bg-gold" :
                state === "Error" ? "bg-danger" : "bg-success",
                state !== "Idle" && "animate-alfred-pulse"
              )} />
              <span className="mobile:hidden">{state === "Idle" ? "Ready" : state}</span>
            </div>
          </div>
        </header>

        {/* Scrollable Message List */}
        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="my-0 flex w-full flex-col gap-6 px-5 pb-[140px] pt-6 mobile:px-3.5 mobile:pb-[120px] mobile:pt-4">
            {/* Message Skeleton Loading */}
            {messagesLoading ? (
              <div className="flex flex-col gap-6 px-0 py-4">
                <div className="flex justify-end">
                  <div className={cx(SHIMMER, "h-[42px] w-[180px] rounded-[20px_20px_4px_20px]")} />
                </div>
                <div className="flex w-full gap-[14px]">
                  <div className={cx(SHIMMER, "h-8 w-8 shrink-0 rounded-full")} />
                  <div className="flex max-w-[550px] flex-1 flex-col gap-2.5">
                    <div className={cx(SHIMMER, "h-3.5 w-[85%] rounded-sm")} />
                    <div className={cx(SHIMMER, "h-3.5 w-[70%] rounded-sm")} />
                    <div className={cx(SHIMMER, "h-3.5 w-[45%] rounded-sm")} />
                  </div>
                </div>
              </div>
            ) : messages.length === 0 ? (
              /* Empty / Welcome State */
              <div className="m-auto flex flex-col items-center px-4 pb-5 pt-10 text-center">
                <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[radial-gradient(circle_at_center,#d8b26e_0%,#a47e33_100%)] text-[26px] shadow-[0_8px_24px_rgba(197,160,89,0.25)]">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#121212" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 18h18" />
                    <path d="M6 18V8a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 8v10" />
                    <path d="M6 14.5h12" />
                  </svg>
                </div>
                <h1 className="mb-2 text-[24px] font-semibold">İyi günler, efendim.</h1>
                <p className="text-[14px] text-chat-muted">
                  B.U.T.L.E.R. Alfred hizmetinizde. Bugün ne üzerinde çalışıyoruz?
                </p>
              </div>
            ) : null}

            {/* Render Messages */}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cx("flex w-full gap-[14px]", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                {msg.role === "assistant" && (
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_center,#c5a059_0%,#8c6d32_100%)] text-[15px] text-chat-ink">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#121212" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 18h18" />
                      <path d="M6 18V8a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 8v10" />
                      <path d="M6 14.5h12" />
                    </svg>
                  </div>
                )}

                <div className={msg.role === "user" ? "max-w-[78%]" : "max-w-full flex-1"}>
                  {msg.role === "assistant" && (
                    <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-gold">
                      <span>ALFRED</span>
                      <span className="font-normal text-chat-faint">•</span>
                      <span className="font-normal text-chat-faint">{msg.timestamp}</span>
                    </div>
                  )}

                  <div
                    className={
                      msg.role === "user"
                        ? "rounded-[20px_20px_4px_20px] bg-chat-surface px-[18px] py-3 text-[15px] leading-[1.55] text-chat-text [word-break:break-word]"
                        : "text-[15px] leading-[1.68] text-chat-text [word-break:break-word]"
                    }
                  >
                    {msg.isThinking || !renderMarkdown(msg.text) ? (
                      <div className="inline-flex items-center gap-1.5 px-0 py-1 text-[14px] text-chat-subtle">
                        <span className="h-1.5 w-1.5 animate-dot-bounce rounded-full bg-gold" />
                        <span className="h-1.5 w-1.5 animate-dot-bounce rounded-full bg-gold [animation-delay:-0.16s]" />
                        <span className="h-1.5 w-1.5 animate-dot-bounce rounded-full bg-gold [animation-delay:-0.32s]" />
                        {msg.rateLimitUntil ? (
                          <RateLimitNotice until={msg.rateLimitUntil} provider={msg.rateLimitProvider} />
                        ) : msg.providerNotice ? (
                          <span role="status">{msg.providerNotice}</span>
                        ) : (
                          <span>Düşünüyor...</span>
                        )}
                      </div>
                    ) : (
                      // Preflight strips list markers; the markdown lists had them.
                      <div className="[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                    )}
                  </div>

                  {msg.role === "assistant" && !msg.isThinking && renderMarkdown(msg.text) && (
                    <div className="mt-1.5 flex items-center gap-2 opacity-80">
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
                        className="inline-flex cursor-pointer items-center gap-1 border-none bg-transparent px-1.5 py-0.5 text-[12px] text-chat-subtle"
                        title="Kopyala"
                      >
                        {copiedId === msg.id ? (
                          <span className="inline-flex animate-copy-pop items-center gap-1 text-success">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>Kopyalandı</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1">
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
              <div className="flex items-center gap-2 rounded-lg border border-danger bg-danger/15 px-4 py-2.5 text-[13px] text-red-300">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
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
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex flex-col items-center bg-[linear-gradient(180deg,rgba(33,33,33,0)_0%,rgba(33,33,33,0.95)_25%,#212121_100%)] px-5 pb-[calc(20px+env(safe-area-inset-bottom,0px))] pt-4 mobile:px-2.5 mobile:pb-[calc(10px+env(safe-area-inset-bottom,0px))] mobile:pt-2.5">
          <div className="pointer-events-auto flex w-full items-end gap-2.5 rounded-[26px] border border-white/12 bg-chat-surface py-2.5 pl-4 pr-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
            <button
              ref={toolsBtnRef}
              onClick={(e) => {
                e.stopPropagation();
                setToolsMenuOpen((prev) => !prev);
              }}
              className={cx(
                "mb-0.5 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-[17px] [transition:background_0.15s,color_0.15s]",
                toolsMenuOpen ? "text-chat-text" : "text-chat-muted"
              )}
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
                className={cx(
                  "origin-center [transition:transform_0.25s_cubic-bezier(0.4,0,0.2,1),color_0.2s_ease]",
                  toolsMenuOpen ? "rotate-45" : "rotate-0"
                )}
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>

            {/* 16px on phones stops iOS Safari from zooming in when the composer is focused. */}
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Alfred'e mesaj yazın..."
              className="max-h-[160px] min-h-[24px] min-w-0 flex-1 resize-none border-none bg-transparent px-0 py-1.5 text-[15px] leading-normal text-chat-text outline-hidden placeholder:text-[#757575] mobile:text-[16px]"
            />

            <button
              onClick={toggleRecording}
              className={cx(
                "mb-0.5 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-none text-[17px] [transition:background_0.15s,color_0.15s]",
                isRecording ? "animate-alfred-pulse-fast bg-danger text-white" : "bg-transparent text-chat-muted"
              )}
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
                className="mb-0.5 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-danger [transition:background_0.15s,color_0.15s]"
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
                className={cx(
                  "mb-0.5 flex h-9 w-9 items-center justify-center rounded-full border-none bg-transparent [transition:all_0.15s_ease]",
                  inputText.trim() ? "cursor-pointer text-chat-text" : "cursor-not-allowed text-chat-faint"
                )}
                title="Gönder"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}
          </div>

          <p className="pointer-events-auto mt-2 text-center text-[11px] text-chat-faint mobile:hidden">
            B.U.T.L.E.R. Alfred — Barış's Unified Task, Logic, Execution &amp; Reasoning
          </p>
        </div>
      </main>

      {/* Settings Modal */}
      {showSettingsModal && (
        <div
          onClick={() => setShowSettingsModal(false)}
          className="fixed inset-0 z-1000 flex items-center justify-center bg-black/75 p-4 backdrop-blur-[6px]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[460px] rounded-2xl border border-white/10 bg-chat-modal p-6 shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
          >
            <div className="mb-3.5 flex items-center justify-between">
              <h3 className="text-[16px] font-semibold">Sistem &amp; Model Yapılandırması</h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="flex cursor-pointer items-center border-none bg-transparent text-chat-subtle"
                title="Kapat"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <p className="mb-4 text-[13px] leading-normal text-chat-muted">
              Etkin motor sunucu tarafında (Cloud Functions, <code className="inline-code">ALFRED_LLM_PROVIDER</code>) seçilir; bu bilgi <code className="inline-code">/api/health</code> uç noktasından okunur.
            </p>

            <div className="mb-3.5">
              <label className="mb-1.5 block text-[12px] font-semibold text-chat-muted">
                Aktif Motor:
              </label>
              <div className="flex items-center justify-between rounded-lg border border-gold bg-gold/10 px-3 py-2.5 text-[13px] text-gold">
                <div className="flex items-center gap-2">
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
                <span className={cx("flex items-center gap-[5px] text-[11px] font-semibold", engineText.active ? "text-success" : "text-danger")}>
                  <span className={cx("inline-block h-1.5 w-1.5 rounded-full", engineText.active ? "bg-success" : "bg-danger")} />
                  {health ? (engineText.active ? "Aktif" : "Kapalı") : "Bilinmiyor"}
                </span>
              </div>
            </div>

            <div className="mb-3.5">
              <label className="mb-1.5 block text-[12px] font-semibold text-chat-muted">
                API Anahtarları:
              </label>
              <p className="m-0 text-[12px] leading-normal text-chat-subtle">
                Groq ve Gemini anahtarları sunucuda Google Secret Manager&apos;da tutulur; tarayıcıda saklanmaz.
              </p>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setShowSettingsModal(false)}
                className="cursor-pointer rounded-lg border-none bg-gold px-[18px] py-2 text-[13px] font-semibold text-black"
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
          className="fixed inset-0 z-1000 flex items-center justify-center bg-black/75 p-4 backdrop-blur-[6px]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-chat-modal p-6 shadow-[0_20px_50px_rgba(0,0,0,0.6)]"
          >
            <h3 className="mb-3.5 text-[16px] font-semibold">Hesap Bilgileri</h3>
            <div className="mb-[18px] flex items-center justify-between gap-3 rounded-[10px] border border-white/8 bg-white/3 p-3.5">
              <span className="text-[13px] text-chat-muted">Aktif Kullanıcı:</span>
              <strong className="overflow-hidden text-ellipsis text-[13px]">{user?.email || "-"}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <button
                onClick={handleSignOut}
                className="cursor-pointer rounded-lg border border-danger/30 bg-transparent px-3.5 py-2 text-[13px] text-danger"
              >
                Oturumu Kapat
              </button>
              <button
                onClick={() => setShowAccountModal(false)}
                className="cursor-pointer rounded-lg border border-white/12 bg-transparent px-3.5 py-2 text-[13px] text-chat-text"
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
