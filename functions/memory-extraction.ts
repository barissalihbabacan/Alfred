// Uzun sureli bellek cikarimi: sohbet turu bittikten sonra api.ts buradaki
// extractAndPersistMemories'i cagirir. Adimlar src/ ile ortak:
// - istem, baglam siniri ve "bunu hatirlama" kisa devresi:
//   src/alfred/cognitive/memory/extractor/extraction-pipeline.ts
// - model cagrisi (Groq -> Gemini -> Ollama):
//   src/ai/providers/chat-fallback/extraction-providers.ts
// - adaylarin kaydi: memory-persistence.ts (karar mantigi
//   src/alfred/cognitive/memory/memory-write-loop.ts + memory-write-planner.ts)
// src/ tarafinda ayni adimlari MemoryExtractor + MemoryService kullanir.
//
// Burada yalnizca loglama ve Firebase baglantisi kalir. Bagimliliklar (fetch,
// logger, Timestamp, getEmbedding, errMessage) parametre olarak gelir; boylece
// tests/unit/memory-extraction-pipeline.test.ts bu dosyayi eski satir ici
// kodun birebir kopyasiyla (fixtures/legacy-extract-and-persist.js)
// karsilastirabilir.
import { runMemoryExtraction } from "../src/alfred/cognitive/memory/extractor/extraction-pipeline.js";
import type { ExtractionContextMessage } from "../src/alfred/cognitive/memory/extractor/extraction-pipeline.js";
import {
  callMemoryExtractionProviders,
  type ExtractionProviderError
} from "../src/ai/providers/chat-fallback/extraction-providers.js";
import {
  createMemoryWriteTally,
  summarizeMemoryWriteTally
} from "../src/alfred/cognitive/memory/memory-write-planner.js";
import { persistMemoryCandidates as defaultPersist, type PersistMemoryCandidatesParams } from "./memory-persistence.js";

const PROVIDER_LABELS: Record<string, string> = { evren: "EVREN", groq: "Groq", gemini: "Gemini" };

export type MemoryExtractionSummary = ReturnType<typeof summarizeMemoryWriteTally> & {
  skip_reason?: string;
};

export interface CreateExtractAndPersistMemoriesDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  now: () => unknown;
  getEmbedding: (text: string, ollamaUrl?: string, geminiKey?: string) => Promise<{ values: number[]; model: string }>;
  errMessage: (err: unknown) => string;
  memoryExtractionModel: string;
  geminiExtractionModel: string;
  persist?: (params: PersistMemoryCandidatesParams) => Promise<void>;
  /** Whose facts are extracted; defaults to the owner named in users/USER_PROFILE.md. */
  userName?: string;
}

export interface ExtractAndPersistMemoriesParams {
  db: unknown;
  ollamaUrl?: string;
  ollamaModel?: string;
  evrenKey?: string;
  groqKey?: string;
  geminiKey?: string;
  userMessage: string;
  assistantResponse?: string;
  userId: string;
  projectId?: string | null;
  conversationId: string;
  sourceMessageIds?: string[];
  recentHistory?: unknown[];
}

export function createExtractAndPersistMemories({
  fetch,
  logger,
  now,
  getEmbedding,
  errMessage,
  memoryExtractionModel,
  geminiExtractionModel,
  persist = defaultPersist,
  userName
}: CreateExtractAndPersistMemoriesDeps) {
  const onProviderError = (e: ExtractionProviderError) => {
    if (e.provider === "ollama") {
      logger.warn(`[Memory] Ollama extraction call failed: ${errMessage(e.error)}`, {
        event: "memory_extraction_provider_error", provider: "ollama"
      });
      return;
    }
    const label = PROVIDER_LABELS[e.provider] || e.provider;
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
    projectId,
    conversationId,
    sourceMessageIds,
    recentHistory
  }: ExtractAndPersistMemoriesParams): Promise<MemoryExtractionSummary> {
    // Aday basina sonuc sayaclari; memory_extraction olayi icin dondurulur.
    // rejected: gizli bilgi filtresi; invalid: validateMemoryCandidate reddetti.
    const tally = createMemoryWriteTally();

    // 429'da beklenmez (sohbet cevabi zaten gitti); limit turu ve gercek sure
    // loglanir, siradaki saglayiciya gecilir.
    const extraction = await runMemoryExtraction({
      turn: {
        currentMessage: userMessage,
        assistantResponse,
        recentMessages: recentHistory as ExtractionContextMessage[] | undefined,
        userName
      },
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
    const summarize = (fallbackOutcome: string) => summarizeMemoryWriteTally(tally, fallbackOutcome, extraction.provider);

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
    // G/C memory-persistence.ts icinde, Firebase bagimliliklari buradan verilir.
    await persist({
      db,
      memories: extraction.memories,
      userId,
      ...(projectId !== undefined ? { projectId } : {}),
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
