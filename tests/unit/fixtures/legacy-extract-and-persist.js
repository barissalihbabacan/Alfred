// Verbatim copy of production's memory extraction calling as of origin/main
// dc3939b: extractAndPersistMemories from functions/index.js and
// callMemoryExtractionProviders from
// src/ai/providers/chat-fallback/extraction-providers.ts (types stripped),
// before the extraction steps moved to the shared
// src/alfred/cognitive/memory/extractor/extraction-pipeline.ts and the Ollama
// step into callMemoryExtractionProviders. Do not edit:
// tests/unit/memory-extraction-pipeline.test.ts runs it side by side with
// functions/memory-extraction.js on thousands of random turns.
//
// Only the wrapper is new: the free variables of the original (Firebase's
// logger and Timestamp, fetch, getEmbedding, errMessage, persistMemoryCandidates
// and the two model constants) come in through createLegacyExtractAndPersist.
/* global AbortSignal */
import {
  buildMemoryExtractionSystemPrompt,
  buildMemoryExtractionUserPrompt,
  extractJsonPayload,
  getMemoryExtractionCandidates
} from "../../../src/ai/prompts/memory-extraction.js";
import {
  createMemoryWriteTally,
  summarizeMemoryWriteTally
} from "../../../src/alfred/cognitive/memory/memory-write-planner.js";
import { isUsableApiKey } from "../../../src/ai/providers/chat-fallback/chat-providers.js";
import { parseRateLimitInfo } from "../../../src/ai/providers/groq/rate-limit.js";

// --- src/ai/providers/chat-fallback/extraction-providers.ts (dc3939b) ------

const DEFAULT_GEMINI_EXTRACTION_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_GROQ_EXTRACTION_MODEL = "openai/gpt-oss-20b";

function buildGroqExtractionRequest(apiKey, model, system, user) {
  return {
    provider: "groq",
    model,
    url: "https://api.groq.com/openai/v1/chat/completions",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      })
    },
    timeoutMs: 20_000
  };
}

function buildGeminiExtractionRequest(apiKey, model, system, user) {
  return {
    provider: "gemini",
    model,
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.1,
        reasoning_effort: "minimal"
      })
    },
    timeoutMs: 10_000
  };
}

function planExtractionRequests(options) {
  const requests = [];
  if (isUsableApiKey(options.groqKey)) {
    requests.push(buildGroqExtractionRequest(String(options.groqKey), options.groqModel || DEFAULT_GROQ_EXTRACTION_MODEL, options.system, options.user));
  }
  const geminiModel = options.geminiModel || DEFAULT_GEMINI_EXTRACTION_MODEL;
  if (isUsableApiKey(options.geminiKey) && isUsableApiKey(geminiModel)) {
    requests.push(buildGeminiExtractionRequest(String(options.geminiKey), geminiModel, options.system, options.user));
  }
  return requests;
}

async function callMemoryExtractionProviders(options) {
  for (const request of planExtractionRequests(options)) {
    try {
      const res = await options.fetch(request.url, { ...request.init, signal: AbortSignal.timeout(request.timeoutMs) });
      if (res.ok) {
        const data = (await res.json());
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === "string" && content) {
          return { text: content, provider: request.provider, model: request.model };
        }
        options.onProviderError?.({ provider: request.provider, model: request.model, httpStatus: res.status, detail: "empty extraction response" });
        continue;
      }
      const errText = await res.text().catch(() => "");
      let rateLimit;
      if (res.status === 429) {
        let bodyMessage = "";
        try {
          const parsed = JSON.parse(errText);
          const obj = Array.isArray(parsed) ? parsed[0] : parsed;
          const message = obj?.error?.message;
          bodyMessage = typeof message === "string" ? message : "";
        } catch { /* not JSON */ }
        const info = parseRateLimitInfo(res.headers.get("retry-after"), bodyMessage);
        rateLimit = { limitType: info.limitType, retryAfterMs: info.retryAfterMs };
      }
      options.onProviderError?.({ provider: request.provider, model: request.model, httpStatus: res.status, detail: errText, rateLimit });
    } catch (err) {
      const message = typeof err === "object" && err !== null ? err.message : err;
      options.onProviderError?.({ provider: request.provider, model: request.model, detail: String(message || "unknown error") });
    }
  }
  return null;
}

// --- functions/index.js (dc3939b) -------------------------------------------

export function createLegacyExtractAndPersist({
  fetch,
  logger,
  Timestamp,
  getEmbedding,
  errMessage,
  persistMemoryCandidates,
  MEMORY_EXTRACTION_MODEL,
  GEMINI_EXTRACTION_MODEL
}) {

async function extractAndPersistMemories({
  db,
  ollamaUrl,
  ollamaModel,
  groqKey,
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

  // 1. Groq (MEMORY_EXTRACTION_MODEL), 2. Gemini (GEMINI_EXTRACTION_MODEL):
  // src/ai/providers/chat-fallback/extraction-providers.ts. 429'da beklenmez
  // (sohbet cevabi zaten gitti); limit turu ve gercek sure loglanir, siradaki
  // saglayiciya gecilir.
  const extraction = await callMemoryExtractionProviders({
    fetch: (url, init) => fetch(url, init),
    groqKey,
    groqModel: MEMORY_EXTRACTION_MODEL,
    geminiKey,
    geminiModel: GEMINI_EXTRACTION_MODEL,
    system: systemInstructions,
    user: userPrompt,
    onProviderError: (e) => {
      const label = e.provider === "groq" ? "Groq" : "Gemini";
      logger.warn(e.httpStatus !== undefined
        ? `[Memory] ${label} extraction HTTP ${e.httpStatus}: ${String(e.detail).slice(0, 500)}`
        : `[Memory] ${label} extraction error: ${String(e.detail).slice(0, 300)}`, {
        event: "memory_extraction_provider_error",
        provider: e.provider,
        model: e.model,
        ...(e.httpStatus !== undefined ? { http_status: e.httpStatus } : {}),
        ...(e.rateLimit ? { limit_type: e.rateLimit.limitType, retry_after_ms: e.rateLimit.retryAfterMs, decision: "give_up" } : {})
      });
    }
  });
  if (extraction) {
    extractionResText = extraction.text;
    extractorProvider = extraction.provider;
  }

  // 3. Fallback to Ollama if neither Groq nor Gemini returned text
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

  return extractAndPersistMemories;
}
