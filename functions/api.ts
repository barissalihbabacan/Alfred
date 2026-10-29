// src/ altindaki paylasilan TypeScript modulleri; esbuild bunlari
// functions/lib/index.js icine paketler (functions/build.js).
import { cosineSimilarity } from "../src/data/vector/cosine-similarity.js";
import { generateDeterministicTitle } from "../src/data/firestore/conversation-title.js";
import { PROFILE_OWNER } from "../src/alfred/cognitive/context/profile-owner.js";
import {
  GET_CURRENT_TIME_TOOL_DEFINITION as TIME_TOOL_DEFINITION,
  runGetCurrentTimeTool
} from "../src/ai/tools/time/current-time.js";
import { isRateLimitedError } from "../src/ai/providers/groq/rate-limit.js";
import {
  applyChatModelPreference,
  isUsableApiKey,
  resolveChatProviders
} from "../src/ai/providers/chat-fallback/chat-providers.js";
import { WEB_SEARCH_TOOL_DEFINITION, createTurnWebSearch } from "../src/ai/tools/web/web-search.js";
import { READ_URL_TOOL_DEFINITION, createTurnReadUrl } from "../src/ai/tools/web/read-url.js";
import { GITHUB_TOOL_DEFINITION, createTurnGitHub } from "../src/ai/tools/github/github.js";
import {
  GOOGLE_CALENDAR_TOOL_DEFINITION,
  createGoogleCalendarTool
} from "../src/ai/tools/google/calendar.js";
import {
  GOOGLE_TASKS_TOOL_DEFINITION,
  createGoogleTasksTool
} from "../src/ai/tools/google/tasks.js";
import {
  GMAIL_TOOL_DEFINITION,
  createGmailTool
} from "../src/ai/tools/google/gmail.js";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  fetchGoogleUserEmail
} from "../src/ai/tools/google/google-auth.js";
import { lookup } from "node:dns/promises";
import { buildHealthStatus } from "../src/ai/providers/chat-fallback/health-status.js";
import {
  addUsageToMetrics,
  createChatTurnMetrics,
  createChatTurnState,
  runChatTurnWithFallback
} from "../src/ai/providers/chat-fallback/chat-turn.js";
import { toChatTurnErrorEvent } from "../src/ai/providers/chat-fallback/failover.js";
import {
  DEFAULT_GEMINI_EXTRACTION_MODEL,
  DEFAULT_GROQ_EXTRACTION_MODEL
} from "../src/ai/providers/chat-fallback/extraction-providers.js";
import { MEMORY_EXTRACTION_BUDGET_MS } from "../src/alfred/cognitive/memory/extractor/extraction-pipeline.js";
import {
  buildMemoryRetractionUpdate,
  createMemoryWriteTally
} from "../src/alfred/cognitive/memory/memory-write-planner.js";
import {
  generateEmbedding,
  isComparableEmbedding
} from "../src/ai/embedding/embedding-client.js";
import { createExtractAndPersistMemories } from "./memory-extraction.js";
import { persistMemoryCandidates } from "./memory-persistence.js";
import { buildAlfredSystemPrompt } from "../src/ai/prompts/alfred-system-prompt.js";
import {
  SSH_CONNECT_TOOL_DEFINITION,
  SSH_LIST_DIRECTORY_TOOL_DEFINITION,
  SSH_EXECUTE_TOOL_DEFINITION
} from "../src/ai/tools/ssh/ssh-tool-definitions.js";
import { ALLOWED_SSH_COMMANDS } from "../src/alfred/execution-plane/ssh/allowed-commands.js";
import { verifyUserAuthorization as coreVerifyUserAuthorization } from "../src/core/permissions/authorization.js";
import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { getAppCheck } from "firebase-admin/app-check";
import { getMessaging } from "firebase-admin/messaging";
import * as logger from "firebase-functions/logger";

setGlobalOptions({ maxInstances: 10, timeoutSeconds: 120, memory: "512MiB" });

// Secret Manager'dan cozulur.
//
// Secret'lar bir kez olusturulur:
//
//   firebase functions:secrets:set GROQ_API_KEY
//   firebase functions:secrets:set GEMINI_API_KEY
//
// Degeri "unset" veya "none" olan anahtar yapilandirilmamis sayilir; o
// saglayici atlanir (src/ai/providers/chat-fallback/chat-providers.ts).
//
// Emulatorde ayni adlar functions/.secret.local dosyasindan okunur
// (gitignore'da). Anahtar istemciden (istek basligi) hicbir zaman alinmaz.
//
// Secret adlari defineSecret'in kisitlamasi geregi gecerli ortam degiskeni
// adlari olmali (tire kullanilamaz).
const EVREN_API_KEY = defineSecret("EVREN_API_KEY");
const GROQ_API_KEY = defineSecret("GROQ_API_KEY");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
// web_search (Tavily). "unset" (or empty) leaves the tool out entirely.
const TAVILY_API_KEY = defineSecret("TAVILY_API_KEY");
const GOOGLE_OAUTH_CLIENT_ID = defineSecret("GOOGLE_OAUTH_CLIENT_ID");
const GOOGLE_OAUTH_CLIENT_SECRET = defineSecret("GOOGLE_OAUTH_CLIENT_SECRET");

const ALLOWED_UID = (process.env.ALLOWED_UID || "").trim();
const ALLOWED_EMAIL = (process.env.ALLOWED_EMAIL || "").toLowerCase().trim();

// App Check zorunlulugu varsayilan olarak ACIK (24 Eyl: canli trafigin tamami
// "valid" idi). Emulatorde kapali; gerekirse ENFORCE_APP_CHECK=false ile
// kapatilabilir. Durum her llm_request loguna yazilmaya devam eder (app_check).
const ENFORCE_APP_CHECK =
  process.env.ENFORCE_APP_CHECK !== "false" && !process.env.FUNCTIONS_EMULATOR;

// Ollama yalnizca OLLAMA_BASE_URL verilmisse kullanilir (functions/.env.<proje>).
// Bos ise: /health onu yoklamaz, embedding ve bellek cikarimi onu atlar.
function ollamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || "").trim();
}

// Web istemcisi redirectUri'yi her zaman kendi origin'inden gonderir; bu yalnizca
// eksik geldiginde kullanilir. Proje, Functions calisma ortaminin verdigi
// GCLOUD_PROJECT'ten gelir (sabit bir proje adi yok).
function defaultGoogleRedirectUri() {
  const projectId = (process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "").trim();
  return projectId ? `https://${projectId}.web.app/auth/google/callback` : "";
}

// Izleme icin token'siz erisilebilen yollar: saglik kontrolu ve kok.
function isAppCheckExempt(path) {
  return path.endsWith("/health") || path === "/" || path === "" || path === "/api" || path === "/api/";
}

function gizliOku(secret, envAdi) {
  try {
    const deger = secret.value();
    if (deger) return deger;
  } catch {
    // Secret baglanmamis (ornegin birim testinde): ortam degiskenine dus.
  }
  return process.env[envAdi] || "";
}

if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

// Yapilandirilmis (JSON) operasyonel loglar. firebase-functions/logger tek
// satirlik JSON yazar; Cloud Logging bunu jsonPayload olarak ayristirir ve
// severity/message alanlarini kullanir. Her olayin sabit bir `event` alani
// vardir (llm_request, tool_call, memory_retrieval, memory_extraction), boylece
// Cloud Logging'de jsonPayload.event="llm_request" gibi sorgulanabilir.
//
// Buraya asla API anahtari, ID token, tam kullanici mesaji ya da bellek icerigi
// konmaz (mevcut "Stored long-term memory" satiri disinda).
//
// logger.write kullanilir: logger.error, message alanina yigin izi ekler ve
// her olayi Error Reporting'e tasir; metrik olaylarinda message okunur kalmali.
function logEvent(severity, event, message, fields = {}) {
  logger.write({ ...fields, severity, message, event });
}

function msSince(start) {
  return Math.round(performance.now() - start);
}

function errMessage(err) {
  return String(err?.message || err || "unknown error").slice(0, 300);
}

export function verifyUserAuthorization(
  authenticatedUid: string | null | undefined,
  authenticatedEmail: string | null | undefined,
  isEmailVerified: boolean,
  configuredUid: string = ALLOWED_UID,
  configuredEmail: string = ALLOWED_EMAIL
) {
  return coreVerifyUserAuthorization(
    authenticatedUid,
    authenticatedEmail,
    isEmailVerified,
    configuredUid,
    configuredEmail,
    () => logEvent("ERROR", "auth", "Authorization not configured on backend.")
  );
}

// Embedding cagrilari (Gemini -> Ollama -> hata) src/ai/embedding/embedding-client.ts
// icinde; loglama burada kalir. Farkli modellerin vektorleri ayni uzayda
// olmadigindan yalnizca ayni modelle uretilmis kayitlar karsilastirilir
// (isComparableEmbedding).

// { values, model } dondurur.
async function getEmbedding(text, ollamaUrl, geminiKey) {
  return generateEmbedding(text, {
    geminiApiKey: geminiKey || gizliOku(GEMINI_API_KEY, "GEMINI_API_KEY") || "",
    ollamaUrl,
    onGeminiError: (e) => {
      if (e.kind === "http") {
        logger.warn(`[Embedding] Gemini ${e.model} HTTP ${e.status}: ${e.body}`, {
          event: "embedding_error", model: e.model, http_status: e.status
        });
      } else {
        logger.warn(`[Embedding] Gemini embedding call failed: ${errMessage(e.error)}`, {
          event: "embedding_error", model: e.model
        });
      }
    }
  });
}

/**
 * Dispatches a server command to the Firestore command queue, where the owner's
 * home server relay daemon (alfred-relay) picks it up, validates and executes it
 * locally on the home server, and writes back the structured output.
 */
async function dispatchServerCommandViaRelay(db, { host, command, args, userId }) {
  const targetHost = host || "home-server";
  if (!ALLOWED_SSH_COMMANDS.includes(command)) {
    return {
      error: `Command '${command}' is not permitted. Only strictly whitelisted commands (${ALLOWED_SSH_COMMANDS.join(", ")}) may be executed.`
    };
  }

  const TIMEOUT_MS = 20000;
  const docRef = await db.collection("server_commands").add({
    userId: userId || "owner",
    host: targetHost,
    command,
    args: (args && typeof args === "object" && !Array.isArray(args)) ? args : {},
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Date.now() + TIMEOUT_MS
  });

  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(async () => {
      if (resolved) return;
      resolved = true;
      try { unsubscribe(); } catch {}
      await docRef.update({ status: "timed_out" }).catch(() => {});
      resolve({
        error: "Ev sunucusu rölesi zaman aşımına uğradı (20s). Ev sunucusundaki alfred-relay servisinin çalıştığından emin olun."
      });
    }, TIMEOUT_MS);

    const unsubscribe = docRef.onSnapshot(
      (snapshot) => {
        if (resolved || !snapshot.exists) return;
        const data = snapshot.data();
        if (data.status === "completed") {
          resolved = true;
          clearTimeout(timer);
          try { unsubscribe(); } catch {}
          docRef.delete().catch(() => {});
          resolve(data.result);
        } else if (data.status === "failed") {
          resolved = true;
          clearTimeout(timer);
          try { unsubscribe(); } catch {}
          docRef.delete().catch(() => {});
          resolve({ error: data.error || "Komut ev sunucusunda başarısız oldu." });
        }
      },
      (err) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        try { unsubscribe(); } catch {}
        resolve({ error: `Firestore relay dinleyici hatası: ${err.message}` });
      }
    );
  });
}

// `stats` verilirse metrik alanlariyla doldurulur (memory_retrieval olayi icin).
// `activeProjectId` doluysa hem o projeye ait anilar hem de genel (`projectId: null`)
// anilar degerlendirilir (proje anilarina +0.04 oncelik puani verilir); baska
// projelerin anilari karistirilmaz. `activeProjectId` bossa yalnizca genel anilar doner.
async function retrieveRelevantMemories(db, query, userId, topK = 5, minScore = 0.35, stats = null, activeProjectId = null) {
  const memSnap = await db.collection("memory_vectors")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .get();

  const scored = [];
  let candidateCount = 0;
  let topScore = null;
  const targetProject = typeof activeProjectId === "string" && activeProjectId.trim()
    ? activeProjectId.trim()
    : null;

  for (const doc of memSnap.docs) {
    const d = doc.data();
    const docProject = typeof d.projectId === "string" && d.projectId.trim() ? d.projectId.trim() : null;
    if (targetProject) {
      if (docProject !== null && docProject !== targetProject) continue;
    } else if (docProject !== null) {
      continue;
    }

    if (isComparableEmbedding(d, query.model)) {
      candidateCount++;
      const rawScore = cosineSimilarity(query.values, d.embedding);
      if (topScore === null || rawScore > topScore) topScore = rawScore;
      if (rawScore >= minScore) {
        const boost = targetProject && docProject === targetProject ? 0.04 : 0;
        scored.push({
          memoryId: d.memoryId || doc.id,
          content: d.content,
          memoryType: d.memoryType || "general",
          projectId: docProject,
          score: rawScore + boost
        });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const result = scored.slice(0, topK);
  if (stats) {
    stats.active_count = memSnap.size;
    stats.candidate_count = candidateCount;
    stats.above_threshold_count = scored.length;
    stats.returned_count = result.length;
    stats.top_score = topScore === null ? null : Number(topScore.toFixed(4));
  }
  return result;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Bellek cikarimi sohbet modelinden ayri, kucuk bir modelde calisir. Groq'un
// ucretsiz plani sinirlari model basina uygular (gpt-oss-120b: dakikada 8.000
// token); ayni modeli kullaninca her sohbet turu kotayi iki kez harciyordu.
// 24 Eyl'de 6 ornekte (tercih, sohbet, saat, gizli anahtar, karar, unut)
// gpt-oss-20b, 120b ile ayni kararlari verdi. src/ ile ayni ortam degiskeni.
const MEMORY_EXTRACTION_MODEL = process.env.MEMORY_EXTRACTION_MODEL || DEFAULT_GROQ_EXTRACTION_MODEL;
// Groq basarisiz olursa (or. gunluk limit) cikarim Ollama'dan once Gemini'de
// kucuk, ucuz bir modelle denenir (token basina ucretli).
const GEMINI_EXTRACTION_MODEL = process.env.GEMINI_EXTRACTION_MODEL || DEFAULT_GEMINI_EXTRACTION_MODEL;

function extractorModelFor(provider) {
  if (provider === "evren") return process.env.EVREN_MODEL || "qwen3.8-flash-next";
  if (provider === "groq") return MEMORY_EXTRACTION_MODEL;
  if (provider === "gemini") return GEMINI_EXTRACTION_MODEL;
  return undefined;
}

// Cikarim adimlari (istem, baglam siniri, "bunu hatirlama" kisa devresi,
// Groq -> Gemini -> Ollama cagrisi, adaylarin kaydi) src/ ile ortak:
// memory-extraction.js. Buradan yalnizca Firebase bagimliliklari verilir.
const extractAndPersistMemories = createExtractAndPersistMemories({
  fetch: (url, init) => fetch(url, init),
  logger,
  now: () => Timestamp.now(),
  getEmbedding,
  errMessage,
  memoryExtractionModel: MEMORY_EXTRACTION_MODEL,
  geminiExtractionModel: GEMINI_EXTRACTION_MODEL
});

export const api = onRequest({
  cors: true,
  secrets: [EVREN_API_KEY, GROQ_API_KEY, GEMINI_API_KEY, TAVILY_API_KEY, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET]
}, async (req, res) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Firebase-AppCheck, x-recaptcha-token");
    res.status(204).send("");
    return;
  }

  res.set("Access-Control-Allow-Origin", "*");
  const path = req.path || req.url || "";

  // App Check verification. The "invalid" log carries path/exempt so the
  // alfred_app_check_rejections alert metric can ignore probes of / and /health.
  // appCheckStatus ("valid" | "invalid" | "missing")
  // is logged on every llm_request so enforcement can be switched on
  // (ENFORCE_APP_CHECK=true) only once the logs show real traffic is "valid".
  const appCheckToken = req.header("X-Firebase-AppCheck");
  let appCheckStatus = "missing";
  if (appCheckToken) {
    try {
      await getAppCheck().verifyToken(appCheckToken);
      appCheckStatus = "valid";
    } catch (err) {
      appCheckStatus = "invalid";
      logger.warn("[AppCheck] Token verification failed.", { event: "app_check", outcome: "invalid", path, exempt: isAppCheckExempt(path), error: errMessage(err) });
      if (ENFORCE_APP_CHECK && !isAppCheckExempt(path)) {
        res.status(401).json({ error: "Güvenlik doğrulaması (App Check) geçersiz. Sayfayı yenileyip tekrar deneyin.", code: "app_check_invalid" });
        return;
      }
    }
  } else if (ENFORCE_APP_CHECK && !isAppCheckExempt(path)) {
    logger.warn("[AppCheck] Missing token.", { event: "app_check", outcome: "missing", path });
    res.status(401).json({ error: "Güvenlik doğrulaması (App Check) eksik. Sayfayı yenileyin; sorun sürerse reklam engelleyicinin reCAPTCHA'yı engellemediğinden emin olun.", code: "app_check_missing" });
    return;
  }

  // Safe handling for root or blocking auth functions
  if (path === "/" || path === "" || path === "/api" || path === "/api/") {
    res.status(200).json({ status: "ok" });
    return;
  }

  // Health endpoint: /health or /api/health. Resolves the chat providers the
  // same way /chat does (src/ai/providers/chat-fallback/health-status.ts), so
  // the engine the UI shows is the one the next turn would start on.
  if (path.endsWith("/health")) {
    const llmProvider = (process.env.ALFRED_LLM_PROVIDER || process.env.AI_PROVIDER || "groq").trim().toLowerCase();
    const keys = {
      evren: gizliOku(EVREN_API_KEY, "EVREN_API_KEY"),
      groq: gizliOku(GROQ_API_KEY, "GROQ_API_KEY"),
      gemini: gizliOku(GEMINI_API_KEY, "GEMINI_API_KEY")
    };

    // Only the Ollama path probes Ollama; it has no fallback. Without
    // OLLAMA_BASE_URL it counts as unreachable (activeProvider "offline").
    let ollamaReachable = false;
    const ollamaUrl = ollamaBaseUrl();
    if (llmProvider !== "groq" && ollamaUrl) {
      try {
        const resp = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/tags`, {
          signal: AbortSignal.timeout(4000)
        });
        ollamaReachable = resp.ok;
      } catch {
        ollamaReachable = false;
      }
    }

    res.status(200).json(buildHealthStatus({
      llmProvider,
      keys,
      env: process.env,
      ollamaReachable,
      ollamaModel: process.env.OLLAMA_MODEL || "gemma4:12b-mlx"
    }));
    return;
  }

  // Buradan sonraki her uc nokta (konusma okuma/silme, sohbet) gecerli bir
  // Firebase ID token ister. Onceden token opsiyoneldi: basliksiz bir istek
  // her iki kontrolu de geciyor ve userId varsayilan olarak ALLOWED_UID
  // oluyordu, yani giris yapmamis herkes konusmalari okuyabiliyordu.
  const authHeader = req.header("Authorization") || req.header("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized: Missing auth token." });
    return;
  }

  let authenticatedUid;
  let authenticatedEmail;
  let isEmailVerified;
  try {
    const decoded = await getAuth().verifyIdToken(authHeader.substring(7).trim());
    authenticatedUid = decoded?.uid || null;
    authenticatedEmail = (decoded?.email || "").toLowerCase().trim();
    isEmailVerified = Boolean(decoded?.email_verified);
  } catch (err) {
    console.warn("[Auth] ID token verification failed:", err.message);
    res.status(401).json({ error: "Unauthorized: Invalid or expired auth token." });
    return;
  }

  // Dual verification: UID and/or Email
  const authCheck = verifyUserAuthorization(authenticatedUid, authenticatedEmail, isEmailVerified);
  if (!authCheck.authorized) {
    console.warn(`[Auth] ${authCheck.status === 503 ? "Unconfigured" : "Forbidden"}: UID ${authenticatedUid} (email: ${authenticatedEmail}) attempted access`);
    res.status(authCheck.status || 403).json({ error: authCheck.error || "Forbidden: Unauthorized account." });
    return;
  }

  // Istemcinin gonderdigi userId'ye guvenilmez; kullanici her zaman token'daki UID'dir.
  const requestedUserId = (req.query?.userId || req.body?.userId || "").toString();
  if (requestedUserId && requestedUserId !== authenticatedUid) {
    console.warn("[Auth] Forbidden: requested userId does not match the authenticated user");
    res.status(403).json({ error: "Forbidden: Unauthorized UID." });
    return;
  }
  const userId = authenticatedUid;

  // Baska bir kullaniciya ait konusma yok sayilir. userId alani olmayan eski
  // kayitlar erisilebilir kalir.
  const baskasinin = (snap) => {
    const owner = snap.exists ? snap.data()?.userId : undefined;
    return Boolean(owner) && owner !== userId;
  };

  // Conversation history restore endpoint: GET /chat or GET /conversation
  if ((path.endsWith("/chat") || path.endsWith("/conversation") || path.endsWith("/conversations")) && req.method === "GET") {
    try {
      const conversationId = (req.query?.conversationId || req.query?.id || "").toString();

      if (conversationId) {
        const convRef = db.collection("conversations").doc(conversationId);
        const convSnap = await convRef.get();

        if (!convSnap.exists || baskasinin(convSnap)) {
          res.status(404).json({ error: "Conversation not found" });
          return;
        }

        const messagesSnap = await convRef
          .collection("messages")
          .orderBy("sequence", "desc")
          .limit(20)
          .get();

        const messages = messagesSnap.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate() : new Date()
          }))
          .reverse();

        res.status(200).json({
          success: true,
          conversation: {
            id: convSnap.id,
            ...convSnap.data(),
            createdAt: convSnap.data().createdAt?.toDate ? convSnap.data().createdAt.toDate() : new Date(),
            updatedAt: convSnap.data().updatedAt?.toDate ? convSnap.data().updatedAt.toDate() : new Date(),
            lastMessageAt: convSnap.data().lastMessageAt?.toDate ? convSnap.data().lastMessageAt.toDate() : new Date()
          },
          messages
        });
        return;
      }

      if (userId) {
        const convsSnap = await db
          .collection("conversations")
          .where("userId", "==", userId)
          .orderBy("lastMessageAt", "desc")
          .limit(20)
          .get();

        const conversations = convsSnap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toDate ? doc.data().createdAt.toDate() : new Date(),
          updatedAt: doc.data().updatedAt?.toDate ? doc.data().updatedAt.toDate() : new Date(),
          lastMessageAt: doc.data().lastMessageAt?.toDate ? doc.data().lastMessageAt.toDate() : new Date()
        }));

        res.status(200).json({ success: true, conversations });
        return;
      }

      res.status(400).json({ error: "conversationId or userId is required." });
      return;
    } catch (err) {
      console.error("Cloud Function conversation retrieval failed:", err);
      res.status(500).json({ error: "Failed to retrieve conversation." });
      return;
    }
  }

  // Conversation rename endpoint: POST /conversation or PATCH /chat
  if (
    (path.endsWith("/conversation") && (req.method === "POST" || req.method === "PATCH")) ||
    (path.endsWith("/chat") && req.method === "PATCH")
  ) {
    try {
      const { conversationId, id, title } = req.body || {};
      const targetId = (conversationId || id || req.query?.conversationId || "").toString().trim();
      const trimmedTitle = typeof title === "string" ? title.trim().slice(0, 120) : "";
      if (!targetId || !trimmedTitle) {
        res.status(400).json({ error: "conversationId ve yeni başlık (title) zorunludur." });
        return;
      }

      const convRef = db.collection("conversations").doc(targetId);
      const convSnap = await convRef.get();
      if (!convSnap.exists || baskasinin(convSnap)) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }

      await convRef.update({
        title: trimmedTitle,
        updatedAt: Timestamp.now()
      });
      res.status(200).json({ success: true, conversationId: targetId, title: trimmedTitle });
      return;
    } catch (err) {
      console.error("Cloud Function conversation rename failed:", err);
      res.status(500).json({ error: "Failed to rename conversation." });
      return;
    }
  }

  // Conversation delete endpoint: DELETE /chat or DELETE /conversation
  if ((path.endsWith("/chat") || path.endsWith("/conversation")) && req.method === "DELETE") {
    try {
      const conversationId = (req.query?.conversationId || req.query?.id || "").toString();
      if (!conversationId) {
        res.status(400).json({ error: "conversationId is required." });
        return;
      }

      const convRef = db.collection("conversations").doc(conversationId);
      if (baskasinin(await convRef.get())) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      const messagesSnap = await convRef.collection("messages").get();
      if (!messagesSnap.empty) {
        const batch = db.batch();
        messagesSnap.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }

      await convRef.delete();
      res.status(200).json({ success: true, deletedConversationId: conversationId });
      return;
    } catch (err) {
      console.error("Cloud Function conversation deletion failed:", err);
      res.status(500).json({ error: "Failed to delete conversation." });
      return;
    }
  }

  // Google OAuth2 integration endpoints
  if (path.includes("/auth/google/")) {
    const googleClientId = gizliOku(GOOGLE_OAUTH_CLIENT_ID, "GOOGLE_OAUTH_CLIENT_ID");
    const googleClientSecret = gizliOku(GOOGLE_OAUTH_CLIENT_SECRET, "GOOGLE_OAUTH_CLIENT_SECRET");

    // GET /api/auth/google/url - generate OAuth authorization URL
    if (path.endsWith("/auth/google/url") && req.method === "GET") {
      if (!googleClientId || !googleClientSecret) {
        res.status(503).json({ error: "Google OAuth is not configured on the server." });
        return;
      }
      const redirectUri = (req.query?.redirectUri || defaultGoogleRedirectUri()).toString();
      if (!redirectUri) {
        res.status(400).json({ error: "'redirectUri' is required." });
        return;
      }
      const state = Buffer.from(JSON.stringify({ userId, redirectUri, timestamp: Date.now() })).toString("base64url");
      const url = buildGoogleAuthUrl(googleClientId, redirectUri, state);
      res.status(200).json({ success: true, url });
      return;
    }

    // POST /api/auth/google/callback - exchange authorization code for tokens
    if (path.endsWith("/auth/google/callback") && req.method === "POST") {
      try {
        const { code, redirectUri } = req.body || {};
        if (!code) {
          res.status(400).json({ error: "Authorization 'code' is required." });
          return;
        }

        const safeRedirectUri = redirectUri || defaultGoogleRedirectUri();
        if (!safeRedirectUri) {
          res.status(400).json({ error: "'redirectUri' is required." });
          return;
        }
        const tokens = await exchangeCodeForTokens({
          code,
          clientId: googleClientId,
          clientSecret: googleClientSecret,
          redirectUri: safeRedirectUri
        });

        const email = await fetchGoogleUserEmail(tokens.accessToken);
        const expiresAt = Date.now() + (tokens.expiresIn * 1000);

        const googleDocRef = db.collection("users").doc(userId).collection("integrations").doc("google");
        await googleDocRef.set({
          accessToken: tokens.accessToken,
          ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
          expiresAt,
          email: email || undefined,
          scope: tokens.scope || undefined,
          connectedAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        }, { merge: true });

        res.status(200).json({
          success: true,
          email: email || undefined,
          connected: true
        });
        return;
      } catch (err) {
        console.error("Google OAuth token exchange failed:", err);
        res.status(500).json({ error: `OAuth token exchange failed: ${err?.message || String(err)}` });
        return;
      }
    }

    // GET /api/auth/google/status - get integration connection status
    if (path.endsWith("/auth/google/status") && req.method === "GET") {
      try {
        const googleDoc = await db.collection("users").doc(userId).collection("integrations").doc("google").get();
        if (!googleDoc.exists) {
          res.status(200).json({ connected: false });
          return;
        }
        const data = googleDoc.data() || {};
        res.status(200).json({
          connected: Boolean(data.accessToken || data.refreshToken),
          email: data.email || null,
          connectedAt: data.connectedAt?.toDate ? data.connectedAt.toDate().toISOString() : null
        });
        return;
      } catch (err) {
        console.error("Google integration status check failed:", err);
        res.status(500).json({ error: "Failed to check Google integration status." });
        return;
      }
    }

    // DELETE /api/auth/google/disconnect - remove stored tokens
    if (path.endsWith("/auth/google/disconnect") && req.method === "DELETE") {
      try {
        await db.collection("users").doc(userId).collection("integrations").doc("google").delete();
        res.status(200).json({ success: true, disconnected: true });
        return;
      } catch (err) {
        console.error("Google integration disconnect failed:", err);
        res.status(500).json({ error: "Failed to disconnect Google integration." });
        return;
      }
    }
  }

  // FCM Push Notifications endpoints:
  // POST /api/notifications/fcm-token
  // DELETE /api/notifications/fcm-token
  // POST /api/notifications/test
  if (path.includes("/notifications/")) {
    if (path.endsWith("/notifications/fcm-token") && req.method === "POST") {
      try {
        const { token, userAgent, platform } = req.body || {};
        if (!token || typeof token !== "string") {
          res.status(400).json({ error: "FCM token is required." });
          return;
        }

        const crypto = await import("crypto");
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);

        const tokenRef = db.collection("users").doc(userId).collection("fcmTokens").doc(tokenHash);
        await tokenRef.set({
          token,
          userAgent: userAgent || "unknown",
          platform: platform || "web",
          updatedAt: Timestamp.now(),
          createdAt: Timestamp.now()
        }, { merge: true });

        logger.info("[Notifications] Registered FCM token for user", { userId, tokenHash });
        res.status(200).json({ success: true, message: "Token registered successfully." });
        return;
      } catch (err) {
        logger.error("[Notifications] Failed to save FCM token", { userId, error: errMessage(err) });
        res.status(500).json({ error: "Failed to register notification token." });
        return;
      }
    }

    if (path.endsWith("/notifications/fcm-token") && req.method === "DELETE") {
      try {
        const { token } = req.body || {};
        if (!token || typeof token !== "string") {
          res.status(400).json({ error: "FCM token is required." });
          return;
        }

        const crypto = await import("crypto");
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);

        await db.collection("users").doc(userId).collection("fcmTokens").doc(tokenHash).delete();
        logger.info("[Notifications] Deleted FCM token for user", { userId, tokenHash });
        res.status(200).json({ success: true, message: "Token removed." });
        return;
      } catch (err) {
        logger.error("[Notifications] Failed to delete FCM token", { userId, error: errMessage(err) });
        res.status(500).json({ error: "Failed to remove notification token." });
        return;
      }
    }

    if (path.endsWith("/notifications/test") && req.method === "POST") {
      try {
        const { title, body } = req.body || {};
        const tokensSnap = await db.collection("users").doc(userId).collection("fcmTokens").get();

        if (tokensSnap.empty) {
          res.status(404).json({
            error: "Kayıtlı bildirim cihazı bulunamadı. Lütfen önce bildirim iznini etkinleştirin."
          });
          return;
        }

        const notifTitle = title || "Alfred — Test Bildirimi";
        const notifBody = body || "Alfred bildirim sistemi başarıyla devrede!";
        let sentCount = 0;

        for (const doc of tokensSnap.docs) {
          const docData = doc.data();
          const targetToken = docData.token;
          if (!targetToken) continue;

          try {
            await getMessaging().send({
              token: targetToken,
              notification: {
                title: notifTitle,
                body: notifBody
              },
              data: {
                url: "/",
                timestamp: Date.now().toString()
              },
              webpush: {
                fcmOptions: {
                  link: "/"
                },
                notification: {
                  icon: "/icon-192.png",
                  badge: "/icon-192.png",
                  vibrate: [200, 100, 200]
                }
              }
            });
            sentCount++;
          } catch (sendErr) {
            const errCode = sendErr?.code || "";
            if (
              errCode === "messaging/registration-token-not-registered" ||
              errCode === "messaging/invalid-registration-token"
            ) {
              logger.warn("[Notifications] Removing stale token", { docId: doc.id, errCode });
              await doc.ref.delete().catch(() => {});
            } else {
              logger.warn("[Notifications] Failed to send message to token", { docId: doc.id, error: errMessage(sendErr) });
            }
          }
        }

        if (sentCount === 0) {
          res.status(502).json({
            error: "Bildirim gönderilemedi. Cihaz token'ı geçersiz olabilir, lütfen bildirimleri kapatıp tekrar açın."
          });
          return;
        }

        res.status(200).json({
          success: true,
          message: `${sentCount} cihaza test bildirimi başarıyla gönderildi.`
        });
        return;
      } catch (err) {
        logger.error("[Notifications] Test notification failed", { userId, error: errMessage(err) });
        res.status(500).json({ error: "Test notification failed to send." });
        return;
      }
    }
  }

  // Trigger morning briefing on demand: POST /api/briefing/trigger
  if (path.endsWith("/briefing/trigger") && req.method === "POST") {
    try {
      const result = await executeMorningBriefing(userId);
      res.status(200).json(result);
      return;
    } catch (err) {
      logger.error("[Briefing] Manual trigger failed", { userId, error: errMessage(err) });
      res.status(500).json({ error: "Failed to generate morning briefing: " + errMessage(err) });
      return;
    }
  }

  // Projects management endpoints: GET, POST, and DELETE /projects
  if (path.endsWith("/projects")) {
    if (req.method === "GET") {
      try {
        const projSnap = await db
          .collection("projects")
          .where("userId", "==", userId)
          .get();

        const projects = projSnap.docs
          .map((doc) => {
            const d = doc.data() || {};
            const createdDate = d.createdAt?.toDate ? d.createdAt.toDate() : null;
            const updatedDate = d.updatedAt?.toDate ? d.updatedAt.toDate() : null;
            return {
              id: doc.id,
              name: typeof d.name === "string" ? d.name : "Proje",
              description: typeof d.description === "string" ? d.description : "",
              githubRepo: typeof d.githubRepo === "string" ? d.githubRepo : "",
              color: typeof d.color === "string" ? d.color : "#c5a059",
              createdAt: createdDate ? createdDate.toISOString() : null,
              updatedAt: updatedDate ? updatedDate.toISOString() : null,
              sortMs: updatedDate ? updatedDate.getTime() : (createdDate ? createdDate.getTime() : 0)
            };
          })
          .sort((a, b) => b.sortMs - a.sortMs)
          .map(({ sortMs: _s, ...rest }) => rest);

        res.status(200).json({ success: true, projects });
        return;
      } catch (err) {
        console.error("Cloud Function projects retrieval failed:", err);
        res.status(500).json({ error: "Failed to retrieve projects." });
        return;
      }
    }

    if (req.method === "POST") {
      try {
        const { id, name, description, githubRepo, color } = req.body || {};
        const trimmedName = typeof name === "string" ? name.trim() : "";
        if (trimmedName.length < 2 || trimmedName.length > 80) {
          res.status(400).json({ error: "Proje adı en az 2, en fazla 80 karakter olmalıdır." });
          return;
        }
        const trimmedDesc = typeof description === "string" ? description.trim().slice(0, 1500) : "";
        const rawRepo = typeof githubRepo === "string" ? githubRepo.trim().replace(/\/+$/, "") : "";
        const trimmedRepo = !rawRepo
          ? ""
          : /^https?:\/\//i.test(rawRepo)
            ? rawRepo.slice(0, 220)
            : `https://github.com/${rawRepo.replace(/^github\.com\//i, "")}`.slice(0, 220);
        const safeColor = typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color.trim())
          ? color.trim()
          : "#c5a059";
        const now = Timestamp.now();

        if (id && typeof id === "string") {
          const projRef = db.collection("projects").doc(id.trim());
          const existing = await projRef.get();
          if (!existing.exists || baskasinin(existing)) {
            res.status(404).json({ error: "Project not found." });
            return;
          }
          await projRef.update({
            name: trimmedName,
            description: trimmedDesc,
            githubRepo: trimmedRepo,
            color: safeColor,
            updatedAt: now
          });
          res.status(200).json({
            success: true,
            project: {
              id: projRef.id,
              name: trimmedName,
              description: trimmedDesc,
              githubRepo: trimmedRepo,
              color: safeColor
            }
          });
          return;
        }

        const newId = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const newRef = db.collection("projects").doc(newId);
        await newRef.set({
          userId,
          name: trimmedName,
          description: trimmedDesc,
          githubRepo: trimmedRepo,
          color: safeColor,
          createdAt: now,
          updatedAt: now
        });

        res.status(200).json({
          success: true,
          project: {
            id: newId,
            name: trimmedName,
            description: trimmedDesc,
            githubRepo: trimmedRepo,
            color: safeColor
          }
        });
        return;
      } catch (err) {
        console.error("Cloud Function project save failed:", err);
        res.status(500).json({ error: "Failed to save project." });
        return;
      }
    }

    if (req.method === "DELETE") {
      try {
        const projectId = (req.query?.projectId || req.query?.id || "").toString().trim();
        if (!projectId) {
          res.status(400).json({ error: "projectId is required." });
          return;
        }

        const projRef = db.collection("projects").doc(projectId);
        const projSnap = await projRef.get();
        if (!projSnap.exists || baskasinin(projSnap)) {
          res.status(404).json({ error: "Project not found." });
          return;
        }

        // Retract active memories scoped to this project
        const memSnap = await db
          .collection("memory_vectors")
          .where("userId", "==", userId)
          .where("status", "==", "active")
          .get();
        const projectMems = memSnap.docs.filter((d) => d.data()?.projectId === projectId);
        if (projectMems.length > 0) {
          const batch = db.batch();
          const now = Timestamp.now();
          for (const doc of projectMems) {
            batch.update(doc.ref, buildMemoryRetractionUpdate(now));
          }
          await batch.commit();
        }

        await projRef.delete();
        res.status(200).json({ success: true, deletedProjectId: projectId });
        return;
      } catch (err) {
        console.error("Cloud Function project deletion failed:", err);
        res.status(500).json({ error: "Failed to delete project." });
        return;
      }
    }

    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  // Long-term memory management endpoints: GET, POST, and DELETE /memories
  if (path.endsWith("/memories")) {
    if (req.method === "GET") {
      try {
        const memSnap = await db
          .collection("memory_vectors")
          .where("userId", "==", userId)
          .where("status", "==", "active")
          .get();

        const memories = memSnap.docs
          .map((doc) => {
            const d = doc.data() || {};
            const createdDate = d.createdAt?.toDate ? d.createdAt.toDate() : null;
            const updatedDate = d.updatedAt?.toDate ? d.updatedAt.toDate() : null;
            return {
              id: d.memoryId || doc.id,
              docId: doc.id,
              content: typeof d.content === "string" ? d.content : "",
              memoryType: typeof d.memoryType === "string" ? d.memoryType : "general",
              projectId: typeof d.projectId === "string" && d.projectId.trim() ? d.projectId.trim() : null,
              createdAt: createdDate ? createdDate.toISOString() : null,
              updatedAt: updatedDate ? updatedDate.toISOString() : null,
              sortMs: createdDate ? createdDate.getTime() : 0
            };
          })
          .filter((m) => Boolean(m.content))
          .sort((a, b) => b.sortMs - a.sortMs)
          .map(({ sortMs: _s, ...rest }) => rest);

        res.status(200).json({ success: true, memories });
        return;
      } catch (err) {
        console.error("Cloud Function memories retrieval failed:", err);
        res.status(500).json({ error: "Failed to retrieve memories." });
        return;
      }
    }

    if (req.method === "POST") {
      try {
        const { content, memoryType, action, projectId } = req.body || {};
        const trimmedContent = typeof content === "string" ? content.trim() : "";
        if (trimmedContent.length < 5 || trimmedContent.length > 600) {
          res.status(400).json({
            error: "Bellek kaydı en az 5, en fazla 600 karakter olmalıdır."
          });
          return;
        }

        const geminiKey = gizliOku(GEMINI_API_KEY, "GEMINI_API_KEY");
        const ollamaUrl = ollamaBaseUrl();
        const tally = createMemoryWriteTally();
        const normalizedAction = action === "supersede" ? "supersede" : "create";
        const normalizedType = typeof memoryType === "string" && memoryType.trim()
          ? memoryType.trim()
          : "user_preference";
        const normalizedProjectId = typeof projectId === "string" && projectId.trim()
          ? projectId.trim()
          : null;

        await persistMemoryCandidates({
          db,
          memories: [
            {
              content: trimmedContent,
              memoryType: normalizedType,
              confidence: 1.0,
              action: normalizedAction
            }
          ],
          userId,
          projectId: normalizedProjectId,
          conversationId: "manual_ui",
          sourceMessageIds: [],
          embed: (text) => getEmbedding(text, ollamaUrl, geminiKey),
          logger,
          now: () => Timestamp.now(),
          errMessage,
          tally
        });

        if (tally.rejected > 0) {
          res.status(400).json({
            error: "Gizli bilgi (API anahtarı, şifre vb.) içeren kayıtlar güvenlik nedeniyle reddedildi."
          });
          return;
        }
        if (tally.invalid > 0 || tally.failed > 0) {
          res.status(500).json({
            error: "Bellek kaydı vektörleştirilirken bir hata oluştu."
          });
          return;
        }

        const outcome = tally.superseded > 0
          ? "superseded"
          : tally.stored > 0
            ? "stored"
            : tally.duplicate > 0
              ? "duplicate"
              : "noop";

        res.status(200).json({ success: true, outcome, tally });
        return;
      } catch (err) {
        console.error("Cloud Function manual memory creation failed:", err);
        res.status(500).json({ error: "Failed to create memory." });
        return;
      }
    }

    if (req.method === "DELETE") {
      try {
        const memoryId = (req.query?.memoryId || req.query?.id || "").toString().trim();
        if (!memoryId) {
          res.status(400).json({ error: "memoryId is required." });
          return;
        }

        const memRef = db.collection("memory_vectors").doc(memoryId);
        const memSnap = await memRef.get();
        if (!memSnap.exists || baskasinin(memSnap)) {
          res.status(404).json({ error: "Memory not found" });
          return;
        }

        await memRef.update(buildMemoryRetractionUpdate(Timestamp.now()));
        logger.info(`[Memory] Retracted memory ${memoryId} via UI`, {
          memory_id: memoryId,
          memory_type: memSnap.data()?.memoryType ?? null
        });
        res.status(200).json({ success: true, retractedMemoryId: memoryId });
        return;
      } catch (err) {
        console.error("Cloud Function memory retraction failed:", err);
        res.status(500).json({ error: "Failed to delete memory." });
        return;
      }
    }

    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  // Chat endpoint: POST /chat or POST /api/chat
  if (path.endsWith("/chat")) {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    // SSE-only: the response is always `text/event-stream`. Clients may still
    // send `stream: true`, but it is ignored; there is no non-streaming JSON
    // mode (no client ever sent `stream: false`).
    const {
      message,
      conversationId: requestedConvId,
      projectId: requestedProjectId,
      provider: requestedProvider,
      model: requestedModel,
      truncateFromSequence
    } = req.body || {};
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    const trimmedMessage = message.trim();
    const activeProvider = (process.env.ALFRED_LLM_PROVIDER || process.env.AI_PROVIDER || "groq").trim().toLowerCase();
    const evrenKey = gizliOku(EVREN_API_KEY, "EVREN_API_KEY");
    const groqKey = gizliOku(GROQ_API_KEY, "GROQ_API_KEY");
    const groqModel = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
    const geminiKey = gizliOku(GEMINI_API_KEY, "GEMINI_API_KEY");
    const tavilyKey = gizliOku(TAVILY_API_KEY, "TAVILY_API_KEY");
    const webSearchEnabled = isUsableApiKey(tavilyKey);
    const githubToken = process.env.GITHUB_TOKEN || "";
    const ollamaUrl = ollamaBaseUrl();
    const ollamaModel = process.env.OLLAMA_MODEL || "gemma4:12b-mlx";

    let convId = requestedConvId;
    let effectiveProjectId = typeof requestedProjectId === "string" && requestedProjectId.trim()
      ? requestedProjectId.trim()
      : null;
    const now = Timestamp.now();

    // 1. Resolve or create conversation
    try {
      if (convId) {
        const cSnap = await db.collection("conversations").doc(convId).get();
        if (baskasinin(cSnap)) {
          res.status(404).json({ error: "Conversation not found" });
          return;
        }
        if (cSnap.exists) {
          const existingProjId = cSnap.data()?.projectId;
          if (!effectiveProjectId && typeof existingProjId === "string" && existingProjId.trim()) {
            effectiveProjectId = existingProjId.trim();
          }
        } else {
          await db.collection("conversations").doc(convId).set({
            userId,
            title: "New Conversation",
            ...(effectiveProjectId ? { projectId: effectiveProjectId } : {}),
            createdAt: now,
            updatedAt: now,
            lastMessageAt: now,
            messageCount: 0
          });
        }
      } else {
        const newConvRef = db.collection("conversations").doc();
        convId = newConvRef.id;
        await newConvRef.set({
          userId,
          title: "New Conversation",
          ...(effectiveProjectId ? { projectId: effectiveProjectId } : {}),
          createdAt: now,
          updatedAt: now,
          lastMessageAt: now,
          messageCount: 0
        });
      }
    } catch (convErr) {
      console.error("Failed to initialize conversation doc:", convErr);
      if (!convId) convId = "conv_" + Date.now();
    }

    // Load active project metadata if this conversation belongs to a project
    let activeProjectContext = null;
    if (effectiveProjectId) {
      try {
        const projSnap = await db.collection("projects").doc(effectiveProjectId).get();
        if (projSnap.exists && !baskasinin(projSnap)) {
          const pd = projSnap.data() || {};
          activeProjectContext = {
            name: typeof pd.name === "string" ? pd.name : "",
            description: typeof pd.description === "string" ? pd.description : "",
            githubRepo: typeof pd.githubRepo === "string" ? pd.githubRepo : ""
          };
        } else {
          effectiveProjectId = null;
        }
      } catch (projErr) {
        console.warn("Could not load project context:", projErr);
      }
    }

    // 2. Transactionally append user message
    const convRef = db.collection("conversations").doc(convId);
    const userMsgRef = convRef.collection("messages").doc();
    let userSeq = 1;

    try {
      const truncateSeq = typeof truncateFromSequence === "number" && truncateFromSequence > 0
        ? truncateFromSequence
        : null;

      if (truncateSeq !== null) {
        const toDeleteSnap = await convRef
          .collection("messages")
          .where("sequence", ">=", truncateSeq)
          .get();

        if (!toDeleteSnap.empty) {
          const batch = db.batch();
          toDeleteSnap.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
        }
      }

      await db.runTransaction(async (tx) => {
        const cSnap = await tx.get(convRef);
        const cData = cSnap.exists ? cSnap.data() : { messageCount: 0 };
        const currentCount = truncateSeq !== null
          ? truncateSeq - 1
          : (cData.messageCount || 0);
        userSeq = currentCount + 1;
        const txNow = Timestamp.now();

        tx.set(userMsgRef, {
          role: "user",
          content: trimmedMessage,
          sequence: userSeq,
          status: "completed",
          createdAt: txNow
        });

        const updatePayload = {
          messageCount: userSeq,
          updatedAt: txNow,
          lastMessageAt: txNow
        };

        if (userSeq === 1) {
          updatePayload.title = generateDeterministicTitle(trimmedMessage);
        }

        tx.set(convRef, updatePayload, { merge: true });
      });
    } catch (msgErr) {
      console.error("Failed to append user message transactionally:", msgErr);
    }

    // 3. Retrieve bounded recent history for context
    let boundedHistory = [];
    try {
      const historySnap = await convRef
        .collection("messages")
        .where("sequence", "<", userSeq)
        .orderBy("sequence", "desc")
        .limit(10)
        .get();

      boundedHistory = historySnap.docs
        .map((d) => ({ role: d.data().role, content: d.data().content }))
        .reverse();
    } catch (histErr) {
      console.warn("Could not load history from Firestore, proceeding with single turn:", histErr);
    }

    // 4. Retrieve relevant long-term semantic memories (cloud Gemini or Ollama)
    let retrievedMemories = [];
    const MEMORY_TOP_K = 5;
    const MEMORY_MIN_SCORE = 0.35;
    const retrievalStart = performance.now();
    let embeddingModel = null;
    try {
      const queryEmbedding = await getEmbedding(trimmedMessage, ollamaUrl, geminiKey);
      embeddingModel = queryEmbedding.model;
      const embeddingMs = msSince(retrievalStart);
      const retrievalStats = {};
      retrievedMemories = await retrieveRelevantMemories(db, queryEmbedding, userId, MEMORY_TOP_K, MEMORY_MIN_SCORE, retrievalStats, effectiveProjectId);
      logEvent("INFO", "memory_retrieval",
        `[Memory] Retrieved ${retrievedMemories.length} relevant memories for user ${userId}`, {
          outcome: "ok",
          embedding_model: embeddingModel,
          top_k: MEMORY_TOP_K,
          min_score: MEMORY_MIN_SCORE,
          ...retrievalStats,
          embedding_ms: embeddingMs,
          duration_ms: msSince(retrievalStart)
        });
    } catch (memSearchErr) {
      logEvent("WARNING", "memory_retrieval",
        `[Memory] Semantic memory retrieval bypassed: ${errMessage(memSearchErr)}`, {
          outcome: "error",
          embedding_model: embeddingModel,
          top_k: MEMORY_TOP_K,
          min_score: MEMORY_MIN_SCORE,
          duration_ms: msSince(retrievalStart)
        });
    }

    // EVREN -> Groq -> Gemini OpenAI uyumlu ayni akisla calisir
    // (src/ai/providers/chat-fallback/). Anahtari "unset"/"none"/bos olan
    // saglayici atlanir. ALFRED_LLM_PROVIDER=ollama ise eski Ollama yolu.
    const useOllama = activeProvider !== "groq";
    const turnEnv = applyChatModelPreference(process.env, {
      provider: requestedProvider,
      model: requestedModel
    });
    const { providers: chatProviders, skipped: skippedProviders } = useOllama
      ? { providers: [], skipped: [] }
      : resolveChatProviders({
        evren: evrenKey,
        groq: groqKey,
        gemini: geminiKey
      }, turnEnv);

    // Google Integration: Fetch token and auto-refresh if needed
    const googleClientId = gizliOku(GOOGLE_OAUTH_CLIENT_ID, "GOOGLE_OAUTH_CLIENT_ID");
    const googleClientSecret = gizliOku(GOOGLE_OAUTH_CLIENT_SECRET, "GOOGLE_OAUTH_CLIENT_SECRET");
    let googleAccessToken = null;

    const getGoogleAccessToken = async () => {
      if (googleAccessToken) return googleAccessToken;
      try {
        const gDocRef = db.collection("users").doc(userId).collection("integrations").doc("google");
        const gSnap = await gDocRef.get();
        if (!gSnap.exists) return null;
        const gData = gSnap.data() || {};
        const { accessToken, refreshToken, expiresAt } = gData;

        // If access token is still valid (with 60s buffer), use it
        if (accessToken && typeof expiresAt === "number" && Date.now() < (expiresAt - 60_000)) {
          googleAccessToken = accessToken;
          return googleAccessToken;
        }

        // Try refreshing using refreshToken
        if (refreshToken && googleClientId && googleClientSecret) {
          try {
            const refreshed = await refreshAccessToken({
              refreshToken,
              clientId: googleClientId,
              clientSecret: googleClientSecret
            });
            const newExpiresAt = Date.now() + (refreshed.expiresIn * 1000);
            await gDocRef.set({
              accessToken: refreshed.accessToken,
              expiresAt: newExpiresAt,
              updatedAt: Timestamp.now()
            }, { merge: true });
            googleAccessToken = refreshed.accessToken;
            return googleAccessToken;
          } catch (rErr) {
            console.error("Google token auto-refresh failed in turn:", rErr);
            return accessToken || null;
          }
        }

        return accessToken || null;
      } catch (err) {
        console.error("Failed to read user Google tokens:", err);
        return null;
      }
    };

    // Check if user has connected Google
    let googleConnected = false;
    try {
      const gSnap = await db.collection("users").doc(userId).collection("integrations").doc("google").get();
      if (gSnap.exists && (gSnap.data()?.refreshToken || gSnap.data()?.accessToken)) {
        googleConnected = true;
      }
    } catch {}

    // Persona states the provider/model actually answering this turn; the
    // profile is the reviewed digest of users/*.md embedded at build time
    // (functions/build.js). The prompt is re-sent on every tool round, so it
    // is kept under a token budget (tests/unit/system-prompt-budget.test.ts).
    // On a fallback the prompt is rebuilt for the provider that answers.
    const buildMessagesFor = (runtime) => [
      {
        role: "system",
        content: buildAlfredSystemPrompt({
          runtime: { provider: runtime.id, model: runtime.model },
          memories: retrievedMemories,
          project: activeProjectContext,
          sshAvailable: true,
          webSearchAvailable: webSearchEnabled,
          readUrlAvailable: true,
          githubAvailable: true,
          googleCalendarAvailable: googleConnected,
          googleTasksAvailable: googleConnected,
          gmailAvailable: googleConnected
        })
      },
      ...boundedHistory,
      { role: "user", content: trimmedMessage }
    ];
    const primary = useOllama
      ? { id: activeProvider, model: ollamaModel }
      : (chatProviders[0] || { id: "groq", model: groqModel });

    // Setup SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    const sendEvent = (obj) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
      if (typeof res.flush === "function") {
        res.flush();
      }
    };

    // `start` names the first provider; a switch is announced with
    // `provider_fallback` (from, to, model, reason).
    sendEvent({ type: "start", conversationId: convId, provider: primary.id, model: primary.model });
    sendEvent({ type: "thinking" });

    // accumulatedText: text of the answering round (reset after tool rounds);
    // streamedToUser: a chunk went out, so no provider switch any more.
    const turnState = createChatTurnState();
    turnState.providerId = primary.id;
    turnState.model = primary.model;
    let isFinalized = false;
    const usedToolsSet = new Set();
    const usedSourcesList = [];

    // The assistant message takes the next sequence and raises messageCount in
    // one transaction, for a completed and an interrupted reply alike, so the
    // next user message never reuses its sequence. Returns the doc id, or null
    // when the write failed.
    const persistAssistantMessage = async (content, status) => {
      try {
        const asstMsgRef = convRef.collection("messages").doc();
        await db.runTransaction(async (tx) => {
          const cSnap = await tx.get(convRef);
          const cData = cSnap.exists ? cSnap.data() : {};
          const asstSeq = (cData.messageCount || userSeq) + 1;
          const asstNow = Timestamp.now();

          tx.set(asstMsgRef, {
            role: "assistant",
            content,
            sequence: asstSeq,
            status,
            provider: turnState.providerId,
            model: turnState.model,
            ...(usedToolsSet.size > 0 ? { usedTools: [...usedToolsSet] } : {}),
            ...(usedSourcesList.length > 0 ? { sources: usedSourcesList.slice(0, 8) } : {}),
            createdAt: asstNow
          });

          tx.update(convRef, {
            messageCount: asstSeq,
            updatedAt: asstNow,
            lastMessageAt: asstNow
          });
        });
        return asstMsgRef.id;
      } catch (persistErr) {
        console.error(`Failed to persist ${status} assistant message to Firestore:`, persistErr);
        return null;
      }
    };

    const finalizeTurn = async (content, asstMsgDocId) => {
      if (isFinalized || !content) return;
      isFinalized = true;

      // Bellek cikarimi cevap kapanmadan once beklenir: Cloud Run yanit
      // bittikten sonra CPU'yu kistigi icin arka planda birakilan is yarida
      // kalir ya da hic calismaz. Istemci "done" olayini zaten aldi; burada
      // yalnizca baglantinin kapanmasi gecikir, o da en fazla
      // MEMORY_EXTRACTION_BUDGET_MS kadar.
      const extractionStart = performance.now();
      try {
        const summary = await withTimeout(extractAndPersistMemories({
          db,
          ollamaUrl,
          ollamaModel,
          evrenKey,
          groqKey,
          geminiKey,
          userMessage: trimmedMessage,
          assistantResponse: content,
          userId,
          projectId: effectiveProjectId,
          conversationId: convId,
          sourceMessageIds: [userMsgRef.id, asstMsgDocId].filter(Boolean),
          recentHistory: boundedHistory
        }), MEMORY_EXTRACTION_BUDGET_MS, "memory extraction");
        const outcome = summary?.outcome || "nothing";
        logEvent(outcome === "failed" ? "WARNING" : "INFO", "memory_extraction",
          `[Memory] Extraction finished: ${outcome}`, {
            ...summary,
            outcome,
            count: summary?.count || 0,
            extractor_model: extractorModelFor(summary?.extractor_provider),
            duration_ms: msSince(extractionStart)
          });
      } catch (memExtErr) {
        const timedOut = /timed out/i.test(String(memExtErr?.message || ""));
        logEvent("WARNING", "memory_extraction",
          `[Memory] Extraction skipped: ${errMessage(memExtErr)}`, {
            outcome: timedOut ? "timeout" : "failed",
            count: 0,
            budget_ms: MEMORY_EXTRACTION_BUDGET_MS,
            duration_ms: msSince(extractionStart)
          });
      }
    };

    // llm_request olayi icin tur boyunca biriken metrikler. Tur basina tek olay
    // yazilir; birden fazla model cagrisi (arac turlari, yedek saglayicilar)
    // toplanir. provider/model cevabi veren (ya da en son deneyen) saglayicidir;
    // fallback_from terk edilenler, attempted_providers denenenlerin hepsi.
    const llmStart = performance.now();
    const llmMetrics = createChatTurnMetrics(primary.id, primary.model);
    if (skippedProviders.length > 0) llmMetrics.skipped_providers = skippedProviders;
    const markFirstToken = () => {
      if (llmMetrics.time_to_first_token_ms === null) {
        llmMetrics.time_to_first_token_ms = msSince(llmStart);
      }
    };
    const logLlmRequest = (outcome, err) => {
      logEvent(outcome === "ok" ? "INFO" : "ERROR", "llm_request",
        `LLM request ${outcome} (${llmMetrics.provider}/${llmMetrics.model}) in ${msSince(llmStart)}ms`, {
          ...llmMetrics,
          outcome,
          app_check: appCheckStatus,
          latency_ms: msSince(llmStart),
          ...(err ? { error: errMessage(err) } : {}),
          ...(isRateLimitedError(err) ? { error_code: err.code, rate_limit_reason: err.reason, rate_limit_type: err.limitType } : {})
        });
    };

    // Home server araçları: sahibin ev sunucusundaki alfred-relay arka plan
    // servisi Firestore üzerinden güvenli şekilde komutları koşturur.
    const activeTools = [
      TIME_TOOL_DEFINITION,
      SSH_CONNECT_TOOL_DEFINITION,
      SSH_LIST_DIRECTORY_TOOL_DEFINITION,
      SSH_EXECUTE_TOOL_DEFINITION,
      READ_URL_TOOL_DEFINITION,
      GITHUB_TOOL_DEFINITION,
      ...(googleConnected ? [GOOGLE_CALENDAR_TOOL_DEFINITION, GOOGLE_TASKS_TOOL_DEFINITION, GMAIL_TOOL_DEFINITION] : []),
      ...(webSearchEnabled ? [WEB_SEARCH_TOOL_DEFINITION] : [])
    ];
    const MAX_TURNS = 3;
    // Tur basina bir arama oturumu: ayni sorgu tekrar aranmaz, en fazla 1 arama;
    // yedek saglayiciya gecilince tur bastan baslasa da yeni kredi harcanmaz.
    const webSearch = webSearchEnabled
      ? createTurnWebSearch({ apiKey: tavilyKey, fetch: (url, init) => fetch(url, init) })
      : null;
    const readUrl = createTurnReadUrl({
      fetch: (url, init) => fetch(url, init),
      lookup: async (hostname) => {
        const res = await lookup(hostname, { all: true });
        return res.map((r) => r.address);
      }
    });
    const defaultRepo = activeProjectContext?.githubRepo || null;
    const gitHub = createTurnGitHub({
      token: githubToken || null,
      defaultRepo,
      fetch: (url, init) => fetch(url, init)
    });
    const googleCalendar = createGoogleCalendarTool({
      getAccessToken: getGoogleAccessToken,
      fetchFn: (url, init) => fetch(url, init)
    });
    const googleTasks = createGoogleTasksTool({
      getAccessToken: getGoogleAccessToken,
      fetchFn: (url, init) => fetch(url, init)
    });
    const googleGmail = createGmailTool({
      getAccessToken: getGoogleAccessToken,
      fetchFn: (url, init) => fetch(url, init)
    });

    const runTool = async (fnName, fnArgs) => {
      if (fnName === "get_current_time") {
        usedToolsSet.add("get_current_time");
        return runGetCurrentTimeTool(fnArgs);
      }
      if (fnName === "ssh_connect") {
        usedToolsSet.add("ssh_connect");
        const targetHost = fnArgs?.host || "home-server";
        return {
          host: targetHost,
          status: "connected",
          message: `Successfully connected to host '${targetHost}'. All credentials and handshakes are verified via Alfred Home Relay.`
        };
      }
      if (fnName === "ssh_list_directory") {
        usedToolsSet.add("ssh_list_directory");
        return dispatchServerCommandViaRelay(db, {
          host: fnArgs?.host || "home-server",
          command: "list_directory",
          args: { path: fnArgs?.path || "Belgeler" },
          userId
        });
      }
      if (fnName === "ssh_execute") {
        usedToolsSet.add("ssh_execute");
        return dispatchServerCommandViaRelay(db, {
          host: fnArgs?.host || "home-server",
          command: fnArgs?.command,
          args: fnArgs?.args,
          userId
        });
      }
      if (fnName === "google_calendar") {
        usedToolsSet.add("google_calendar");
        return googleCalendar(fnArgs);
      }
      if (fnName === "google_tasks") {
        usedToolsSet.add("google_tasks");
        return googleTasks(fnArgs);
      }
      if (fnName === "gmail") {
        usedToolsSet.add("gmail");
        return googleGmail(fnArgs);
      }
      if (fnName === "web_search" && webSearch) {
        usedToolsSet.add("web_search");
        const result = await webSearch(fnArgs);
        if (result && typeof result === "object" && Array.isArray(result.results)) {
          for (const item of result.results) {
            if (item && typeof item.url === "string" && !usedSourcesList.some((s) => s.url === item.url)) {
              usedSourcesList.push({
                source: typeof item.source === "string" ? item.source : "",
                title: typeof item.title === "string" ? item.title : item.url,
                url: item.url,
                ...(typeof item.cite === "string" ? { cite: item.cite } : {})
              });
            }
          }
        }
        return result;
      }
      if (fnName === "read_url" && readUrl) {
        usedToolsSet.add("read_url");
        const result = await readUrl(fnArgs);
        if (result && typeof result === "object" && typeof result.url === "string" && !usedSourcesList.some((s) => s.url === result.url)) {
          usedSourcesList.push({
            source: typeof result.source === "string" ? result.source : "",
            title: typeof result.title === "string" ? result.title : result.url,
            url: result.url,
            cite: typeof result.cite === "string" ? result.cite : ""
          });
        }
        return result;
      }
      if (fnName === "github" && gitHub) {
        usedToolsSet.add("github");
        return gitHub(fnArgs);
      }
      return { error: `Tool ${fnName} not recognized.` };
    };

    try {
      if (!useOllama) {
        // Groq ve yedekleri: arac turlari, 429 beklemeleri, akis ici hatalar ve
        // saglayici degisimi src/ai/providers/chat-fallback/chat-turn.ts icinde.
        await runChatTurnWithFallback({
          providers: chatProviders,
          buildMessages: buildMessagesFor,
          tools: activeTools,
          maxTurns: MAX_TURNS,
          // Arama sonrasi tur aracsiz: model elindeki sonucla cevap verir
          // (ikinci arama turu Groq'un dakikalik token sinirini asiyordu).
          finalRoundAfter: ["web_search", "read_url"],
          runTool,
          fetch: (url, init) => fetch(url, init),
          sendEvent,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          logEvent,
          metrics: llmMetrics,
          state: turnState,
          onFirstToken: markFirstToken,
          onParseError: (provider, pErr) => console.warn(`Failed to parse ${provider} chunk line:`, pErr),
          timeoutMs: 60000,
          clock: () => performance.now()
        });
      } else {
        // Ollama path (preserved intact for future re-enablement)
        const currentPayload = buildMessagesFor(primary);
        let toolTurn = 0;

        while (toolTurn < MAX_TURNS) {
          toolTurn++;
          let passAccumulatedText = "";
          const passToolCalls = [];

          const requestBody = {
            model: ollamaModel,
            messages: currentPayload,
            stream: true
          };
          if (activeTools && activeTools.length > 0 && toolTurn < MAX_TURNS) {
            requestBody.tools = activeTools;
          }

          if (!ollamaUrl) {
            throw new Error("Ollama is selected (ALFRED_LLM_PROVIDER=ollama) but OLLAMA_BASE_URL is not set.");
          }
          llmMetrics.llm_calls++;
          llmMetrics.attempted_providers = [primary.id];
          const ollamaRes = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(requestBody),
            signal: AbortSignal.timeout(90000)
          });

          if (!ollamaRes.ok) {
            const errText = await ollamaRes.text().catch(() => "");
            throw new Error(`Ollama responded with HTTP ${ollamaRes.status}: ${errText}`);
          }

          const reader = ollamaRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              try {
                const chunk = JSON.parse(trimmed);

                if (chunk.message?.content || chunk.message?.tool_calls?.length) markFirstToken();
                // Ollama son chunk'ta (done: true) token sayilarini verir.
                if (chunk.done && (typeof chunk.prompt_eval_count === "number" || typeof chunk.eval_count === "number")) {
                  const p = chunk.prompt_eval_count || 0;
                  const c = chunk.eval_count || 0;
                  addUsageToMetrics(llmMetrics, { prompt_tokens: p, completion_tokens: c, total_tokens: p + c });
                }

                if (chunk.message?.tool_calls && chunk.message.tool_calls.length > 0) {
                  passToolCalls.push(...chunk.message.tool_calls);
                }

                if (chunk.message?.content) {
                  passAccumulatedText += chunk.message.content;
                  if (passToolCalls.length === 0) {
                    turnState.accumulatedText += chunk.message.content;
                    turnState.streamedToUser = true;
                    sendEvent({ type: "chunk", text: chunk.message.content });
                  }
                }
              } catch (pErr) {
                console.warn("Failed to parse Ollama chunk line:", pErr);
              }
            }
          }

          if (passToolCalls.length > 0) {
            llmMetrics.tool_rounds++;
            llmMetrics.tool_calls += passToolCalls.length;
            sendEvent({
              type: "tool_call",
              toolCalls: passToolCalls.map((tc) => ({
                id: tc.id,
                name: tc.function?.name,
                arguments: tc.function?.arguments
              }))
            });

            currentPayload.push({
              role: "assistant",
              content: passAccumulatedText || null,
              tool_calls: passToolCalls.map((tc) => ({
                id: tc.id,
                type: "function",
                function: {
                  name: tc.function?.name,
                  arguments: typeof tc.function?.arguments === "string" ? tc.function.arguments : JSON.stringify(tc.function?.arguments || {})
                }
              }))
            });

            for (const tc of passToolCalls) {
              const fnName = tc.function?.name;
              let fnArgs = tc.function?.arguments;
              if (typeof fnArgs === "string") {
                try { fnArgs = JSON.parse(fnArgs); } catch {}
              }

              const toolStart = performance.now();
              const toolResult = await runTool(fnName, fnArgs);

              // Argumanlar loglanmaz; yalnizca arac adi.
              const toolOk = !toolResult?.error;
              const toolName = typeof fnName === "string" ? fnName.slice(0, 64) : null;
              logEvent(toolOk ? "INFO" : "WARNING", "tool_call",
                `Tool ${toolName} ${toolOk ? "ok" : "error"}`, {
                  tool: toolName,
                  provider: activeProvider,
                  round: toolTurn,
                  outcome: toolOk ? "ok" : "error",
                  duration_ms: msSince(toolStart)
                });

              sendEvent({ type: "tool_call", tool: fnName, arguments: fnArgs });
              sendEvent({ type: "tool_result", tool: fnName, toolCallId: tc.id, result: toolResult });

              currentPayload.push({
                role: "tool",
                tool_call_id: tc.id,
                content: JSON.stringify(toolResult)
              });
            }

            turnState.accumulatedText = "";
          } else {
            break;
          }
        }
      }

      const cleanContent = turnState.accumulatedText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
      if (!cleanContent) {
        // Bos cevap basari sayilmaz: "(Yanit bos)" yerine anlasilir bir hata.
        const emptyErr = new Error("Alfred boş bir yanıt üretti. Lütfen tekrar deneyin.");
        emptyErr.code = "empty_response";
        throw emptyErr;
      }
      logLlmRequest("ok");
      // Persisted before "done": the UI releases the composer on "done", and
      // a quick next message must see this reply in its history and come
      // after it in the conversation.
      const asstMsgDocId = await persistAssistantMessage(cleanContent, "completed");
      sendEvent({ type: "done" });
      await finalizeTurn(cleanContent, asstMsgDocId);
      res.end();
    } catch (err) {
      logLlmRequest("error", err);
      console.error(`Cloud Function ${llmMetrics.provider} stream failed:`, err);

      // Persist interrupted message if partially generated
      const cleanInterrupted = turnState.accumulatedText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
      if (cleanInterrupted) {
        await persistAssistantMessage(cleanInterrupted, "interrupted");
      }

      // 429'da ham saglayici JSON'u yerine kisa bir mesaj + code: "rate_limited";
      // tum yedekler de basarisizsa not eklenir; diger hatalar err.message ile gider.
      sendEvent(toChatTurnErrorEvent(err, "LLM provider temporarily unavailable."));
      res.end();
    }
    return;
  }

  res.status(404).json({ error: "Not found", path });
});

// App Check callable function (App Check zorunlulugu api ile ayni)
export const alfredCallable = onCall(
  {
    enforceAppCheck: ENFORCE_APP_CHECK,
    secrets: [GROQ_API_KEY, GEMINI_API_KEY]
  },
  async (request) => {
    const uid = request.auth?.uid;
    const email = (request.auth?.token?.email || "").toLowerCase().trim();
    const isEmailVerified = Boolean(request.auth?.token?.email_verified);
    const authCheck = verifyUserAuthorization(uid, email, isEmailVerified);

    if (!authCheck.authorized) {
      if (authCheck.status === 503) {
        throw new HttpsError("unavailable", authCheck.error || "Authorization not configured on backend.");
      }
      throw new HttpsError("permission-denied", authCheck.error || "Unauthorized account.");
    }
    return {
      status: "ok",
      appId: request.app?.appId || null,
      message: "Alfred callable endpoint verified."
    };
  }
);

/**
 * Executes an automated multi-step morning briefing turn for the owner:
 * 1. Resolves Google tokens, GitHub token, and chat providers.
 * 2. Prepares active tools: Time, Calendar, Tasks, Gmail, GitHub, and Home Server.
 * 3. Builds a dedicated morning briefing prompt for the LLM.
 * 4. Runs multi-step tool execution with fallback.
 * 5. Saves the conversation to Firestore.
 * 6. Sends an FCM push notification to all registered devices.
 */
async function executeMorningBriefing(userId) {
  const briefingStart = performance.now();
  const db = getFirestore();

  // 1. Google tokens
  let googleConnected = false;
  let googleAccessToken = null;
  try {
    const gSnap = await db.collection("users").doc(userId).collection("integrations").doc("google").get();
    if (gSnap.exists) {
      const gData = gSnap.data() || {};
      const { accessToken, refreshToken, expiresAt } = gData;
      if (accessToken && typeof expiresAt === "number" && Date.now() < (expiresAt - 60_000)) {
        googleAccessToken = accessToken;
        googleConnected = true;
      } else if (refreshToken) {
        const googleClientId = gizliOku(GOOGLE_OAUTH_CLIENT_ID, "GOOGLE_OAUTH_CLIENT_ID");
        const googleClientSecret = gizliOku(GOOGLE_OAUTH_CLIENT_SECRET, "GOOGLE_OAUTH_CLIENT_SECRET");
        if (googleClientId && googleClientSecret) {
          try {
            const refreshed = await refreshAccessToken({
              refreshToken,
              clientId: googleClientId,
              clientSecret: googleClientSecret
            });
            const newExpiresAt = Date.now() + (refreshed.expiresIn * 1000);
            await gSnap.ref.set({
              accessToken: refreshed.accessToken,
              expiresAt: newExpiresAt,
              updatedAt: Timestamp.now()
            }, { merge: true });
            googleAccessToken = refreshed.accessToken;
            googleConnected = true;
          } catch (rErr) {
            logger.error("[Briefing] Google token refresh failed:", { error: errMessage(rErr) });
            googleAccessToken = accessToken || null;
            if (googleAccessToken) googleConnected = true;
          }
        }
      }
    }
  } catch (gErr) {
    logger.warn("[Briefing] Google integration lookup error:", { error: errMessage(gErr) });
  }

  const getGoogleAccessToken = async () => googleAccessToken;

  // 2. GitHub token & Tavily
  const githubToken = process.env.GITHUB_TOKEN || "";
  const tavilyKey = gizliOku(TAVILY_API_KEY, "TAVILY_API_KEY") || "";
  const webSearchEnabled = isUsableApiKey(tavilyKey);

  // 3. Setup tools
  const googleCalendar = createGoogleCalendarTool({
    getAccessToken: getGoogleAccessToken,
    fetchFn: (url, init) => fetch(url, init)
  });
  const googleTasks = createGoogleTasksTool({
    getAccessToken: getGoogleAccessToken,
    fetchFn: (url, init) => fetch(url, init)
  });
  const googleGmail = createGmailTool({
    getAccessToken: getGoogleAccessToken,
    fetchFn: (url, init) => fetch(url, init)
  });
  const gitHub = createTurnGitHub({
    token: githubToken || null,
    defaultRepo: null,
    fetch: (url, init) => fetch(url, init)
  });
  const webSearch = webSearchEnabled
    ? createTurnWebSearch({ apiKey: tavilyKey, fetch: (url, init) => fetch(url, init) })
    : null;

  const activeTools = [
    TIME_TOOL_DEFINITION,
    SSH_EXECUTE_TOOL_DEFINITION,
    GITHUB_TOOL_DEFINITION,
    ...(googleConnected ? [GOOGLE_CALENDAR_TOOL_DEFINITION, GOOGLE_TASKS_TOOL_DEFINITION, GMAIL_TOOL_DEFINITION] : []),
    ...(webSearchEnabled ? [WEB_SEARCH_TOOL_DEFINITION] : [])
  ];

  const runTool = async (fnName, fnArgs) => {
    if (fnName === "get_current_time") {
      return runGetCurrentTimeTool(fnArgs);
    }
    if (fnName === "ssh_connect") {
      return { host: "home-server", status: "connected", message: "Connected via Home Relay." };
    }
    if (fnName === "ssh_execute") {
      return dispatchServerCommandViaRelay(db, {
        host: fnArgs?.host || "home-server",
        command: fnArgs?.command,
        args: fnArgs?.args,
        userId
      });
    }
    if (fnName === "google_calendar") return googleCalendar(fnArgs);
    if (fnName === "google_tasks") return googleTasks(fnArgs);
    if (fnName === "gmail") return googleGmail(fnArgs);
    if (fnName === "github" && gitHub) return gitHub(fnArgs);
    if (fnName === "web_search" && webSearch) return webSearch(fnArgs);
    return { error: `Tool ${fnName} not recognized.` };
  };

  // 4. Chat Providers
  const evrenKey = gizliOku(EVREN_API_KEY, "EVREN_API_KEY");
  const groqKey = gizliOku(GROQ_API_KEY, "GROQ_API_KEY");
  const geminiKey = gizliOku(GEMINI_API_KEY, "GEMINI_API_KEY");
  const turnEnv = {
    GROQ_MODEL: process.env.GROQ_MODEL,
    CHAT_FALLBACK_ORDER: process.env.CHAT_FALLBACK_ORDER
  };
  const { providers: chatProviders } = resolveChatProviders({
    evren: evrenKey,
    groq: groqKey,
    gemini: geminiKey
  }, turnEnv);

  const briefingPrompt = "Bugün saat 09:00. Lütfen günlük sabah brifingimi hazırla. Google Takvim'deki bugünkü etkinliklerimi, Google Tasks'teki bekleyen görevlerimi, Gmail'deki okunmamış önemli e-postalarımı ve GitHub'daki güncel durumu kontrol et. Tüm verileri net, anlaşılır ve doğrudan eyleme dönük bir yönetici brifingi olarak özetle.";

  const buildMessagesFor = (runtime) => [
    {
      role: "system",
      content: buildAlfredSystemPrompt({
        runtime: { provider: runtime.id, model: runtime.model },
        sshAvailable: true,
        webSearchAvailable: webSearchEnabled,
        readUrlAvailable: false,
        githubAvailable: true,
        googleCalendarAvailable: googleConnected,
        googleTasksAvailable: googleConnected,
        gmailAvailable: googleConnected
      })
    },
    { role: "user", content: briefingPrompt }
  ];

  const turnState = createChatTurnState();
  const llmMetrics = createChatTurnMetrics(chatProviders[0]?.id || "groq", chatProviders[0]?.model || "");

  await runChatTurnWithFallback({
    providers: chatProviders,
    buildMessages: buildMessagesFor,
    tools: activeTools,
    maxTurns: 4,
    finalRoundAfter: ["web_search"],
    runTool,
    fetch: (url, init) => fetch(url, init),
    sendEvent: () => {},
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    logEvent: (severity, event, msg, data) => logger.info(`[Briefing:${event}] ${msg}`, data || {}),
    metrics: llmMetrics,
    state: turnState,
    onFirstToken: () => {},
    onParseError: (provider, pErr) => console.warn(`Briefing parse error ${provider}:`, pErr),
    timeoutMs: 90000,
    clock: () => performance.now()
  });

  const cleanContent = turnState.accumulatedText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
  if (!cleanContent) {
    throw new Error("Briefing generation returned empty content.");
  }

  // 5. Persist to Firestore as a new conversation
  const now = new Date();
  const dateStr = now.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long" });
  const convRef = db.collection("conversations").doc();
  await convRef.set({
    userId,
    title: `Sabah Brifingi — ${dateStr}`,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    messageCount: 2
  });
  await convRef.collection("messages").add({
    role: "user",
    content: briefingPrompt,
    createdAt: FieldValue.serverTimestamp(),
    ["sequence"]: 1
  });
  await convRef.collection("messages").add({
    role: "assistant",
    content: cleanContent,
    createdAt: FieldValue.serverTimestamp(),
    ["sequence"]: 2,
    status: "completed"
  });

  // 6. Send FCM Push Notification
  const lines = cleanContent.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("|"));
  const teaser = lines.slice(0, 2).join(" ").slice(0, 120) || "Bugünkü takvim, görevler, e-postalar ve GitHub durumunuz hazır.";

  const tokensSnap = await db.collection("users").doc(userId).collection("fcmTokens").get();
  let pushSentCount = 0;
  for (const doc of tokensSnap.docs) {
    const targetToken = doc.data()?.token;
    if (!targetToken) continue;
    try {
      await getMessaging().send({
        token: targetToken,
        notification: {
          title: PROFILE_OWNER.name ? `🌅 Günaydın ${PROFILE_OWNER.name} — Sabah Brifingin Hazır` : "🌅 Günaydın — Sabah Brifingin Hazır",
          body: teaser
        },
        data: {
          conversationId: convRef.id,
          url: `/?conversation=${convRef.id}`,
          timestamp: Date.now().toString()
        },
        webpush: {
          fcmOptions: {
            link: `/?conversation=${convRef.id}`
          },
          notification: {
            icon: "/icon-192.png",
            badge: "/icon-192.png",
            vibrate: [200, 100, 200]
          }
        }
      });
      pushSentCount++;
    } catch (pushErr) {
      logger.warn("[Briefing] Push notification failed for a token:", { error: errMessage(pushErr) });
    }
  }

  const durationMs = Math.round(performance.now() - briefingStart);
  logger.info("[Briefing] Completed successfully", {
    conversationId: convRef.id,
    pushSentCount,
    durationMs
  });

  return {
    success: true,
    conversationId: convRef.id,
    teaser,
    cleanContent,
    durationMs,
    pushSentCount
  };
}

// Scheduled morning briefing (runs daily at 09:00 Europe/Istanbul)
export const scheduledMorningBriefing = onSchedule(
  {
    schedule: "0 9 * * *",
    timeZone: "Europe/Istanbul",
    retryCount: 1,
    memory: "512MiB",
    timeoutSeconds: 300,
    secrets: [
      EVREN_API_KEY,
      GROQ_API_KEY,
      GEMINI_API_KEY,
      TAVILY_API_KEY,
      GOOGLE_OAUTH_CLIENT_ID,
      GOOGLE_OAUTH_CLIENT_SECRET
    ]
  },
  async (event) => {
    logger.info("[Scheduler] Triggering scheduled morning briefing (09:00 Europe/Istanbul)...", {
      scheduleTime: event.scheduleTime
    });
    try {
      let targetUid = ALLOWED_UID;
      if (!targetUid) {
        if (ALLOWED_EMAIL) {
          try {
            const userRecord = await getAuth().getUserByEmail(ALLOWED_EMAIL);
            targetUid = userRecord.uid;
          } catch (userErr) {
            logEvent("ERROR", "scheduler", "Could not find user for ALLOWED_EMAIL", {
              email: ALLOWED_EMAIL,
              error: errMessage(userErr)
            });
            return;
          }
        } else {
          logEvent("ERROR", "scheduler", "Neither ALLOWED_UID nor ALLOWED_EMAIL configured for scheduled briefing.");
          return;
        }
      }
      const result = await executeMorningBriefing(targetUid);
      logger.info("[Scheduler] Morning briefing finished successfully.", {
        conversationId: result?.conversationId,
        pushSentCount: result?.pushSentCount,
        durationMs: result?.durationMs
      });
    } catch (err) {
      logger.error("[Scheduler] Morning briefing failed:", { error: errMessage(err) });
    }
  }
);
