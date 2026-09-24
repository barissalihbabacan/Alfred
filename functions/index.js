// src/ altindaki paylasilan TypeScript modulleri; esbuild bunlari
// functions/lib/index.js icine paketler (functions/build.js).
import { cosineSimilarity } from "../src/data/vector/cosine-similarity.js";
import {
  buildMemoryExtractionSystemPrompt,
  buildMemoryExtractionUserPrompt,
  extractJsonPayload,
  getMemoryExtractionCandidates
} from "../src/ai/prompts/memory-extraction.js";
import { generateDeterministicTitle } from "../src/data/firestore/conversation-title.js";
import {
  GET_CURRENT_TIME_TOOL_DEFINITION as TIME_TOOL_DEFINITION,
  getCurrentTimeForCity
} from "../src/ai/tools/time/current-time.js";
import {
  generateEmbedding,
  isComparableEmbedding
} from "../src/ai/embedding/embedding-client.js";
import {
  createMemoryWriteTally,
  summarizeMemoryWriteTally
} from "../src/alfred/cognitive/memory/memory-write-planner.js";
import { persistMemoryCandidates } from "./memory-persistence.js";
import { buildAlfredSystemPrompt } from "../src/ai/prompts/alfred-system-prompt.js";
import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import { defineSecret } from "firebase-functions/params";
import { initializeApp, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAppCheck } from "firebase-admin/app-check";
import * as logger from "firebase-functions/logger";

setGlobalOptions({ maxInstances: 10, timeoutSeconds: 120, memory: "512MiB" });

// Secret Manager'dan cozulur.
//
// Secret'lar bir kez olusturulur:
//
//   firebase functions:secrets:set GROQ_API_KEY
//   firebase functions:secrets:set GEMINI_API_KEY
//
// Emulatorde ayni adlar functions/.secret.local dosyasindan okunur
// (gitignore'da). Anahtar istemciden (istek basligi) hicbir zaman alinmaz.
//
// Secret adlari defineSecret'in kisitlamasi geregi gecerli ortam degiskeni
// adlari olmali (tire kullanilamaz).
const GROQ_API_KEY = defineSecret("GROQ_API_KEY");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

const ALLOWED_UID = process.env.ALLOWED_UID || "test-owner-uid-123456";

// App Check zorunlulugu varsayilan olarak ACIK (24 Eyl: canli trafigin tamami
// "valid" idi). Emulatorde kapali; gerekirse ENFORCE_APP_CHECK=false ile
// kapatilabilir. Durum her llm_request loguna yazilmaya devam eder (app_check).
const ENFORCE_APP_CHECK =
  process.env.ENFORCE_APP_CHECK !== "false" && !process.env.FUNCTIONS_EMULATOR;

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

// `stats` verilirse metrik alanlariyla doldurulur (memory_retrieval olayi icin).
async function retrieveRelevantMemories(db, query, userId, topK = 5, minScore = 0.35, stats = null) {
  const memSnap = await db.collection("memory_vectors")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .get();

  const scored = [];
  let candidateCount = 0;
  let topScore = null;
  for (const doc of memSnap.docs) {
    const d = doc.data();
    if (isComparableEmbedding(d, query.model)) {
      candidateCount++;
      const score = cosineSimilarity(query.values, d.embedding);
      if (topScore === null || score > topScore) topScore = score;
      if (score >= minScore) {
        scored.push({
          memoryId: d.memoryId || doc.id,
          content: d.content,
          memoryType: d.memoryType || "general",
          score
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

const MEMORY_EXTRACTION_BUDGET_MS = 10000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function extractAndPersistMemories({
  db,
  ollamaUrl,
  ollamaModel,
  groqKey,
  groqModel,
  geminiKey,
  userMessage,
  assistantResponse,
  userId,
  conversationId,
  sourceMessageIds,
  recentHistory
}) {
  const userName = "Barış";
  const systemInstructions = buildMemoryExtractionSystemPrompt(userName);

  const userPrompt = buildMemoryExtractionUserPrompt({
    currentMessage: userMessage,
    assistantResponse,
    recentMessages: recentHistory
  });

  let extractionResText = "";
  let extractorProvider = null;
  // Aday basina sonuc sayaclari; memory_extraction olayi icin dondurulur.
  // rejected: gizli bilgi filtresi; invalid: validateMemoryCandidate reddetti.
  const tally = createMemoryWriteTally();
  const summarize = (fallbackOutcome) => summarizeMemoryWriteTally(tally, fallbackOutcome, extractorProvider);

  // 1. Try Groq if key is available
  if (groqKey) {
    try {
      const gRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: groqModel || "openai/gpt-oss-120b",
          messages: [
            { role: "system", content: systemInstructions },
            { role: "user", content: userPrompt }
          ],
          temperature: 0.1,
          response_format: { type: "json_object" }
        }),
        signal: AbortSignal.timeout(20000)
      });
      if (gRes.ok) {
        const gData = await gRes.json();
        extractionResText = gData.choices?.[0]?.message?.content || "";
        if (extractionResText) extractorProvider = "groq";
      } else {
        const errTxt = await gRes.text().catch(() => "");
        logger.warn(`[Memory] Groq extraction HTTP ${gRes.status}: ${errTxt}`, {
          event: "memory_extraction_provider_error", provider: "groq", http_status: gRes.status
        });
      }
    } catch (gErr) {
      logger.warn(`[Memory] Groq extraction error: ${errMessage(gErr)}`, {
        event: "memory_extraction_provider_error", provider: "groq"
      });
    }
  }

  // 2. Fallback to Ollama if Groq didn't return text
  if (!extractionResText && ollamaUrl && !ollamaUrl.includes("placeholder")) {
    try {
      const res = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            { role: "system", content: systemInstructions },
            { role: "user", content: userPrompt }
          ],
          stream: false,
          options: { temperature: 0.1 }
        }),
        signal: AbortSignal.timeout(30000)
      });
      if (res.ok) {
        const oData = await res.json();
        extractionResText = oData?.message?.content || "";
        if (extractionResText) extractorProvider = "ollama";
      }
    } catch (err) {
      logger.warn(`[Memory] Ollama extraction call failed: ${errMessage(err)}`, {
        event: "memory_extraction_provider_error", provider: "ollama"
      });
    }
  }

  if (!extractionResText) return summarize("failed");

  const rawText = extractionResText;

  const clean = extractJsonPayload(rawText);

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    logger.warn("[Memory] Extraction response was not valid JSON.", {
      event: "memory_extraction_parse_error", provider: extractorProvider
    });
    return summarize("failed");
  }

  const memories = getMemoryExtractionCandidates(parsed);
  if (!memories) {
    logger.info("[Memory] Nothing worth remembering in this turn.");
    return summarize("nothing");
  }

  // Karar mantigi src/ ile ortak (memory-write-planner.ts); G/C
  // memory-persistence.js icinde, Firebase bagimliliklari buradan verilir.
  await persistMemoryCandidates({
    db,
    memories,
    userId,
    conversationId,
    sourceMessageIds,
    embed: (text) => getEmbedding(text, ollamaUrl, geminiKey),
    logger,
    now: () => Timestamp.now(),
    errMessage,
    tally
  });

  return summarize("nothing");
}

export const api = onRequest({ cors: true, secrets: [GROQ_API_KEY, GEMINI_API_KEY] }, async (req, res) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization, X-Firebase-AppCheck, x-recaptcha-token");
    res.status(204).send("");
    return;
  }

  res.set("Access-Control-Allow-Origin", "*");
  const path = req.path || req.url || "";

  // App Check verification. appCheckStatus ("valid" | "invalid" | "missing")
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
      logger.warn("[AppCheck] Token verification failed.", { event: "app_check", outcome: "invalid", error: errMessage(err) });
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

  // Health endpoint: /health or /api/health
  if (path.endsWith("/health")) {
    const activeProvider = (process.env.ALFRED_LLM_PROVIDER || process.env.AI_PROVIDER || "groq").trim().toLowerCase();
    const groqKey = gizliOku(GROQ_API_KEY, "GROQ_API_KEY");
    const groqConfigured = !!groqKey;

    if (activeProvider === "groq") {
      res.status(200).json({
        status: "ok",
        activeProvider: "groq",
        providerStatus: {
          groqConfigured,
          ollamaReachable: false,
          modelReady: groqConfigured
        }
      });
      return;
    }

    const ollamaUrl = process.env.OLLAMA_BASE_URL || "https://ollama.example.invalid";
    let ollamaHealthy = false;

    try {
      const resp = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/tags`, {
        signal: AbortSignal.timeout(4000)
      });
      ollamaHealthy = resp.ok;
    } catch {
      ollamaHealthy = false;
    }

    res.status(200).json({
      status: "ok",
      activeProvider: ollamaHealthy ? "ollama" : (groqConfigured ? "groq" : "offline"),
      providerStatus: {
        ollamaReachable: ollamaHealthy,
        groqConfigured,
        modelReady: ollamaHealthy
      }
    });
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

  let authenticatedUid = null;
  try {
    const decoded = await getAuth().verifyIdToken(authHeader.substring(7).trim());
    authenticatedUid = decoded?.uid || null;
  } catch (err) {
    console.warn("[Auth] ID token verification failed:", err.message);
    res.status(401).json({ error: "Unauthorized: Invalid or expired auth token." });
    return;
  }

  if (authenticatedUid !== ALLOWED_UID) {
    console.warn(`[Auth] Forbidden: UID ${authenticatedUid} attempted access`);
    res.status(403).json({ error: "Forbidden: Unauthorized UID." });
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

  // Chat endpoint: POST /chat or POST /api/chat
  if (path.endsWith("/chat")) {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed. Use POST." });
      return;
    }

    // SSE-only: the response is always `text/event-stream`. Clients may still
    // send `stream: true`, but it is ignored; there is no non-streaming JSON
    // mode (no client ever sent `stream: false`).
    const { message, conversationId: requestedConvId } = req.body || {};
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Message is required." });
      return;
    }

    const trimmedMessage = message.trim();
    const activeProvider = (process.env.ALFRED_LLM_PROVIDER || process.env.AI_PROVIDER || "groq").trim().toLowerCase();
    const groqKey = gizliOku(GROQ_API_KEY, "GROQ_API_KEY");
    const groqModel = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
    const geminiKey = gizliOku(GEMINI_API_KEY, "GEMINI_API_KEY");
    const ollamaUrl = process.env.OLLAMA_BASE_URL || "https://ollama.example.invalid";
    const ollamaModel = process.env.OLLAMA_MODEL || "gemma4:12b-mlx";

    let convId = requestedConvId;
    const now = Timestamp.now();

    // 1. Resolve or create conversation
    try {
      if (convId) {
        const cSnap = await db.collection("conversations").doc(convId).get();
        if (baskasinin(cSnap)) {
          res.status(404).json({ error: "Conversation not found" });
          return;
        }
        if (!cSnap.exists) {
          await db.collection("conversations").doc(convId).set({
            userId,
            title: "New Conversation",
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

    // 2. Transactionally append user message
    const convRef = db.collection("conversations").doc(convId);
    const userMsgRef = convRef.collection("messages").doc();
    let userSeq = 1;

    try {
      await db.runTransaction(async (tx) => {
        const cSnap = await tx.get(convRef);
        const cData = cSnap.exists ? cSnap.data() : { messageCount: 0 };
        const currentCount = (cData.messageCount || 0);
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

        if (userSeq === 1 && (!cData.title || cData.title === "New Conversation")) {
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
      retrievedMemories = await retrieveRelevantMemories(db, queryEmbedding, userId, MEMORY_TOP_K, MEMORY_MIN_SCORE, retrievalStats);
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

    // Persona states the provider/model actually answering this turn; the
    // profile comes from users/*.md embedded at build time (functions/build.js).
    const currentModel = activeProvider === "groq" ? groqModel : ollamaModel;
    const systemPromptWithMemories = buildAlfredSystemPrompt({
      runtime: { provider: activeProvider, model: currentModel },
      memories: retrievedMemories
    });

    const messagesPayload = [
      { role: "system", content: systemPromptWithMemories },
      ...boundedHistory,
      { role: "user", content: trimmedMessage }
    ];

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

    sendEvent({ type: "start", conversationId: convId, provider: activeProvider, model: currentModel });
    sendEvent({ type: "thinking" });

    let accumulatedText = "";
    let isFinalized = false;

    const finalizeTurn = async (content) => {
      if (isFinalized || !content) return;
      isFinalized = true;

      let asstMsgDocId = null;
      try {
        const asstMsgRef = convRef.collection("messages").doc();
        asstMsgDocId = asstMsgRef.id;
        await db.runTransaction(async (tx) => {
          const cSnap = await tx.get(convRef);
          const cData = cSnap.exists ? cSnap.data() : {};
          const asstSeq = (cData.messageCount || userSeq) + 1;
          const asstNow = Timestamp.now();

          tx.set(asstMsgRef, {
            role: "assistant",
            content,
            sequence: asstSeq,
            status: "completed",
            provider: activeProvider,
            model: currentModel,
            createdAt: asstNow
          });

          tx.update(convRef, {
            messageCount: asstSeq,
            updatedAt: asstNow,
            lastMessageAt: asstNow
          });
        });
      } catch (persistErr) {
        console.error("Failed to persist assistant message to Firestore:", persistErr);
      }

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
          groqKey,
          groqModel,
          geminiKey,
          userMessage: trimmedMessage,
          assistantResponse: content,
          userId,
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
    // yazilir; birden fazla model cagrisi (arac turlari) toplanir.
    const llmStart = performance.now();
    const llmMetrics = {
      provider: activeProvider,
      model: currentModel,
      llm_calls: 0,
      tool_rounds: 0,
      tool_calls: 0,
      rate_limit_retries: 0,
      time_to_first_token_ms: null,
      prompt_tokens: null,
      completion_tokens: null,
      total_tokens: null,
      reasoning_tokens: null
    };
    const addUsage = (usage) => {
      if (!usage || typeof usage !== "object") return;
      for (const [field, value] of [
        ["prompt_tokens", usage.prompt_tokens],
        ["completion_tokens", usage.completion_tokens],
        ["total_tokens", usage.total_tokens],
        ["reasoning_tokens", usage.completion_tokens_details?.reasoning_tokens]
      ]) {
        if (typeof value === "number") llmMetrics[field] = (llmMetrics[field] || 0) + value;
      }
    };
    const markFirstToken = () => {
      if (llmMetrics.time_to_first_token_ms === null) {
        llmMetrics.time_to_first_token_ms = msSince(llmStart);
      }
    };
    const logLlmRequest = (outcome, err) => {
      logEvent(outcome === "ok" ? "INFO" : "ERROR", "llm_request",
        `LLM request ${outcome} (${activeProvider}/${currentModel}) in ${msSince(llmStart)}ms`, {
          ...llmMetrics,
          outcome,
          app_check: appCheckStatus,
          latency_ms: msSince(llmStart),
          ...(err ? { error: errMessage(err) } : {})
        });
    };

    try {
      const currentPayload = [...messagesPayload];
      // Yalnizca gercekten calisan araclar sunulur. SSH araclarinin arkasinda
      // bir baglanti yoktu (sabit yer tutucu ciktilar donuyordu); model
      // uydurma sunucu durumu raporlamasin diye kaldirildilar. Persona da
      // sunucu erisiminin henuz bagli olmadigini soyluyor.
      let activeTools = [TIME_TOOL_DEFINITION];
      let toolTurn = 0;
      const MAX_TURNS = 3;

      while (toolTurn < MAX_TURNS) {
        toolTurn++;
        let passAccumulatedText = "";
        let passToolCalls = [];

        if (activeProvider === "groq") {
          if (!groqKey) {
            throw new Error("GROQ_API_KEY is not configured in Cloud Functions environment.");
          }

          const groqPayload = {
            model: groqModel,
            messages: currentPayload,
            stream: true,
            temperature: 0.6,
            max_tokens: 1500
          };
          if (activeTools && activeTools.length > 0) {
            groqPayload.tools = activeTools;
          }

          let attempts = 0;
          let groqRes;
          llmMetrics.llm_calls++;
          while (attempts < 3) {
            attempts++;
            groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${groqKey}`
              },
              body: JSON.stringify(groqPayload),
              signal: AbortSignal.timeout(60000)
            });

            if (groqRes.status === 429 && attempts < 3) {
              const retryHeader = groqRes.headers.get("retry-after");
              let waitSec = retryHeader ? parseFloat(retryHeader) : 0;
              if (!waitSec || Number.isNaN(waitSec)) {
                const errJson = await groqRes.clone().json().catch(() => ({}));
                const msg = errJson?.error?.message || "";
                const match = msg.match(/try again in ([0-9.]+)s/i);
                waitSec = match ? parseFloat(match[1]) + 0.6 : 5.0;
              }
              const waitMs = Math.min(Math.max(waitSec * 1000, 2500), 15000);
              llmMetrics.rate_limit_retries++;
              logger.warn(`[Groq] Rate limit (429) hit, waiting ${Math.round(waitMs)}ms before retry ${attempts}...`, {
                event: "llm_rate_limited", provider: "groq", model: groqModel, wait_ms: Math.round(waitMs), attempt: attempts
              });
              await new Promise((r) => setTimeout(r, waitMs));
              continue;
            }
            break;
          }

          if (!groqRes.ok) {
            const errText = await groqRes.text().catch(() => "");
            throw new Error(`Groq API error (${groqRes.status}): ${errText}`);
          }

          const reader = groqRes.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          const toolCallsAccumulator = {};

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || !trimmed.startsWith("data:")) continue;
              const dataStr = trimmed.replace(/^data:\s*/, "");
              if (dataStr === "[DONE]") continue;

              try {
                const chunk = JSON.parse(dataStr);
                // Groq token kullanimini finish_reason'li son chunk'ta verir;
                // stream_options olmadan da hem `usage` hem `x_groq.usage` gelir
                // (ikisi ayni degerdir, yalnizca biri sayilir). stream_options
                // include_usage bilerek eklenmedi: ayni kullanimi choices: [] olan
                // ek bir chunk'ta tekrar gonderir ve toplam iki kat sayilirdi.
                // Kullanim, choice kontrolunden once okunur.
                addUsage(chunk.usage || chunk.x_groq?.usage);
                const choice = chunk.choices?.[0];
                if (!choice) continue;

                const delta = choice.delta;
                if (!delta) continue;

                if (delta.content || delta.tool_calls) markFirstToken();

                if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                  for (const tc of delta.tool_calls) {
                    const idx = typeof tc.index === "number" ? tc.index : 0;
                    if (!toolCallsAccumulator[idx]) {
                      toolCallsAccumulator[idx] = {
                        id: tc.id || `call_groq_${Date.now()}_${idx}`,
                        name: "",
                        arguments: ""
                      };
                    }
                    if (tc.id) toolCallsAccumulator[idx].id = tc.id;
                    if (tc.function?.name) toolCallsAccumulator[idx].name += tc.function.name;
                    if (tc.function?.arguments) toolCallsAccumulator[idx].arguments += tc.function.arguments;
                  }
                }

                if (delta.content) {
                  passAccumulatedText += delta.content;
                  if (Object.keys(toolCallsAccumulator).length === 0) {
                    accumulatedText += delta.content;
                    sendEvent({ type: "chunk", text: delta.content });
                  }
                }
              } catch (pErr) {
                console.warn("Failed to parse Groq chunk line:", pErr);
              }
            }
          }

          passToolCalls = Object.values(toolCallsAccumulator).map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: tc.arguments
            }
          }));
        } else {
          // Ollama path (preserved intact for future re-enablement)
          const requestBody = {
            model: ollamaModel,
            messages: currentPayload,
            stream: true
          };
          if (activeTools && activeTools.length > 0) {
            requestBody.tools = activeTools;
          }

          llmMetrics.llm_calls++;
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
                  addUsage({ prompt_tokens: p, completion_tokens: c, total_tokens: p + c });
                }

                if (chunk.message?.tool_calls && chunk.message.tool_calls.length > 0) {
                  passToolCalls.push(...chunk.message.tool_calls);
                }

                if (chunk.message?.content) {
                  passAccumulatedText += chunk.message.content;
                  if (passToolCalls.length === 0) {
                    accumulatedText += chunk.message.content;
                    sendEvent({ type: "chunk", text: chunk.message.content });
                  }
                }
              } catch (pErr) {
                console.warn("Failed to parse Ollama chunk line:", pErr);
              }
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
            let toolResult;
            if (fnName === "get_current_time") {
              toolResult = getCurrentTimeForCity(fnArgs?.city);
            } else {
              toolResult = { error: `Tool ${fnName} not recognized.` };
            }

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

          accumulatedText = "";
          activeTools = undefined;
        } else {
          break;
        }
      }

      logLlmRequest("ok");
      sendEvent({ type: "done" });
      const cleanContent = accumulatedText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
      if (cleanContent) {
        await finalizeTurn(cleanContent);
      }
      res.end();
    } catch (err) {
      logLlmRequest("error", err);
      console.error(`Cloud Function ${activeProvider} stream failed:`, err);

      // Persist interrupted message if partially generated
      const cleanInterrupted = accumulatedText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
      if (cleanInterrupted) {
        try {
          const asstMsgRef = convRef.collection("messages").doc();
          const asstNow = Timestamp.now();
          await asstMsgRef.set({
            role: "assistant",
            content: cleanInterrupted,
            sequence: userSeq + 1,
            status: "interrupted",
            provider: activeProvider,
            model: currentModel,
            createdAt: asstNow
          });
        } catch {}
      }

      sendEvent({
        type: "error",
        error: err?.message || "LLM provider temporarily unavailable."
      });
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
    if (request.auth?.uid !== ALLOWED_UID) {
      throw new HttpsError("permission-denied", "Unauthorized UID.");
    }
    return {
      status: "ok",
      appId: request.app?.appId || null,
      message: "Alfred callable endpoint verified."
    };
  }
);
