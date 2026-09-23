import { DetailedEmbedding, EmbeddingOptions, IEmbeddingProvider } from "./types.js";
import {
  EMBEDDING_DIMENSION,
  EMBEDDING_TIMEOUT_MS,
  GEMINI_EMBEDDING_MODEL,
  generateEmbedding,
  type EmbeddingFetch,
  type GeminiEmbeddingError
} from "./embedding-client.js";
import { errorMessage } from "../../core/errors/index.js";

export interface FallbackEmbeddingProviderOptions {
  /** Gemini API key; blank skips Gemini. */
  geminiApiKey?: string | null;
  /** Ollama base URL; blank (or containing "placeholder") skips Ollama. */
  ollamaUrl?: string | null;
  fetchFn?: EmbeddingFetch;
  /** Per-call timeout for each provider (default 15 s, as production). */
  timeoutMs?: number;
  /** Called when Gemini fails before the Ollama fallback (default: console.warn). */
  onGeminiError?: (error: GeminiEmbeddingError) => void;
}

/**
 * FallbackEmbeddingProvider
 *
 * src's equivalent of production's `getEmbedding()`: the shared
 * `generateEmbedding` (src/ai/embedding/embedding-client.ts) tries Gemini
 * `gemini-embedding-001` (768 dims) and, when Gemini answers non-OK, returns
 * no values or throws (timeout included), falls back to Ollama
 * `nomic-embed-text`. When both fail it throws
 * `EMBEDDING_UNAVAILABLE_MESSAGE`.
 *
 * `id` / `model` describe the primary (Gemini). The model that actually
 * produced a vector is only known per call, so callers that store or compare
 * vectors must use `embedDetailed` (via `embedWithModel`), which is what
 * MemoryService does.
 */
export class FallbackEmbeddingProvider implements IEmbeddingProvider {
  public readonly id = "gemini" as const;
  public readonly model = GEMINI_EMBEDDING_MODEL;
  public readonly dimension = EMBEDDING_DIMENSION;

  private readonly geminiApiKey: string;
  private readonly ollamaUrl: string;
  private readonly fetchFn?: EmbeddingFetch;
  private readonly timeoutMs: number;
  private readonly onGeminiError: (error: GeminiEmbeddingError) => void;

  constructor(options: FallbackEmbeddingProviderOptions = {}) {
    this.geminiApiKey = (options.geminiApiKey || "").trim();
    this.ollamaUrl = (options.ollamaUrl || "").trim();
    this.fetchFn = options.fetchFn;
    this.timeoutMs = options.timeoutMs ?? EMBEDDING_TIMEOUT_MS;
    this.onGeminiError = options.onGeminiError ?? ((error) => {
      // Never log the request URL: it carries the key.
      const detail = error.kind === "http" ? `HTTP ${error.status}` : errorMessage(error.error);
      console.warn(`[FallbackEmbeddingProvider] Gemini embedding failed (${detail}); trying Ollama.`);
    });
  }

  public isConfigured(): boolean {
    return Boolean(this.geminiApiKey) || this.ollamaConfigured();
  }

  private ollamaConfigured(): boolean {
    return Boolean(this.ollamaUrl) && !this.ollamaUrl.includes("placeholder");
  }

  public async embedDetailed(text: string, options?: EmbeddingOptions): Promise<DetailedEmbedding> {
    if (!text || !text.trim()) {
      throw new Error("[FallbackEmbeddingProvider] Cannot embed empty text.");
    }
    const result = await generateEmbedding(text, {
      geminiApiKey: this.geminiApiKey,
      ollamaUrl: this.ollamaUrl,
      fetchFn: this.fetchFn,
      timeoutMs: options?.timeoutMs ?? this.timeoutMs,
      onGeminiError: this.onGeminiError
    });
    return {
      values: result.values,
      model: result.model,
      provider: result.model === GEMINI_EMBEDDING_MODEL ? "gemini" : "ollama"
    };
  }

  public async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    return (await this.embedDetailed(text, options)).values;
  }

  /**
   * Sequential single embeds. Each text may land on a different model, so
   * callers that store vectors should use `embedDetailed` per text instead.
   */
  public async embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text, options));
    }
    return results;
  }
}
