// Uzun sureli bellek cikarimi: sohbet turu bittikten sonra index.js buradaki
// extractAndPersistMemories'i cagirir. Adimlar src/ ile ortak:
// - istem, baglam siniri ve "bunu hatirlama" kisa devresi:
//   src/alfred/cognitive/memory/extractor/extraction-pipeline.ts
// - model cagrisi (Groq -> Gemini -> Ollama):
//   src/ai/providers/chat-fallback/extraction-providers.ts
// - adaylarin kaydi: memory-persistence.js (karar mantigi
//   src/alfred/cognitive/memory/memory-write-loop.ts + memory-write-planner.ts)
// src/ tarafinda ayni adimlari MemoryExtractor + MemoryService kullanir.
//
// Burada yalnizca loglama ve Firebase baglantisi kalir. Bagimliliklar (fetch,
// logger, Timestamp, getEmbedding, errMessage) parametre olarak gelir; boylece
// tests/unit/memory-extraction-pipeline.test.ts bu dosyayi eski satir ici
// kodun birebir kopyasiyla (fixtures/legacy-extract-and-persist.js)
// karsilastirabilir.
import { runMemoryExtraction } from "../src/alfred/cognitive/memory/extractor/extraction-pipeline.js";
import { callMemoryExtractionProviders } from "../src/ai/providers/chat-fallback/extraction-providers.js";
import {
  createMemoryWriteTally,
  summarizeMemoryWriteTally
} from "../src/alfred/cognitive/memory/memory-write-planner.js";
import { persistMemoryCandidates as defaultPersist } from "./memory-persistence.js";

const PROVIDER_LABELS = { evren: "EVREN", groq: "Groq", gemini: "Gemini" };

/**
 * @param {object} deps
 * @param {(url: string, init: RequestInit) => Promise<Response>} deps.fetch
 * @param {{ info: Function, warn: Function }} deps.logger
 * @param {() => unknown} deps.now sunucu zaman damgasi (Timestamp.now)
 * @param {(text: string, ollamaUrl: string, geminiKey: string) => Promise<{ values: number[], model: string }>} deps.getEmbedding
 * @param {(err: unknown) => string} deps.errMessage
 * @param {string} deps.memoryExtractionModel Groq cikarim modeli
 * @param {string} deps.geminiExtractionModel Gemini cikarim modeli
 * @param {typeof defaultPersist} [deps.persist]
 */
export function createExtractAndPersistMemories({
  fetch,
  logger,
  now,
  getEmbedding,
  errMessage,
  memoryExtractionModel,
  geminiExtractionModel,
  persist = defaultPersist
}) {
  const onProviderError = (e) => {
    if (e.provider === "ollama") {
      logger.warn(`[Memory] Ollama extraction call failed: ${errMessage(e.error)}`, {
        event: "memory_extraction_provider_error", provider: "ollama"
      });
      return;
    }
    const label = PROVIDER_LABELS[e.provider];
    logger.warn(e.httpStatus !== undefined
      ? `[Memory] ${label} extraction HTTP ${e.httpStatus}: ${String(e.detail).slice(0, 500)}`
      : `[Memory] ${label} extraction error: ${String(e.detail).slice(0, 300)}`, {
      event: "memory_extraction_provider_error",
      provider: e.provider,
      model: e.model,
      ...(e.httpStatus !== undefined ? { http_status: e.httpStatus } : {}),
      ...(e.rateLimit ? { limit_type: e.rateLimit.limitType, retry_after_ms: e.rateLimit.retryAfterMs, decision: "give_up" } : {})
    });
  };

  return async function extractAndPersistMemories({
    db,
    ollamaUrl,
    ollamaModel,
    evrenKey,
    groqKey,
    geminiKey,
    userMessage,
    assistantResponse,
    userId,
    conversationId,
    sourceMessageIds,
    recentHistory
  }) {
    // Aday basina sonuc sayaclari; memory_extraction olayi icin dondurulur.
    // rejected: gizli bilgi filtresi; invalid: validateMemoryCandidate reddetti.
    const tally = createMemoryWriteTally();

    // 429'da beklenmez (sohbet cevabi zaten gitti); limit turu ve gercek sure
    // loglanir, siradaki saglayiciya gecilir.
    const extraction = await runMemoryExtraction({
      turn: { currentMessage: userMessage, assistantResponse, recentMessages: recentHistory },
      call: (system, user) => callMemoryExtractionProviders({
        fetch: (url, init) => fetch(url, init),
        evrenKey,
        groqKey,
        groqModel: memoryExtractionModel,
        geminiKey,
        geminiModel: geminiExtractionModel,
        ollamaUrl,
        ollamaModel,
        system,
        user,
        onProviderError
      })
    });
    const summarize = (fallbackOutcome) => summarizeMemoryWriteTally(tally, fallbackOutcome, extraction.provider);

    switch (extraction.outcome) {
      case "skipped":
        // Bos mesaj ya da birebir "bunu hatirlama": model cagrilmaz.
        return { ...summarize("nothing"), skip_reason: extraction.reason };
      case "failed":
        return summarize("failed");
      case "invalid_json":
        logger.warn("[Memory] Extraction response was not valid JSON.", {
          event: "memory_extraction_parse_error", provider: extraction.provider
        });
        return summarize("failed");
      case "nothing":
        logger.info("[Memory] Nothing worth remembering in this turn.");
        return summarize("nothing");
      default:
        break;
    }

    // Karar mantigi src/ ile ortak (memory-write-loop.ts + memory-write-planner.ts);
    // G/C memory-persistence.js icinde, Firebase bagimliliklari buradan verilir.
    await persist({
      db,
      memories: extraction.memories,
      userId,
      conversationId,
      sourceMessageIds,
      embed: (text) => getEmbedding(text, ollamaUrl, geminiKey),
      logger,
      now,
      errMessage,
      tally
    });

    return summarize("nothing");
  };
}
