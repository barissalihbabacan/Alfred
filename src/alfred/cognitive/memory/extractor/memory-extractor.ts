import { AIProvider } from "../../../../ai/providers/types.js";
import { getAIConfig, getMemoryConfig, MemoryExtractionConfig } from "../../../../core/config/index.js";
import {
  IMemoryExtractor,
  MemoryExtractionInput,
  MemoryExtractionResult
} from "./types.js";
import { toExtractedMemoryCandidates } from "../../../../ai/prompts/memory-extraction.js";
import {
  callMemoryExtractionProviders,
  type ExtractionProviderError
} from "../../../../ai/providers/chat-fallback/extraction-providers.js";
import { runMemoryExtraction, type MemoryExtractionAnswer } from "./extraction-pipeline.js";
import { errorMessage } from "../../../../core/errors/index.js";

/** Asks a model for the extraction JSON; null when no provider answered. */
export type MemoryExtractionCaller = (system: string, user: string) => Promise<MemoryExtractionAnswer | null>;

export interface MemoryExtractorOptions {
  /**
   * Asks the model. Defaults to production's chain
   * (callMemoryExtractionProviders: Groq, Gemini, Ollama) with keys and URLs
   * from the environment and the global fetch.
   */
  call?: MemoryExtractionCaller;
  /** Ask this AIProvider instead of the chain (tests, or a pinned provider). */
  provider?: AIProvider;
  /** fetch for the default chain (tests). */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  config?: Partial<MemoryExtractionConfig>;
}

/** An AIProvider as an extraction caller (temperature 0.1, like the chain). */
export function aiProviderExtractionCaller(provider: AIProvider, model?: string): MemoryExtractionCaller {
  return async (system, user) => {
    if (!provider.isConfigured()) return null;
    const response = await provider.chat(
      [
        { role: "system", content: system },
        { role: "user", content: user }
      ],
      { temperature: 0.1, maxTokens: 1000, model }
    );
    return { text: response.content, provider: provider.id };
  };
}

/**
 * Production's extraction chain with src's configuration: GROQ_API_KEY +
 * MEMORY_EXTRACTION_MODEL, GEMINI_API_KEY + GEMINI_EXTRACTION_MODEL, then
 * OLLAMA_BASE_URL / OLLAMA_MODEL. Failures are logged without response bodies.
 */
export function defaultExtractionCaller(
  config: MemoryExtractionConfig,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init)
): MemoryExtractionCaller {
  const ai = getAIConfig();
  return (system, user) => callMemoryExtractionProviders({
    fetch: fetchImpl,
    groqKey: ai.groq.apiKey,
    groqModel: config.model,
    geminiKey: process.env.GEMINI_API_KEY?.trim(),
    geminiModel: config.geminiModel,
    ollamaUrl: ai.ollama.baseUrl,
    ollamaModel: ai.ollama.defaultModel,
    system,
    user,
    onProviderError: (e: ExtractionProviderError) => {
      console.warn(
        `[MemoryExtraction] ${e.provider} (${e.model}) extraction failed${e.httpStatus === undefined ? "" : ` with HTTP ${e.httpStatus}`}.`
      );
    }
  });
}

/**
 * src's extractor, on the pipeline production uses
 * (extraction-pipeline.ts): the same empty-message / "don't remember this"
 * short-circuit, the same bounded context (maxContextMessages, default 10),
 * the same prompt, the same model chain by default and the same parse and
 * candidate validation. Only the timeout wraps the model call alone here;
 * production's budget also covers persisting the candidates.
 */
export class MemoryExtractor implements IMemoryExtractor {
  private call: MemoryExtractionCaller;
  private config: MemoryExtractionConfig;

  constructor(options?: MemoryExtractorOptions) {
    this.config = {
      ...getMemoryConfig().extraction,
      ...options?.config
    };
    this.call = options?.call
      || (options?.provider ? aiProviderExtractionCaller(options.provider, this.config.model) : defaultExtractionCaller(this.config, options?.fetch));
  }

  public async extract(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    if (!this.config.enabled) {
      return { shouldRemember: false, candidates: [] };
    }

    const timeoutMs = this.config.timeoutMs;
    const startTime = Date.now();

    try {
      const extraction = await runMemoryExtraction({
        turn: {
          currentMessage: input.currentMessage,
          assistantResponse: input.assistantResponse,
          recentMessages: input.recentMessages,
          userName: input.userName
        },
        maxContextMessages: this.config.maxContextMessages,
        call: (system, user) => withTimeout(this.call(system, user), timeoutMs)
      });

      if (extraction.outcome !== "candidates") {
        if (extraction.outcome === "invalid_json") {
          console.warn(`[MemoryExtraction] Extraction response was not valid JSON (${extraction.provider}).`);
        }
        return {
          shouldRemember: false,
          candidates: [],
          ...("text" in extraction ? { rawResponse: extraction.text } : {})
        };
      }

      const candidates = toExtractedMemoryCandidates(extraction.memories, this.config.minConfidence);
      if (candidates.length > 0) {
        // Types and actions only: the candidates hold what the user said.
        console.log(
          `[MemoryExtraction] Extracted ${candidates.length} candidate(s) via ${extraction.provider} in ${Date.now() - startTime}ms:`,
          candidates.map((c) => `${c.action}/${c.memoryType}`).join(", ")
        );
      }
      return { shouldRemember: candidates.length > 0, candidates, rawResponse: extraction.text };
    } catch (err: unknown) {
      console.warn(`[MemoryExtraction] Extraction failed gracefully (${Date.now() - startTime}ms):`, errorMessage(err));
      return { shouldRemember: false, candidates: [] };
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Memory extraction timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
