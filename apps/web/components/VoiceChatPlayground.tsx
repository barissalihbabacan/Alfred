"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../lib/AuthContext";
import { apiFetch, ensureOk, ChatStreamError } from "../lib/api";
import { createSseParser, stripThinking, ChatStreamEvent } from "../lib/sse";
import { errorMessage as messageOf, isAbortError } from "../lib/errors";
import { formatRateLimitStatus, normalizeRateLimitWaitMs } from "../lib/rate-limit";
import {
  CHAT_MODEL_OPTIONS,
  formatProviderFallbackStatus,
  providerDisplayName,
  type ModelOption
} from "../lib/providers";
import { linkCitationsInText, renderMarkdown, type WebSearchCitationSource } from "../lib/markdown";
import { extractToolNames, toolBadgeLabel, toolStatusText } from "../lib/tools";
import {
  getNotificationPermissionState,
  requestPushPermissionAndToken,
  saveFcmTokenToBackend,
  removeFcmTokenFromBackend,
  sendTestPushNotification,
  subscribeForegroundMessages
} from "../lib/notifications";

export type AssistantState =
  | "Idle"
  | "Listening"
  | "Transcribing"
  | "Thinking"
  | "Streaming"
  | "Error";

/** Üst çubuktaki durum rozetinde gösterilen Türkçe etiketler. */
const STATE_LABELS: Record<AssistantState, string> = {
  Idle: "Hazır",
  Listening: "Dinliyor",
  Transcribing: "Çözümleniyor",
  Thinking: "Düşünüyor",
  Streaming: "Yanıtlıyor",
  Error: "Hata"
};

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  audioUrl?: string;
  timestamp: string;
  sequence?: number;
  isThinking?: boolean;
  /** 429 beklemesi: sunucunun yeniden deneyecegi an (Date.now() cinsinden). */
  rateLimitUntil?: number;
  /** Beklemedeki saglayici (`rate_limited.provider`). */
  rateLimitProvider?: string;
  /** Saglayici degisimi durumu, or. "Groq sınıra ulaştı, Gemini'ye geçiliyor…". */
  providerNotice?: string;
  /** Bu turda calistirilan araclar (`web_search`, `get_current_time`). */
  usedTools?: string[];
  /** Araclarin anlik durumu: calisiyor, basarili veya hata. */
  toolStatuses?: Record<string, "running" | "success" | "error">;
  /** Web aramasindan donen kaynaklar (baslik + URL). */
  sources?: WebSearchCitationSource[];
}

interface ConversationSummary {
  id: string;
  title: string;
  projectId?: string | null;
  lastMessageAt?: string;
}

interface ProjectItem {
  id: string;
  name: string;
  description: string;
  githubRepo?: string;
  color: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** A message as returned by `GET /chat?conversationId=...` (functions/index.js). */
interface StoredMessageDto {
  id?: string;
  sequence?: number;
  role: string;
  content: string;
  createdAt?: string | number | Date;
  usedTools?: string[];
  sources?: WebSearchCitationSource[];
}

interface MemoryItem {
  id: string;
  docId: string;
  content: string;
  memoryType: string;
  projectId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

const MEMORY_TYPE_LABELS: Record<string, string> = {
  user_preference: "Tercih",
  technical_preference: "Teknik Tercih",
  project_fact: "Proje",
  architectural_decision: "Mimari Karar",
  user_fact: "Kişisel",
  personal_fact: "Kişisel",
  decision: "Karar",
  workflow: "İş Akışı",
  workflow_rule: "İş Akışı",
  constraint: "Kısıt",
  relationship: "İlişki",
  general: "Genel"
};

function memoryTypeLabel(type: string): string {
  return MEMORY_TYPE_LABELS[type] || type;
}

/** Sunucunun varsayılan İngilizce başlığını ("New Conversation") Türkçe gösterir. */
function displayConversationTitle(title?: string | null): string {
  if (!title || title === "New Conversation") return "Yeni Sohbet";
  return title;
}

function sourceDomain(url?: string): string {
  if (!url) return "Kaynak";
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "Kaynak";
  }
}

function formatDateShort(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
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

const DEFAULT_MODEL_LABEL = "qwen3.8-flash-next";
const CONVERSATION_KEY = "alfred_conversation_id";
const MODEL_SELECTION_KEY = "alfred_model_selection";
const ACTIVE_PROJECT_KEY = "alfred_active_project_id";
const PROJECT_COLORS = ["#c5a059", "#3b82f6", "#10b981", "#a855f7", "#f97316", "#ec4899"];
// Must match the `mobile` custom variant in apps/web/app/globals.css.
const MOBILE_QUERY = "(max-width: 768px)";
// Voice input (SpeechRecognition) listens for Turkish; there is no language picker.
const STT_LANG = "tr-TR";
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
  const [conversationSearch, setConversationSearch] = useState("");
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [memoryItems, setMemoryItems] = useState<MemoryItem[]>([]);
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memorySearch, setMemorySearch] = useState("");
  const [memoryTypeFilter, setMemoryTypeFilter] = useState<string>("all");
  const [memoryProjectFilter, setMemoryProjectFilter] = useState<string>("all");
  const [deletingMemoryId, setDeletingMemoryId] = useState<string | null>(null);
  const [newMemoryOpen, setNewMemoryOpen] = useState(false);
  const [newMemoryContent, setNewMemoryContent] = useState("");
  const [newMemoryType, setNewMemoryType] = useState("user_preference");
  const [newMemoryProjectId, setNewMemoryProjectId] = useState("");
  const [newMemorySupersede, setNewMemorySupersede] = useState(false);
  const [creatingMemory, setCreatingMemory] = useState(false);
  const [memoryFeedback, setMemoryFeedback] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [showProjectModal, setShowProjectModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectFormName, setProjectFormName] = useState("");
  const [projectFormDesc, setProjectFormDesc] = useState("");
  const [projectFormRepo, setProjectFormRepo] = useState("");
  const [projectFormColor, setProjectFormColor] = useState(PROJECT_COLORS[0]);
  const [savingProject, setSavingProject] = useState(false);
  const [projectFormError, setProjectFormError] = useState<string | null>(null);
  const [renamingConvId, setRenamingConvId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [modelLabel, setModelLabel] = useState(DEFAULT_MODEL_LABEL);
  // Son turu cevaplayan saglayici (`start` / `provider_fallback`); null: /health'e gore.
  const [chatProvider, setChatProvider] = useState<string | null>(null);

  const [googleConnected, setGoogleConnected] = useState<boolean>(false);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [googleConnecting, setGoogleConnecting] = useState<boolean>(false);

  const [notificationState, setNotificationState] = useState<NotificationPermission | "unsupported">("default");
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [fcmToken, setFcmToken] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<any>(null);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const handleViewportResize = () => {
      // Visual viewport height shrinks substantially when mobile virtual keyboard opens
      const keyboardActive = window.innerHeight - vv.height > 100;
      setIsKeyboardOpen(keyboardActive);
    };
    vv.addEventListener("resize", handleViewportResize);
    return () => vv.removeEventListener("resize", handleViewportResize);
  }, []);

  const modelMenuRef = useRef<HTMLDivElement | null>(null);
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
  const fetchConversations = useCallback(async (showSkeleton = false): Promise<ConversationSummary[] | null> => {
    if (!currentUserId) return null;
    if (showSkeleton) setConversationsLoading(true);
    try {
      const res = await apiFetch(`/chat?userId=${encodeURIComponent(currentUserId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.conversations)) {
          setConversations(data.conversations);
          return data.conversations as ConversationSummary[];
        }
      } else {
        console.warn("Failed to fetch conversation list:", res.status);
      }
    } catch (err) {
      console.warn("Failed to fetch conversation list:", err);
    } finally {
      setConversationsLoading(false);
    }
    return null;
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
              timestamp: formatTime(m.createdAt),
              sequence: typeof m.sequence === "number" ? m.sequence : undefined,
              ...(Array.isArray(m.usedTools) && m.usedTools.length > 0 ? { usedTools: m.usedTools } : {}),
              ...(Array.isArray(m.sources) && m.sources.length > 0 ? { sources: m.sources } : {})
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

    const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    const queryConvId = urlParams ? urlParams.get("conversation") : null;
    const savedConvId = queryConvId || storageGet(CONVERSATION_KEY);
    const savedProjId = storageGet(ACTIVE_PROJECT_KEY);
    void apiFetch("/projects")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success && Array.isArray(data.projects)) {
          const loadedProjects = data.projects as ProjectItem[];
          setProjects(loadedProjects);
          if (savedProjId && loadedProjects.some((p) => p.id === savedProjId)) {
            setActiveProjectId(savedProjId);
          } else if (savedProjId) {
            storageSet(ACTIVE_PROJECT_KEY, null);
          }
        }
      })
      .catch(() => {});

    void fetchConversations(true).then((list) => {
      if (!savedConvId) return;
      if (list && !list.some((c) => c.id === savedConvId)) {
        storageSet(CONVERSATION_KEY, null);
        return;
      }
      void loadConversation(savedConvId);
    });

    // Check Google Integration Status
    void apiFetch("/auth/google/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.connected === "boolean") {
          setGoogleConnected(data.connected);
          setGoogleEmail(data.email || null);
        }
      })
      .catch(() => {});

    // Fallback: If URL has Google OAuth code (e.g. redirected or rewrite), exchange it directly
    const authCode = urlParams?.get("code");
    if (authCode) {
      const redirectUri = window.location.origin + "/auth/google/callback";
      void apiFetch("/auth/google/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: authCode, redirectUri })
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.connected) {
            setGoogleConnected(true);
            if (data.email) setGoogleEmail(data.email);
            if (typeof window !== "undefined") {
              window.history.replaceState({}, document.title, window.location.pathname);
            }
          }
        })
        .catch(() => {});
    }
  }, [currentUserId, fetchConversations, loadConversation]);

  // Re-fetch Google Integration Status when account modal is opened
  useEffect(() => {
    if (!showAccountModal || !currentUserId) return;
    void apiFetch("/auth/google/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.connected === "boolean") {
          setGoogleConnected(data.connected);
          setGoogleEmail(data.email || null);
        }
      })
      .catch(() => {});
  }, [showAccountModal, currentUserId]);

  // Active provider (public /health endpoint, no token needed) + saved model preference.
  useEffect(() => {
    const savedId = storageGet(MODEL_SELECTION_KEY);
    const savedOption = savedId ? CHAT_MODEL_OPTIONS.find((o) => o.id === savedId) : undefined;
    if (savedOption) {
      setSelectedModelId(savedOption.id);
      setChatProvider(savedOption.provider);
      setModelLabel(savedOption.model);
    }

    let cancelled = false;
    apiFetch("/health", { anonymous: true })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.activeProvider) return;
        setHealth({ activeProvider: data.activeProvider });
        if (savedOption) return;
        if (typeof data.model === "string" && data.model) setModelLabel(data.model);
        else if (data.activeProvider === "groq") setModelLabel("openai/gpt-oss-120b");
        else if (data.activeProvider === "ollama") setModelLabel("gemma4:12b-mlx");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // PWA and FCM Push Notifications registration & foreground listener
  useEffect(() => {
    if (typeof window !== "undefined") {
      setNotificationState(getNotificationPermissionState());
      const savedToken = localStorage.getItem("alfred_fcm_token");
      if (savedToken) setFcmToken(savedToken);

      const handleBeforeInstall = (e: Event) => {
        e.preventDefault();
        setDeferredInstallPrompt(e);
      };
      window.addEventListener("beforeinstallprompt", handleBeforeInstall);

      let unsub: (() => void) | null = null;
      void subscribeForegroundMessages((payload) => {
        console.log("[Alfred Push] Foreground payload:", payload);
      }).then((u) => {
        unsub = u;
      });

      return () => {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
        if (unsub) unsub();
      };
    }
  }, []);

  const handleInstallApp = async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredInstallPrompt(null);
    }
  };

  const handleToggleNotifications = async () => {
    if (notificationLoading) return;
    setNotificationLoading(true);

    try {
      if (notificationState === "granted" && fcmToken) {
        const sendTest = confirm("Bildirimler bu cihazda aktif!\n\nGalaxy cihazınıza anında bir test bildirimi göndermek istiyor musunuz?\n\n(İptal'e basarak bildirimleri bu cihazda kapatma seçeneğini görebilirsiniz)");
        if (sendTest) {
          const res = await sendTestPushNotification();
          alert(res.message);
        } else {
          const disable = confirm("Bildirimler bu cihaz için devre dışı bırakılsın mı?");
          if (disable) {
            await removeFcmTokenFromBackend(fcmToken);
            localStorage.removeItem("alfred_fcm_token");
            setFcmToken(null);
            setNotificationState(getNotificationPermissionState());
            alert("Bildirim kaydı başarıyla kaldırıldı.");
          }
        }
      } else {
        const { token, error } = await requestPushPermissionAndToken();
        if (error || !token) {
          alert("Bildirim izni alınamadı: " + (error || "Bilinmeyen hata"));
          setNotificationState(getNotificationPermissionState());
          return;
        }

        await saveFcmTokenToBackend(token);
        localStorage.setItem("alfred_fcm_token", token);
        setFcmToken(token);
        setNotificationState("granted");

        try {
          await sendTestPushNotification();
        } catch (_testErr) {
          // İlk test hatası yutulabilir
        }

        alert("Bildirimler başarıyla açıldı! Galaxy cihazınıza ilk test bildirimi gönderildi.");
      }
    } catch (err: unknown) {
      alert("Hata: " + ((err as Error)?.message || String(err)));
    } finally {
      setNotificationLoading(false);
    }
  };

  const handleSelectModelOption = useCallback((option: ModelOption) => {
    setSelectedModelId(option.id);
    storageSet(MODEL_SELECTION_KEY, option.id);
    setChatProvider(option.provider);
    setModelLabel(option.model);
    setModelMenuOpen(false);
  }, []);

  const fetchMemories = useCallback(async () => {
    if (!currentUserId) return;
    setMemoriesLoading(true);
    try {
      const res = await apiFetch("/memories");
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.memories)) {
          setMemoryItems(data.memories as MemoryItem[]);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch memories:", err);
    } finally {
      setMemoriesLoading(false);
    }
  }, [currentUserId]);

  const fetchProjects = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const res = await apiFetch("/projects");
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.projects)) {
          setProjects(data.projects as ProjectItem[]);
        }
      }
    } catch (err) {
      console.warn("Failed to fetch projects:", err);
    }
  }, [currentUserId]);

  const handleSelectProject = useCallback((projId: string | null) => {
    setActiveProjectId(projId);
    storageSet(ACTIVE_PROJECT_KEY, projId);
    handleNewConversation();
  }, [handleNewConversation]);

  const handleOpenNewProjectModal = useCallback(() => {
    setEditingProjectId(null);
    setProjectFormName("");
    setProjectFormDesc("");
    setProjectFormRepo("");
    setProjectFormColor(PROJECT_COLORS[0]);
    setProjectFormError(null);
    setShowProjectModal(true);
  }, []);

  const handleOpenEditProjectModal = useCallback((e: React.MouseEvent, proj: ProjectItem) => {
    e.stopPropagation();
    setEditingProjectId(proj.id);
    setProjectFormName(proj.name);
    setProjectFormDesc(proj.description || "");
    setProjectFormRepo(proj.githubRepo || "");
    setProjectFormColor(proj.color || PROJECT_COLORS[0]);
    setProjectFormError(null);
    setShowProjectModal(true);
  }, []);

  const handleSaveProject = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = projectFormName.trim();
    if (trimmedName.length < 2 || savingProject) return;
    setSavingProject(true);
    setProjectFormError(null);
    try {
      const res = await apiFetch("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingProjectId ? { id: editingProjectId } : {}),
          name: trimmedName,
          description: projectFormDesc.trim(),
          githubRepo: projectFormRepo.trim(),
          color: projectFormColor
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProjectFormError(typeof data?.error === "string" ? data.error : "Proje kaydedilemedi.");
        return;
      }
      await fetchProjects();
      if (data?.project?.id && !editingProjectId) {
        setActiveProjectId(data.project.id);
        storageSet(ACTIVE_PROJECT_KEY, data.project.id);
        handleNewConversation();
      }
      setShowProjectModal(false);
    } catch {
      setProjectFormError("Sunucuya bağlanılamadı.");
    } finally {
      setSavingProject(false);
    }
  }, [projectFormName, projectFormDesc, projectFormRepo, projectFormColor, editingProjectId, savingProject, fetchProjects, handleNewConversation]);

  const handleDeleteProject = useCallback(async (e: React.MouseEvent, proj: ProjectItem) => {
    e.stopPropagation();
    if (!window.confirm(`"${proj.name}" projesini ve bu projeye özel anıları silmek istediğinizden emin misiniz?`)) return;
    try {
      const res = await apiFetch(`/projects?projectId=${encodeURIComponent(proj.id)}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setProjects((prev) => prev.filter((p) => p.id !== proj.id));
        if (activeProjectId === proj.id) {
          setActiveProjectId(null);
          storageSet(ACTIVE_PROJECT_KEY, null);
          handleNewConversation();
        }
      }
    } catch (err) {
      console.warn("Failed to delete project:", err);
    }
  }, [activeProjectId, handleNewConversation]);

  const handleOpenMemoryModal = useCallback(() => {
    setShowMemoryModal(true);
    setMemoryFeedback(null);
    setNewMemoryProjectId(activeProjectId || "");
    setMemoryProjectFilter(activeProjectId || "all");
    void fetchMemories();
  }, [fetchMemories, activeProjectId]);

  const handleCreateMemory = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newMemoryContent.trim();
    if (trimmed.length < 5 || creatingMemory) return;
    setCreatingMemory(true);
    setMemoryFeedback(null);
    try {
      const res = await apiFetch("/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: trimmed,
          memoryType: newMemoryType,
          projectId: newMemoryProjectId || null,
          action: newMemorySupersede ? "supersede" : "create"
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMemoryFeedback({
          kind: "err",
          text: typeof data?.error === "string" ? data.error : "Anı kaydedilirken hata oluştu."
        });
        return;
      }
      setNewMemoryContent("");
      setNewMemoryOpen(false);
      const outcomeText =
        data?.outcome === "superseded"
          ? "Benzer eski anı güncellenerek yeni anı kaydedildi."
          : data?.outcome === "duplicate"
            ? "Bu bilgi zaten uzun süreli bellekte mevcut."
            : "Yeni anı vektörleştirilip belleğe kaydedildi.";
      setMemoryFeedback({ kind: "ok", text: outcomeText });
      await fetchMemories();
    } catch {
      setMemoryFeedback({ kind: "err", text: "Sunucuya bağlanılamadı." });
    } finally {
      setCreatingMemory(false);
    }
  }, [newMemoryContent, newMemoryType, newMemoryProjectId, newMemorySupersede, creatingMemory, fetchMemories]);

  const handleDeleteMemory = useCallback(async (docId: string) => {
    setDeletingMemoryId(docId);
    try {
      const res = await apiFetch(`/memories?memoryId=${encodeURIComponent(docId)}`, {
        method: "DELETE"
      });
      if (res.ok) {
        setMemoryItems((prev) => prev.filter((m) => m.docId !== docId && m.id !== docId));
      }
    } catch (err) {
      console.warn("Failed to delete memory:", err);
    } finally {
      setDeletingMemoryId(null);
    }
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
      const target = e.target as Node;
      if (modelMenuRef.current && !modelMenuRef.current.contains(target)) {
        setModelMenuOpen(false);
      }
    };
    if (modelMenuOpen) {
      document.addEventListener("click", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("click", handleOutsideClick);
    };
  }, [modelMenuOpen]);

  const handleStartRenameConversation = (e: React.MouseEvent, conv: ConversationSummary) => {
    e.stopPropagation();
    setRenamingConvId(conv.id);
    setRenamingTitle(displayConversationTitle(conv.title));
  };

  const handleSaveRenameConversation = async (id: string) => {
    const trimmed = renamingTitle.trim();
    setRenamingConvId(null);
    if (!trimmed) return;
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)));
    try {
      const res = await apiFetch("/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id, title: trimmed })
      });
      if (!res.ok) {
        await fetchConversations();
      }
    } catch {
      await fetchConversations();
    }
  };

  const handleExportMarkdown = () => {
    if (messages.length === 0) return;
    const currentConv = conversations.find((c) => c.id === conversationId);
    const title = currentConv?.title && currentConv.title !== "New Conversation"
      ? currentConv.title
      : "Alfred Sohbeti";
    const activeProj = activeProjectId ? projects.find((p) => p.id === activeProjectId) : null;
    const dateStr = new Date().toLocaleString("tr-TR");
    const lines: string[] = [
      `# ${title}`,
      "",
      `- **Tarih:** ${dateStr}`,
      ...(activeProj ? [`- **Proje:** ${activeProj.name}`] : []),
      `- **Model:** ${providerDisplayName(engineProvider || "evren")} (${modelLabel})`,
      "",
      "---",
      ""
    ];

    for (const m of messages) {
      if (m.isThinking && !m.text) continue;
      const roleHeader = m.role === "user" ? `### 👤 Barış (${m.timestamp})` : `### 🤖 Alfred (${m.timestamp})`;
      const cleanBody = m.text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim() || m.text;
      lines.push(roleHeader, "", cleanBody, "");
      if (m.sources && m.sources.length > 0) {
        lines.push("**Kaynaklar:**");
        m.sources.forEach((src, i) => {
          lines.push(`${i + 1}. [${src.title || src.source || src.url}](${src.url})`);
        });
        lines.push("");
      }
      lines.push("---", "");
    }

    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeSlug = title
      .toLocaleLowerCase("tr-TR")
      .replace(/[^a-z0-9ğüşıöç\s-_]+/gi, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "alfred-sohbet";
    a.href = url;
    a.download = `${safeSlug}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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

  const adjustTextareaHeight = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "0px";
    const minHeight = 36;
    const maxHeight = typeof window !== "undefined" ? Math.max(window.innerHeight * 0.55, 360) : 360;
    const scrollH = el.scrollHeight;
    const targetHeight = Math.max(minHeight, Math.min(scrollH, maxHeight));
    el.style.height = `${targetHeight}px`;
    el.style.overflowY = scrollH > maxHeight ? "auto" : "hidden";
  };

  useEffect(() => {
    adjustTextareaHeight(textareaRef.current);
  }, [inputText]);

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    adjustTextareaHeight(e.target);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const executeChatTurn = async (
    textToSend: string,
    options?: {
      truncateFromSequence?: number;
      priorMessages?: Message[];
    }
  ) => {
    const text = textToSend.trim();
    // While a conversation loads, its messages would replace this turn's.
    if (!text || messagesLoading || state === "Thinking" || state === "Streaming" || state === "Transcribing") {
      return;
    }

    setErrorMessage(null);
    setInputText("");
    if (textareaRef.current) {
      adjustTextareaHeight(textareaRef.current);
    }

    const now = Date.now();
    const userMsg: Message = {
      id: "user-" + now,
      role: "user",
      text,
      timestamp: formatTime(now),
      sequence: options?.truncateFromSequence
    };
    const asstId = "asst-" + now;
    const placeholderAsst: Message = {
      id: asstId,
      role: "assistant",
      text: "",
      isThinking: true,
      timestamp: formatTime(now),
      sequence: options?.truncateFromSequence ? options.truncateFromSequence + 1 : undefined
    };

    if (options?.priorMessages) {
      setMessages([...options.priorMessages, userMsg, placeholderAsst]);
    } else {
      setMessages((prev) => [...prev, userMsg, placeholderAsst]);
    }
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
    const searchSources: WebSearchCitationSource[] = [];
    const usedTools: string[] = [];
    const toolStatuses: Record<string, "running" | "success" | "error"> = {};

    try {
      const selectedOption = selectedModelId
        ? CHAT_MODEL_OPTIONS.find((o) => o.id === selectedModelId)
        : undefined;
      // stream: SSE must bypass Hosting, which buffers the whole response.
      const res = await apiFetch("/chat", {
        stream: true,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream"
        },
        body: JSON.stringify({
          message: text,
          conversationId: conversationId || undefined,
          projectId: activeProjectId || undefined,
          userId: currentUserId || undefined,
          ...(selectedOption ? { provider: selectedOption.provider, model: selectedOption.model } : {}),
          stream: true,
          truncateFromSequence: options?.truncateFromSequence
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
            setState("Thinking");
            updateAssistant({ rateLimitUntil: undefined });
            break;
          case "tool_call": {
            // A slow tool (web_search) says what it is doing instead of "Düşünüyor...".
            // Any text emitted before a tool call in the same round is discarded, matching the server.
            accumulatedText = "";
            for (const tName of extractToolNames(event)) {
              if (!usedTools.includes(tName)) usedTools.push(tName);
              if (!toolStatuses[tName]) toolStatuses[tName] = "running";
            }
            const status = toolStatusText(event);
            setState("Thinking");
            updateAssistant({
              text: "",
              isThinking: true,
              rateLimitUntil: undefined,
              usedTools: [...usedTools],
              toolStatuses: { ...toolStatuses },
              ...(status ? { providerNotice: status } : {})
            });
            break;
          }
          case "tool_result": {
            accumulatedText = "";
            if (typeof event.tool === "string" && event.tool) {
              if (!usedTools.includes(event.tool)) usedTools.push(event.tool);
              const isErr = Boolean(
                event.result &&
                typeof event.result === "object" &&
                (event.result as { error?: unknown }).error
              );
              toolStatuses[event.tool] = isErr ? "error" : "success";
            }
            if (event.tool === "web_search" && event.result && typeof event.result === "object") {
              const items = (event.result as { results?: unknown }).results;
              if (Array.isArray(items)) {
                for (const item of items) {
                  if (item && typeof item === "object") {
                    const src = item as WebSearchCitationSource;
                    if (src.url && !searchSources.some((s) => s.url === src.url)) {
                      searchSources.push(src);
                    }
                  }
                }
              }
            }
            setState("Thinking");
            updateAssistant({
              text: "",
              isThinking: true,
              rateLimitUntil: undefined,
              providerNotice: undefined,
              usedTools: [...usedTools],
              toolStatuses: { ...toolStatuses },
              sources: searchSources.length > 0 ? [...searchSources] : undefined
            });
            break;
          }
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
            accumulatedText = "";
            if (event.model) setModelLabel(event.model);
            if (event.to) setChatProvider(event.to);
            setState("Thinking");
            updateAssistant({
              text: "",
              isThinking: true,
              rateLimitUntil: undefined,
              providerNotice: formatProviderFallbackStatus(event.from, event.to, event.reason)
            });
            break;
          case "chunk": {
            accumulatedText += event.text || "";
            const displayText = searchSources.length > 0
              ? linkCitationsInText(accumulatedText, searchSources)
              : accumulatedText;
            setState("Streaming");
            updateAssistant({
              text: displayText,
              isThinking: !stripThinking(displayText),
              rateLimitUntil: undefined,
              providerNotice: undefined
            });
            break;
          }
          case "done": {
            for (const tName of usedTools) {
              if (!toolStatuses[tName] || toolStatuses[tName] === "running") {
                toolStatuses[tName] = "success";
              }
            }
            const finalText = searchSources.length > 0
              ? linkCitationsInText(accumulatedText, searchSources)
              : accumulatedText;
            updateAssistant({
              text: finalText || "*(Yanıt boş)*",
              isThinking: false,
              rateLimitUntil: undefined,
              providerNotice: undefined,
              usedTools: [...usedTools],
              toolStatuses: { ...toolStatuses }
            });
            finishTurn();
            break;
          }
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
        for (const tName of usedTools) {
          if (!toolStatuses[tName] || toolStatuses[tName] === "running") {
            toolStatuses[tName] = "error";
          }
        }
        updateAssistant({
          text: accumulatedText || (rateLimited ? msg : "İletişim sırasında bir hata oluştu."),
          isThinking: false,
          rateLimitUntil: undefined,
          providerNotice: undefined,
          usedTools: [...usedTools],
          toolStatuses: { ...toolStatuses }
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

  const handleSendMessage = (textToSend?: string) => {
    void executeChatTurn(textToSend ?? inputText);
  };

  const handleEditAndResend = (messageId: string, newText: string) => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;
    const prior = messages.slice(0, msgIndex);
    const targetSeq = messages[msgIndex]?.sequence ?? (msgIndex + 1);
    setEditingMessageId(null);
    setEditingText("");
    void executeChatTurn(trimmed, {
      truncateFromSequence: targetSeq,
      priorMessages: prior
    });
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
    rec.lang = STT_LANG;
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
          adjustTextareaHeight(ta);
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
          : { name: "Groq Bulut", detail: modelLabel, active: true };

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
                  <span className="text-[14px] font-bold tracking-[0.04em] text-chat-text">Alfred</span>
                  <span className="rounded-full border border-gold/35 bg-gold/15 px-[5px] py-px text-[9px] font-bold tracking-[0.04em] text-gold">AI</span>
                </div>
                <span className="text-[10px] font-medium tracking-[0.02em] text-chat-faint">Yönetici Zekası</span>
              </div>
            </div>
          </div>

          {/* Primary Action Button & Search */}
          <div className="flex flex-col gap-2 px-3 pb-2 pt-2.5">
            <button
              onClick={() => {
                handleNewConversation();
                closeSidebarOnMobile();
              }}
              className="flex h-[38px] w-full cursor-pointer items-center justify-between rounded-[10px] border border-white/10 bg-white/4 px-3 text-[13px] font-medium text-chat-text [transition:all_0.15s_ease] hover:border-gold/30 hover:bg-white/6"
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

            {/* Conversation Search Bar - Always visible */}
            <div className="relative w-full">
              <input
                type="text"
                value={conversationSearch}
                onChange={(e) => setConversationSearch(e.target.value)}
                placeholder="Sohbetlerde ara..."
                className="w-full rounded-[9px] border border-white/10 bg-black/30 py-1.5 pl-8 pr-7 text-[12px] text-chat-text placeholder:text-chat-subtle outline-none transition focus:border-gold/50 focus:bg-black/50"
              />
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-chat-subtle"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {conversationSearch && (
                <button
                  type="button"
                  onClick={() => setConversationSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-chat-subtle hover:text-chat-text"
                  title="Aramayı temizle"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Projects & Conversations List */}
        <div className="flex flex-1 flex-col gap-1 overflow-x-hidden overflow-y-auto px-2.5 py-2">
          {/* Projects Section */}
          <div className="flex items-center justify-between px-2 pb-1 pt-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-chat-faint">
              Projeler
            </span>
            <button
              type="button"
              onClick={handleOpenNewProjectModal}
              className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-md border border-white/10 bg-white/5 text-gold hover:bg-gold/15"
              title="Yeni Proje Oluştur"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>

          <div
            onClick={() => {
              handleSelectProject(null);
              closeSidebarOnMobile();
            }}
            className={cx(
              "box-border flex h-8.5 cursor-pointer select-none items-center justify-between rounded-lg px-2.5 py-1.5 text-[12.5px]",
              activeProjectId === null ? "bg-chat-active font-medium text-white" : "bg-transparent text-chat-muted hover:bg-white/4"
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-gold/70" />
              <span className="truncate">Genel Çalışma Alanı</span>
            </div>
          </div>

          {projects.map((proj) => (
            <div
              key={proj.id}
              onClick={() => {
                handleSelectProject(proj.id);
                closeSidebarOnMobile();
              }}
              className={cx(
                "group box-border flex h-8.5 cursor-pointer select-none items-center justify-between rounded-lg px-2.5 py-1.5 text-[12.5px]",
                activeProjectId === proj.id ? "bg-chat-active font-medium text-white" : "bg-transparent text-chat-muted hover:bg-white/4"
              )}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: proj.color || "#c5a059" }}
                />
                <span className="truncate">{proj.name}</span>
              </div>
              <div className="ml-1 flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={(e) => handleOpenEditProjectModal(e, proj)}
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-chat-subtle opacity-0 [transition:all_0.15s_ease] hover:bg-white/10! hover:text-chat-text! hover:opacity-100! group-hover:opacity-70 touch:opacity-70"
                  title="Projeyi Düzenle"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDeleteProject(e, proj)}
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-chat-subtle opacity-0 [transition:all_0.15s_ease] hover:bg-danger/15! hover:text-danger! hover:opacity-100! group-hover:opacity-70 touch:opacity-70"
                  title="Projeyi Sil"
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
            </div>
          ))}

          <div className="truncate px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-chat-faint">
            {activeProjectId
              ? `${projects.find((p) => p.id === activeProjectId)?.name || "Proje"} Sohbetleri`
              : "Geçmiş Sohbetler"}
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
          ) : (() => {
            const q = conversationSearch.trim().toLowerCase();
            const projectFiltered = activeProjectId
              ? conversations.filter((c) => c.projectId === activeProjectId)
              : conversations.filter((c) => !c.projectId);
            const visibleConvs = q
              ? projectFiltered.filter((c) => (c.title || "").toLowerCase().includes(q))
              : projectFiltered;

            if (visibleConvs.length === 0) {
              return (
                <div className="px-2 py-3 text-center">
                  <p className="truncate text-[12px] text-chat-faint">
                    {q
                      ? "Eşleşen sohbet bulunamadı."
                      : activeProjectId
                      ? "Bu projede henüz sohbet yok."
                      : "Henüz kayıtlı sohbet yok."}
                  </p>
                  {q && (
                    <button
                      type="button"
                      onClick={() => setConversationSearch("")}
                      className="mt-1.5 text-[11px] text-gold hover:underline"
                    >
                      Aramayı temizle
                    </button>
                  )}
                </div>
              );
            }
            return visibleConvs.map((conv) => (
              <div
                key={conv.id}
                onClick={() => {
                  if (renamingConvId === conv.id) return;
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
                  {renamingConvId === conv.id ? (
                    <input
                      id={`rename-conv-${conv.id}`}
                      name="conversationTitle"
                      type="text"
                      autoFocus
                      maxLength={120}
                      value={renamingTitle}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenamingTitle(e.target.value)}
                      onBlur={() => void handleSaveRenameConversation(conv.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleSaveRenameConversation(conv.id);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setRenamingConvId(null);
                        }
                      }}
                      className="w-full min-w-0 rounded-md border border-gold/50 bg-black/40 px-1.5 py-0.5 text-[12.5px] text-white outline-hidden"
                    />
                  ) : (
                    <span className="truncate">
                      {displayConversationTitle(conv.title)}
                    </span>
                  )}
                </div>
                {/* Hidden until the row is hovered; touch screens have no hover, so it stays visible there. */}
                <div className="ml-1 flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => handleStartRenameConversation(e, conv)}
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-chat-subtle opacity-0 [transition:all_0.15s_ease] hover:bg-white/10! hover:text-chat-text! hover:opacity-100! group-hover:opacity-70 touch:opacity-70"
                    title="Sohbeti Yeniden Adlandır"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteConversation(e, conv.id)}
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-chat-subtle opacity-0 [transition:all_0.15s_ease] hover:bg-danger/15! hover:text-danger! hover:opacity-100! group-hover:opacity-70 touch:opacity-70"
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
              </div>
            ));
          })()}
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
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={handleOpenMemoryModal}
              className="flex cursor-pointer items-center border-none bg-transparent p-1 text-chat-subtle hover:text-gold"
              title="Uzun Süreli Bellek Yönetimi"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
            </button>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="flex cursor-pointer items-center border-none bg-transparent p-1 text-chat-subtle hover:text-chat-text"
              title="Ayarlar"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button
              onClick={handleSignOut}
              className="flex cursor-pointer items-center border-none bg-transparent p-1 text-chat-subtle"
              title="Güvenli Çıkış Yap"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="relative flex h-full min-w-0 flex-1 flex-col bg-chat-bg">
        {/* Top Bar */}
        <header className="flex h-[52px] min-h-[52px] shrink-0 items-center justify-between border-b border-white/8 bg-chat-bg px-4 mobile:box-content mobile:pl-1 mobile:pr-2 mobile:pt-[env(safe-area-inset-top,0px)]">
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
            <div ref={modelMenuRef} className="relative min-w-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setModelMenuOpen((prev) => !prev);
                }}
                className="flex min-w-0 cursor-pointer select-none items-center gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-[14px] font-semibold text-chat-text [transition:background_0.15s,border-color_0.15s] hover:border-white/10 hover:bg-white/5"
                title="Model ve sağlayıcı seçin"
              >
                <span className="rounded-sm border border-gold/35 bg-gold/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold">
                  {providerDisplayName(engineProvider || "evren")}
                </span>
                <span className="min-w-0 truncate">{modelLabel}</span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cx(
                    "shrink-0 text-chat-subtle [transition:transform_0.2s_ease]",
                    modelMenuOpen && "rotate-180"
                  )}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {modelMenuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute left-0 top-[calc(100%+6px)] z-80 flex w-[320px] max-w-[calc(100vw-24px)] flex-col gap-1 rounded-xl border border-white/12 bg-chat-modal p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.65)]"
                >
                  <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-chat-faint">
                    Model &amp; Sağlayıcı Seçimi
                  </div>
                  {CHAT_MODEL_OPTIONS.map((option) => {
                    const isSelected =
                      selectedModelId === option.id ||
                      (!selectedModelId &&
                        (engineProvider || "evren") === option.provider &&
                        modelLabel === option.model);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => handleSelectModelOption(option)}
                        className={cx(
                          "flex w-full cursor-pointer items-start justify-between gap-2.5 rounded-lg border-none px-2.5 py-2 text-left [transition:background_0.15s]",
                          isSelected
                            ? "bg-gold/14 text-chat-text"
                            : "bg-transparent text-chat-text hover:bg-white/6"
                        )}
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-chat-text">
                              {option.label}
                            </span>
                            <span className="rounded-sm border border-white/12 bg-white/6 px-1.5 py-px text-[10px] font-medium text-chat-muted">
                              {option.badge}
                            </span>
                          </div>
                          <span className="truncate text-[11px] text-chat-subtle">
                            {option.description}
                          </span>
                        </div>
                        {isSelected && (
                          <svg
                            width="15"
                            height="15"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="#c5a059"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="mt-0.5 shrink-0"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 mobile:gap-1.5">
            {activeProjectId && (() => {
              const activeProj = projects.find((p) => p.id === activeProjectId);
              if (!activeProj) return null;
              const repoHref = activeProj.githubRepo
                ? /^https?:\/\//i.test(activeProj.githubRepo)
                  ? activeProj.githubRepo
                  : `https://github.com/${activeProj.githubRepo}`
                : "";
              return (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => handleOpenEditProjectModal(e, activeProj)}
                    className="flex max-w-[180px] cursor-pointer items-center gap-1.5 rounded-full border border-gold/35 bg-gold/12 px-2.5 py-1 text-[12px] font-medium text-gold"
                    title={`Aktif Proje: ${activeProj.name} (Düzenlemek için tıklayın)`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: activeProj.color || "#c5a059" }}
                    />
                    <span className="truncate">{activeProj.name}</span>
                  </button>
                  {repoHref && (
                    <a
                      href={repoHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-white/4 text-chat-muted hover:border-gold/35 hover:text-gold"
                      title={`GitHub Deposunu Aç: ${repoHref}`}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                      </svg>
                    </a>
                  )}
                </div>
              );
            })()}
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleExportMarkdown}
                className="flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-2.5 text-[12px] font-medium text-chat-muted [transition:border-color_0.15s,color_0.15s,background_0.15s] hover:border-gold/35 hover:bg-gold/10 hover:text-gold mobile:w-7 mobile:px-0"
                title="Mevcut sohbeti Markdown (.md) dosyası olarak indir"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span className="mobile:hidden">.md İndir</span>
              </button>
            )}

            {deferredInstallPrompt && (
              <button
                type="button"
                onClick={handleInstallApp}
                className="flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-gold/40 bg-gold/15 px-2.5 text-[12px] font-medium text-gold hover:bg-gold/25 mobile:w-7 mobile:px-0"
                title="Alfred'i telefona yükle (PWA)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span className="mobile:hidden">Yükle</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleToggleNotifications}
              disabled={notificationLoading}
              className={cx(
                "flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border [transition:border-color_0.15s,color_0.15s,background_0.15s]",
                notificationState === "granted" && fcmToken
                  ? "border-gold/40 bg-gold/15 text-gold hover:bg-gold/25"
                  : "border-white/8 bg-white/4 text-chat-muted hover:border-white/16 hover:bg-white/8 hover:text-chat-text"
              )}
              title={
                notificationState === "granted" && fcmToken
                  ? "Bildirimler aktif (Test için tıklayın)"
                  : "Bildirimleri etkinleştir"
              }
            >
              {notificationLoading ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-gold border-t-transparent" />
              ) : notificationState === "granted" && fcmToken ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  <circle cx="18" cy="6" r="3" fill="#C9A45C" stroke="none" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  <line x1="2" y1="2" x2="22" y2="22" opacity="0.6" />
                </svg>
              )}
            </button>

            <div
              className="flex h-7 items-center justify-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-2.5 text-[12px] text-chat-muted mobile:w-7 mobile:px-0"
              title={`Durum: ${STATE_LABELS[state]}`}
            >
              <span className={cx(
                "h-2 w-2 rounded-full",
                state === "Listening" ? "bg-danger" :
                state === "Thinking" ? "bg-status-thinking" :
                state === "Streaming" ? "bg-gold" :
                state === "Error" ? "bg-danger" : "bg-success",
                state !== "Idle" && "animate-alfred-pulse"
              )} />
              <span className="mobile:hidden">{STATE_LABELS[state]}</span>
            </div>
          </div>
        </header>

        {/* Scrollable Message List */}
        <div className="flex flex-1 flex-col overflow-y-auto">
          <div className="my-0 flex w-full flex-col gap-6 px-5 pb-[140px] pt-6 mobile:px-3.5 mobile:pb-[100px] mobile:pt-4">
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
                  Alfred hizmetinizde. Bugün ne üzerinde çalışıyoruz?
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleSendMessage("Günaydın Alfred, bugünün sabah brifingini hazırlar mısın?")}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-4 py-2 text-[13px] font-medium text-gold shadow-sm transition hover:border-gold/60 hover:bg-gold/20"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" />
                      <line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                    <span>Sabah Brifingi Al</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSendMessage("Günü kapatalım Alfred, bugünün özetini, tamamlananları ve yarına kalanları çıkarır mısın?")}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-4 py-2 text-[13px] font-medium text-indigo-300 shadow-sm transition hover:border-indigo-400/60 hover:bg-indigo-500/20 hover:text-indigo-200"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                    <span>Günü Kapat</span>
                  </button>
                </div>
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

                <div className={msg.role === "user" ? (editingMessageId === msg.id ? "w-full max-w-[85%]" : "max-w-[78%]") : "max-w-full flex-1"}>
                  {msg.role === "assistant" && (
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px] font-semibold text-gold">
                      <span>ALFRED</span>
                      <span className="font-normal text-chat-faint">•</span>
                      <span className="font-normal text-chat-faint">{msg.timestamp}</span>
                      {msg.usedTools && msg.usedTools.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {msg.usedTools.map((toolName) => {
                            const status = msg.toolStatuses?.[toolName] ?? (msg.isThinking ? "running" : "success");
                            return (
                              <span
                                key={toolName}
                                className={cx(
                                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors",
                                  status === "error"
                                    ? "border-rose-500/35 bg-rose-500/10 text-rose-300"
                                    : status === "running"
                                    ? "border-gold/30 bg-gold/10 text-gold"
                                    : "border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
                                )}
                                title={
                                  status === "error"
                                    ? `${toolBadgeLabel(toolName)} (Hata)`
                                    : status === "running"
                                    ? `${toolBadgeLabel(toolName)} (Çalışıyor...)`
                                    : `${toolBadgeLabel(toolName)} (Başarılı)`
                                }
                              >
                                {status === "error" ? (
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-rose-400">
                                    <line x1="18" y1="6" x2="6" y2="18" />
                                    <line x1="6" y1="6" x2="18" y2="18" />
                                  </svg>
                                ) : status === "running" ? (
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-pulse text-gold">
                                    <circle cx="12" cy="12" r="10" />
                                    <polyline points="12 6 12 12 16 14" />
                                  </svg>
                                ) : (
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                                <span>{toolBadgeLabel(toolName)}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {msg.role === "user" ? (
                    editingMessageId === msg.id ? (
                      <div className="w-full min-w-[300px] rounded-[18px] border border-gold/40 bg-chat-surface p-3.5 shadow-lg">
                        <textarea
                          ref={(el) => {
                            if (el) {
                              el.style.height = "auto";
                              el.style.height = `${Math.max(el.scrollHeight, 44)}px`;
                            }
                          }}
                          value={editingText}
                          onChange={(e) => {
                            setEditingText(e.target.value);
                            e.target.style.height = "auto";
                            e.target.style.height = `${Math.max(e.target.scrollHeight, 44)}px`;
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleEditAndResend(msg.id, editingText);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingMessageId(null);
                              setEditingText("");
                            }
                          }}
                          className="w-full resize-none overflow-hidden bg-transparent text-[15px] leading-[1.55] text-chat-text outline-none placeholder:text-chat-muted"
                          autoFocus
                        />
                        <div className="mt-2.5 flex items-center justify-end gap-2 text-[12px]">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMessageId(null);
                              setEditingText("");
                            }}
                            className="cursor-pointer rounded-md px-2.5 py-1 text-chat-muted transition hover:bg-white/5 hover:text-chat-text"
                          >
                            İptal
                          </button>
                          <button
                            type="button"
                            disabled={!editingText.trim() || state === "Thinking" || state === "Streaming"}
                            onClick={() => handleEditAndResend(msg.id, editingText)}
                            className="cursor-pointer rounded-md bg-gold px-3 py-1 font-medium text-chat-ink transition hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Kaydet ve Gönder
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="group/user-msg flex items-center gap-2 justify-end">
                        {state !== "Thinking" && state !== "Streaming" && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMessageId(msg.id);
                              setEditingText(msg.text);
                            }}
                            title="Mesajı Düzenle"
                            aria-label="Mesajı Düzenle"
                            className="opacity-0 group-hover/user-msg:opacity-100 transition-opacity p-1.5 rounded-full text-chat-muted hover:text-gold hover:bg-white/5"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                          </button>
                        )}
                        <div className="rounded-[20px_20px_4px_20px] bg-chat-surface px-[18px] py-3 text-[15px] leading-[1.55] text-chat-text [word-break:break-word]">
                          <div className="[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p+p]:mt-2.5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="text-[15px] leading-[1.68] text-chat-text [word-break:break-word]">
                      {msg.isThinking || !renderMarkdown(msg.text) ? (
                        <div className="inline-flex items-center gap-1.5 px-0 py-1 text-[14px] text-chat-subtle">
                          <span className="h-1.5 w-1.5 animate-dot-bounce rounded-full bg-gold [animation-delay:-0.32s]" />
                          <span className="h-1.5 w-1.5 animate-dot-bounce rounded-full bg-gold [animation-delay:-0.16s]" />
                          <span className="h-1.5 w-1.5 animate-dot-bounce rounded-full bg-gold" />
                          {msg.rateLimitUntil ? (
                            <RateLimitNotice until={msg.rateLimitUntil} provider={msg.rateLimitProvider} />
                          ) : msg.providerNotice ? (
                            <span role="status">{msg.providerNotice}</span>
                          ) : (
                            <span>Düşünüyor...</span>
                          )}
                        </div>
                      ) : (
                        // Preflight strips list markers and paragraph margins; restore both here.
                        <div className="[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_p+p]:mt-2.5 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
                      )}
                    </div>
                  )}

                  {msg.role === "assistant" && !msg.isThinking && msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-chat-subtle">Kaynaklar:</span>
                      {msg.sources.slice(0, 6).map((src, idx) => (
                        <a
                          key={(src.url || "") + idx}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={src.title || src.source || src.url}
                          className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-white/10 bg-white/4 px-2.5 py-0.5 text-[11px] text-chat-muted no-underline [transition:border-color_0.15s,background_0.15s,color_0.15s] hover:border-gold/40 hover:bg-gold/10 hover:text-gold"
                        >
                          <span className="font-semibold text-gold">[{idx + 1}]</span>
                          <span className="truncate">{src.title || src.source || sourceDomain(src.url)}</span>
                        </a>
                      ))}
                    </div>
                  )}

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
        <div
          className={cx(
            "pointer-events-none absolute bottom-0 left-0 right-0 flex flex-col items-center bg-[linear-gradient(180deg,rgba(33,33,33,0)_0%,rgba(33,33,33,0.95)_25%,#212121_100%)] px-5 pt-4 mobile:px-2.5 mobile:pt-1.5",
            isKeyboardOpen
              ? "pb-1.5"
              : "pb-[calc(20px+env(safe-area-inset-bottom,0px))] mobile:pb-safe-bottom"
          )}
        >
          <div className="pointer-events-auto flex w-full max-w-[760px] items-end gap-2.5 rounded-[26px] border border-white/12 bg-chat-surface py-2.5 pl-5 pr-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.4)] mobile:flex-col mobile:items-stretch mobile:gap-1.5 mobile:rounded-[20px] mobile:p-2.5 mobile:shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            {/* 16px on phones stops iOS Safari from zooming in when the composer is focused. */}
            <textarea
              id="chat-message-input"
              name="message"
              aria-label="Alfred'e mesaj yazın"
              ref={textareaRef}
              value={inputText}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              onFocus={() => adjustTextareaHeight(textareaRef.current)}
              placeholder="Alfred'e mesaj yazın..."
              className="max-h-[55vh] min-h-[36px] min-w-0 flex-1 resize-none overflow-hidden border-none bg-transparent px-0 py-1.5 text-[15px] leading-relaxed text-chat-text outline-hidden placeholder:text-[#757575] [field-sizing:content] mobile:max-h-[55vh] mobile:min-h-[36px] mobile:w-full mobile:flex-none mobile:px-1 mobile:text-[16px] mobile:leading-normal"
            />

            <div className="flex shrink-0 items-center gap-1.5 mobile:w-full mobile:items-center mobile:justify-between mobile:pt-0.5">
              <button
                type="button"
                onClick={toggleRecording}
                className={cx(
                  "flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-none text-[17px] [transition:background_0.15s,color_0.15s]",
                  isRecording ? "animate-alfred-pulse-fast bg-danger text-white" : "bg-transparent text-chat-muted hover:bg-white/6 hover:text-chat-text"
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
                  type="button"
                  onClick={handleStopStreaming}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-none bg-danger/15 text-danger [transition:background_0.15s,color_0.15s] hover:bg-danger/25"
                  title="Durdur"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="4" width="16" height="16" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSendMessage()}
                  disabled={!inputText.trim()}
                  className={cx(
                    "flex h-9 w-9 items-center justify-center rounded-full border-none [transition:all_0.15s_ease]",
                    inputText.trim()
                      ? "cursor-pointer bg-gold text-chat-ink shadow-[0_2px_8px_rgba(197,160,89,0.35)] hover:bg-gold-light"
                      : "cursor-not-allowed bg-transparent text-chat-faint"
                  )}
                  title="Gönder"
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5" />
                    <polyline points="5 12 12 5 19 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <p className="pointer-events-auto mt-2 hidden text-center text-[11px] text-chat-faint md:block">
            Alfred — Barış&apos;ın Kişisel Yapay Zeka ve Yönetici Asistanı
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
              Üst çubuktaki seçiciden istediğiniz modeli seçebilirsiniz; seçilen sağlayıcı yanıt veremezse istek otomatik olarak yedek sağlayıcı zincirine (<code className="inline-code">EVREN → Groq → Gemini</code>) aktarılır.
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

      {/* Memory Management Modal */}
      {showMemoryModal && (
        <div
          onClick={() => setShowMemoryModal(false)}
          className="fixed inset-0 z-1000 flex items-center justify-center bg-black/75 p-4 backdrop-blur-[6px]"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[82vh] w-full max-w-[760px] flex-col rounded-2xl border border-white/10 bg-chat-modal p-6 shadow-[0_20px_50px_rgba(0,0,0,0.65)] mobile:p-4"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gold/35 bg-gold/12 text-gold">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[16px] font-semibold text-chat-text">Uzun Süreli Bellek</h3>
                    <span className="shrink-0 whitespace-nowrap rounded-full border border-gold/35 bg-gold/12 px-2 py-0.5 text-[11px] font-semibold text-gold">
                      {memoryItems.length} kayıt
                    </span>
                  </div>
                  <p className="truncate text-[11.5px] text-chat-subtle">
                    Firestore + Gemini semantik vektör belleğinde saklanan aktif bilgiler
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void fetchMemories()}
                  disabled={memoriesLoading}
                  className="flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border border-white/10 bg-white/4 px-2.5 py-1.5 text-[12px] text-chat-muted hover:bg-white/8 hover:text-chat-text"
                  title="Yenile"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={cx("shrink-0", memoriesLoading && "animate-spin-fast")}
                  >
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  <span className="mobile:hidden">Yenile</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNewMemoryOpen((prev) => !prev);
                    setMemoryFeedback(null);
                  }}
                  className={cx(
                    "flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold [transition:all_0.15s]",
                    newMemoryOpen
                      ? "border-gold bg-gold/20 text-gold"
                      : "border-gold/40 bg-gold/12 text-gold hover:bg-gold/20"
                  )}
                  title="Manuel olarak yeni bellek kaydı ekle"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  <span>Anı Ekle</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowMemoryModal(false)}
                  className="flex shrink-0 cursor-pointer items-center rounded-lg border-none bg-transparent p-1.5 text-chat-subtle hover:text-chat-text"
                  title="Kapat"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {memoryFeedback && (
              <div
                className={cx(
                  "mb-3 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-[12.5px]",
                  memoryFeedback.kind === "ok"
                    ? "border-success/35 bg-success/12 text-emerald-300"
                    : "border-danger/40 bg-danger/15 text-red-300"
                )}
              >
                <span>{memoryFeedback.text}</span>
                <button
                  type="button"
                  onClick={() => setMemoryFeedback(null)}
                  className="cursor-pointer border-none bg-transparent p-0.5 text-current opacity-75 hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            )}

            {newMemoryOpen && (
              <form
                onSubmit={handleCreateMemory}
                className="mb-3.5 flex flex-col gap-2.5 rounded-xl border border-gold/30 bg-white/4 p-3.5"
              >
                <div className="flex items-center justify-between">
                  <label htmlFor="new-memory-content-input" className="text-[12px] font-semibold text-gold">
                    Yeni Bellek Kaydı (Doğrudan Vektörleştirilir)
                  </label>
                  <span className="text-[11px] text-chat-faint">
                    {newMemoryContent.trim().length}/600
                  </span>
                </div>
                <textarea
                  id="new-memory-content-input"
                  name="newMemoryContent"
                  rows={2}
                  maxLength={600}
                  value={newMemoryContent}
                  onChange={(e) => setNewMemoryContent(e.target.value)}
                  placeholder="Ör: Barış yeni TypeScript projelerinde paket yöneticisi olarak pnpm kullanmayı tercih ediyor."
                  className="w-full resize-none rounded-lg border border-white/12 bg-black/25 px-3 py-2 text-[13px] leading-normal text-chat-text outline-hidden focus:border-gold/50"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      id="new-memory-project-select"
                      name="newMemoryProjectId"
                      aria-label="Bellek kapsamı (proje)"
                      value={newMemoryProjectId}
                      onChange={(e) => setNewMemoryProjectId(e.target.value)}
                      className="cursor-pointer rounded-lg border border-white/12 bg-chat-surface px-2.5 py-1.5 text-[12px] text-chat-text outline-hidden"
                    >
                      <option value="">🌐 Genel Bellek</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          📁 {p.name}
                        </option>
                      ))}
                    </select>
                    <select
                      id="new-memory-type-select"
                      name="newMemoryType"
                      aria-label="Bellek kategorisi"
                      value={newMemoryType}
                      onChange={(e) => setNewMemoryType(e.target.value)}
                      className="cursor-pointer rounded-lg border border-white/12 bg-chat-surface px-2.5 py-1.5 text-[12px] text-chat-text outline-hidden"
                    >
                      <option value="user_preference">Tercih</option>
                      <option value="technical_preference">Teknik Tercih</option>
                      <option value="project_fact">Proje Bilgisi</option>
                      <option value="architectural_decision">Mimari Karar</option>
                      <option value="user_fact">Kişisel Bilgi</option>
                      <option value="workflow">İş Akışı</option>
                      <option value="constraint">Kısıt</option>
                      <option value="general">Genel</option>
                    </select>
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11.5px] text-chat-muted">
                      <input
                        id="new-memory-supersede-checkbox"
                        name="newMemorySupersede"
                        type="checkbox"
                        checked={newMemorySupersede}
                        onChange={(e) => setNewMemorySupersede(e.target.checked)}
                        className="accent-gold"
                      />
                      <span>Benzer eski anıyı güncelle</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setNewMemoryOpen(false)}
                      className="cursor-pointer rounded-lg border border-white/10 bg-transparent px-2.5 py-1.5 text-[12px] text-chat-muted hover:text-chat-text"
                    >
                      İptal
                    </button>
                    <button
                      type="submit"
                      disabled={creatingMemory || newMemoryContent.trim().length < 5}
                      className="cursor-pointer rounded-lg border-none bg-gold px-3 py-1.5 text-[12px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {creatingMemory ? "Kaydediliyor..." : "Belleğe Kaydet"}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Search + Category Filters */}
            <div className="mb-3 flex flex-col gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/4 px-3 py-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-chat-faint">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  id="memory-search-input"
                  name="memorySearch"
                  type="search"
                  aria-label="Bellekte ara"
                  value={memorySearch}
                  onChange={(e) => setMemorySearch(e.target.value)}
                  placeholder="Bellek kayıtlarında ara (ör. tercih, proje, teknoloji)..."
                  className="w-full border-none bg-transparent text-[13px] text-chat-text outline-hidden placeholder:text-chat-faint"
                />
              </div>

              {projects.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] font-semibold text-chat-faint">Kapsam:</span>
                  {[
                    { id: "all", label: "Tüm Kapsamlar" },
                    { id: "global", label: "🌐 Genel Bellek" },
                    ...projects.map((p) => ({ id: p.id, label: `📁 ${p.name}` }))
                  ].map((scope) => (
                    <button
                      key={scope.id}
                      type="button"
                      onClick={() => setMemoryProjectFilter(scope.id)}
                      className={cx(
                        "cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] font-medium [transition:all_0.15s]",
                        memoryProjectFilter === scope.id
                          ? "border-gold/50 bg-gold/15 text-gold"
                          : "border-white/10 bg-white/4 text-chat-muted hover:bg-white/8"
                      )}
                    >
                      {scope.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { id: "all", label: "Tümü" },
                  { id: "user_preference", label: "Tercih" },
                  { id: "technical_preference", label: "Teknik" },
                  { id: "project_fact", label: "Proje" },
                  { id: "architectural_decision", label: "Mimari" },
                  { id: "user_fact", label: "Kişisel" },
                  { id: "workflow", label: "İş Akışı" },
                  { id: "general", label: "Genel" }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setMemoryTypeFilter(tab.id)}
                    className={cx(
                      "cursor-pointer rounded-full border px-2.5 py-1 text-[11.5px] font-medium [transition:all_0.15s]",
                      memoryTypeFilter === tab.id
                        ? "border-gold/50 bg-gold/15 text-gold"
                        : "border-white/10 bg-white/4 text-chat-muted hover:bg-white/8"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Memories List */}
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-1">
              {memoriesLoading && memoryItems.length === 0 ? (
                <div className="flex flex-col gap-2.5 py-3">
                  {[85, 70, 90].map((w, idx) => (
                    <div key={idx} className="rounded-xl border border-white/8 bg-white/3 p-3.5">
                      <div className={cx(SHIMMER, "mb-2 h-3.5 w-20 rounded-sm")} />
                      <div className={cx(SHIMMER, "h-3.5 rounded-sm")} style={{ width: `${w}%` }} />
                    </div>
                  ))}
                </div>
              ) : (() => {
                const q = memorySearch.trim().toLocaleLowerCase("tr-TR");
                const filtered = memoryItems.filter((item) => {
                  if (memoryProjectFilter === "global" && item.projectId) return false;
                  if (memoryProjectFilter !== "all" && memoryProjectFilter !== "global" && item.projectId !== memoryProjectFilter) return false;
                  if (memoryTypeFilter !== "all" && item.memoryType !== memoryTypeFilter) return false;
                  if (!q) return true;
                  return (
                    item.content.toLocaleLowerCase("tr-TR").includes(q) ||
                    memoryTypeLabel(item.memoryType).toLocaleLowerCase("tr-TR").includes(q)
                  );
                });
                if (filtered.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-white/8 bg-white/2 px-4 py-10 text-center text-[13px] text-chat-subtle">
                      {memoryItems.length === 0
                        ? "Henüz kaydedilmiş aktif bir uzun süreli bellek bulunmuyor."
                        : "Arama veya filtreyle eşleşen bellek kaydı bulunamadı."}
                    </div>
                  );
                }
                return filtered.map((item) => {
                  const projName = item.projectId
                    ? projects.find((p) => p.id === item.projectId)?.name || "Proje"
                    : null;
                  return (
                  <div
                    key={item.docId}
                    className="group flex items-start justify-between gap-3 rounded-xl border border-white/8 bg-white/3 p-3.5 [transition:border-color_0.15s,background_0.15s] hover:border-white/14 hover:bg-white/5"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-sm border border-gold/30 bg-gold/12 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold">
                          {memoryTypeLabel(item.memoryType)}
                        </span>
                        <span className="rounded-sm border border-white/12 bg-white/6 px-1.5 py-0.5 text-[10px] font-medium text-chat-muted">
                          {projName ? `📁 ${projName}` : "🌐 Genel"}
                        </span>
                        {item.createdAt && (
                          <span className="text-[11px] text-chat-faint">
                            {formatDateShort(item.createdAt)}
                          </span>
                        )}
                      </div>
                      <p className="m-0 text-[13.5px] leading-[1.5] text-chat-text [word-break:break-word]">
                        {item.content}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={deletingMemoryId === item.docId}
                      onClick={() => void handleDeleteMemory(item.docId)}
                      className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-[11.5px] text-chat-subtle [transition:all_0.15s] hover:border-danger/30 hover:bg-danger/12 hover:text-danger disabled:opacity-50"
                      title="Bu bellek kaydını sil (unut)"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      <span className="mobile:hidden">
                        {deletingMemoryId === item.docId ? "Siliniyor..." : "Unut"}
                      </span>
                    </button>
                  </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Project Create / Edit Modal */}
      {showProjectModal && (
        <div
          onClick={() => setShowProjectModal(false)}
          className="fixed inset-0 z-1000 flex items-center justify-center bg-black/75 p-4 backdrop-blur-[6px]"
        >
          <form
            onSubmit={handleSaveProject}
            onClick={(e) => e.stopPropagation()}
            className="flex w-full max-w-[520px] flex-col gap-3.5 rounded-2xl border border-white/10 bg-chat-modal p-6 shadow-[0_20px_50px_rgba(0,0,0,0.65)] mobile:p-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-semibold text-chat-text">
                {editingProjectId ? "Projeyi Düzenle" : "Yeni Proje Oluştur"}
              </h3>
              <button
                type="button"
                onClick={() => setShowProjectModal(false)}
                className="flex cursor-pointer items-center border-none bg-transparent p-1 text-chat-subtle hover:text-chat-text"
                title="Kapat"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <p className="m-0 text-[12.5px] leading-normal text-chat-subtle">
              Her projenin kendine özel sohbet geçmişi, mimari bağlamı ve diğer projelerden izole uzun süreli semantik belleği bulunur.
            </p>

            {projectFormError && (
              <div className="rounded-xl border border-danger/40 bg-danger/15 px-3 py-2 text-[12.5px] text-red-300">
                {projectFormError}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="project-name-input" className="text-[12px] font-semibold text-chat-muted">
                Proje Adı
              </label>
              <input
                id="project-name-input"
                name="projectName"
                type="text"
                required
                maxLength={80}
                value={projectFormName}
                onChange={(e) => setProjectFormName(e.target.value)}
                placeholder="Ör: Alfred, Otonom İHA, Finans API..."
                className="w-full rounded-xl border border-white/12 bg-black/25 px-3 py-2 text-[13.5px] text-chat-text outline-hidden focus:border-gold/50"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="project-repo-input" className="text-[12px] font-semibold text-chat-muted">
                GitHub Depo Bağlantısı (İsteğe Bağlı)
              </label>
              <input
                id="project-repo-input"
                name="projectRepo"
                type="url"
                maxLength={220}
                value={projectFormRepo}
                onChange={(e) => setProjectFormRepo(e.target.value)}
                onBlur={() => {
                  const v = projectFormRepo.trim();
                  if (v && !/^https?:\/\//i.test(v)) {
                    setProjectFormRepo(`https://github.com/${v.replace(/^github\.com\//i, "")}`);
                  }
                }}
                placeholder="https://github.com/barissalihbabacan/Alfred"
                className="w-full rounded-xl border border-white/12 bg-black/25 px-3 py-2 text-[13px] text-chat-text outline-hidden focus:border-gold/50"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="project-desc-input" className="text-[12px] font-semibold text-chat-muted">
                Proje Talimatları &amp; Mimari Bağlam (İsteğe Bağlı)
              </label>
              <textarea
                id="project-desc-input"
                name="projectDescription"
                rows={3}
                maxLength={1500}
                value={projectFormDesc}
                onChange={(e) => setProjectFormDesc(e.target.value)}
                placeholder="Ör: Next.js 16 + Firebase Cloud Functions + Firestore tabanlı proje. Kod örneklerinde TypeScript ve ESM kullan..."
                className="w-full resize-none rounded-xl border border-white/12 bg-black/25 px-3 py-2 text-[13px] leading-normal text-chat-text outline-hidden focus:border-gold/50"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-semibold text-chat-muted">Renk Etiketi:</span>
              <div className="flex items-center gap-2">
                {PROJECT_COLORS.map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => setProjectFormColor(col)}
                    className={cx(
                      "h-6 w-6 cursor-pointer rounded-full border-2 [transition:transform_0.15s]",
                      projectFormColor === col ? "scale-110 border-white" : "border-transparent opacity-70 hover:opacity-100"
                    )}
                    style={{ backgroundColor: col }}
                    aria-label={`Renk ${col}`}
                  />
                ))}
              </div>
            </div>

            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowProjectModal(false)}
                className="cursor-pointer rounded-xl border border-white/12 bg-transparent px-4 py-2 text-[13px] text-chat-muted hover:text-chat-text"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={savingProject || projectFormName.trim().length < 2}
                className="cursor-pointer rounded-xl border-none bg-gold px-4 py-2 text-[13px] font-semibold text-black disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingProject ? "Kaydediliyor..." : editingProjectId ? "Güncelle" : "Projeyi Oluştur"}
              </button>
            </div>
          </form>
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
            <div className="mb-3 flex items-center justify-between gap-3 rounded-[10px] border border-white/8 bg-white/3 p-3.5">
              <span className="text-[13px] text-chat-muted">Aktif Kullanıcı:</span>
              <strong className="overflow-hidden text-ellipsis text-[13px]">{user?.email || "-"}</strong>
            </div>

            {/* Google Workspace Integration Row */}
            <div className="mb-[18px] flex flex-col gap-2 rounded-[10px] border border-white/8 bg-white/3 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold text-chat-text">Google Workspace (Takvim, Görevler, Gmail)</span>
                  <span className="text-[11px] text-chat-subtle">
                    {googleConnected
                      ? (googleEmail ? `${googleEmail} bağlı` : "Bağlantı aktif")
                      : "Tek tıkla bağlanın, Alfred ajandanızı ve e-postalarınızı yönetsin"}
                  </span>
                </div>
                {googleConnected ? (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
                    Bağlı
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={googleConnecting}
                    onClick={async () => {
                      try {
                        setGoogleConnecting(true);
                        const redirectUri = window.location.origin + "/auth/google/callback";
                        const res = await apiFetch(`/auth/google/url?redirectUri=${encodeURIComponent(redirectUri)}`);
                        const data = await res.json();
                        if (data?.url) {
                          window.location.href = data.url;
                        } else {
                          alert("Google OAuth URL alınamadı.");
                        }
                      } catch (err: unknown) {
                        alert("Hata: " + ((err as Error)?.message || String(err)));
                      } finally {
                        setGoogleConnecting(false);
                      }
                    }}
                    className="cursor-pointer rounded-lg border border-gold/40 bg-gold/15 px-3 py-1.5 text-[12px] font-semibold text-gold hover:bg-gold/25 disabled:opacity-50"
                  >
                    {googleConnecting ? "Açılıyor…" : "Google'a Bağlan"}
                  </button>
                )}
              </div>
              {googleConnected && (
                <div className="mt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm("Google Takvim ve Görevler bağlantısını kesmek istiyor musunuz?")) return;
                      try {
                        await apiFetch("/auth/google/disconnect", { method: "DELETE" });
                        setGoogleConnected(false);
                        setGoogleEmail(null);
                      } catch (_err) {
                        alert("Bağlantı kesilemedi.");
                      }
                    }}
                    className="cursor-pointer border-none bg-transparent p-0 text-[11px] text-red-400/80 hover:text-red-400 hover:underline"
                  >
                    Bağlantıyı Kaldır
                  </button>
                </div>
              )}
            </div>

            {/* FCM Push Notifications & PWA Row */}
            <div className="mb-[18px] flex flex-col gap-2 rounded-[10px] border border-white/8 bg-white/3 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold text-chat-text">Anlık Bildirimler (FCM & PWA)</span>
                  <span className="text-[11px] text-chat-subtle">
                    {notificationState === "granted" && fcmToken
                      ? "Cihazınız bildirim almaya hazır"
                      : "Görev, alarm ve arka plan bildirimleri için izni açın"}
                  </span>
                </div>
                {notificationState === "granted" && fcmToken ? (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-400">
                    Aktif
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={notificationLoading}
                    onClick={handleToggleNotifications}
                    className="cursor-pointer rounded-lg border border-gold/40 bg-gold/15 px-3 py-1.5 text-[12px] font-semibold text-gold hover:bg-gold/25 disabled:opacity-50"
                  >
                    {notificationLoading ? "Açılıyor…" : "Bildirimleri Aç"}
                  </button>
                )}
              </div>

              {notificationState === "granted" && fcmToken && (
                <div className="mt-1 flex items-center justify-between gap-2 border-t border-white/6 pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await sendTestPushNotification();
                        alert(res.message);
                      } catch (err: unknown) {
                        alert("Hata: " + ((err as Error)?.message || String(err)));
                      }
                    }}
                    className="cursor-pointer rounded-md border border-white/12 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-gold hover:bg-white/10"
                  >
                    Test Bildirimi Gönder
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm("Bildirimler bu cihaz için devre dışı bırakılsın mı?")) return;
                      try {
                        await removeFcmTokenFromBackend(fcmToken);
                        localStorage.removeItem("alfred_fcm_token");
                        setFcmToken(null);
                        setNotificationState(getNotificationPermissionState());
                      } catch (_err) {
                        alert("Kaldırılamadı.");
                      }
                    }}
                    className="cursor-pointer border-none bg-transparent p-0 text-[11px] text-red-400/80 hover:text-red-400 hover:underline"
                  >
                    Bildirimleri Kapat
                  </button>
                </div>
              )}

              {deferredInstallPrompt && (
                <div className="mt-1 flex items-center justify-between rounded-lg border border-gold/30 bg-gold/10 p-2.5">
                  <div className="flex flex-col">
                    <span className="text-[12px] font-medium text-gold">Telefon Uygulaması (PWA)</span>
                    <span className="text-[10px] text-chat-subtle">Ana ekranınıza tam ekran Alfred uygulamasını kurun</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleInstallApp}
                    className="cursor-pointer rounded-lg bg-gold px-3 py-1 text-[11px] font-bold text-black hover:bg-gold-light"
                  >
                    Yükle
                  </button>
                </div>
              )}
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
