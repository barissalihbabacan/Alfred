import { IEmbeddingProvider, EmbeddingOptions } from "./types.js";
import { getMemoryConfig, DEFAULT_EMBEDDING_MODEL } from "../../core/config/index.js";
import { isAbortError } from "../../core/errors/index.js";

export interface GeminiEmbeddingProviderOptions {
  apiKey?: string;
  model?: string;
  dimension?: number;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

/**
 * GeminiEmbeddingProvider
 *
 * Connects to Google's Gemini REST API (gemini-embedding-001; text-embedding-004
 * was shut down on 14 Jan 2026). The model defaults to 3072 dimensions, so
 * outputDimensionality pins it to the configured dimension (768). Outputs below
 * 3072 are not normalised, which is fine because retrieval uses cosine similarity.
 */
export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  public readonly id = "gemini" as const;
  public readonly model: string;
  public readonly dimension: number;

  private apiKey: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options?: GeminiEmbeddingProviderOptions) {
    const memoryConfig = getMemoryConfig().embedding;
    this.apiKey = (options?.apiKey || process.env.GEMINI_API_KEY || "").trim();
    this.model = options?.model || (memoryConfig.provider === "gemini" ? memoryConfig.model : DEFAULT_EMBEDDING_MODEL);
    this.dimension = options?.dimension || 768;
    this.timeoutMs = options?.timeoutMs || memoryConfig.timeoutMs || 15000;
    this.fetchFn = options?.fetchFn || globalThis.fetch;
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 0);
  }

  public async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    if (!text || !text.trim()) {
      throw new Error("[GeminiEmbeddingProvider] Cannot embed empty text.");
    }

    if (!this.isConfigured()) {
      throw new Error("[GeminiEmbeddingProvider] GEMINI_API_KEY is not configured.");
    }

    const modelName = options?.model || this.model;
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const cleanModel = modelName.startsWith("models/") ? modelName : `models/${modelName}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/${cleanModel}:embedContent?key=${encodeURIComponent(this.apiKey)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await this.fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: cleanModel,
          content: {
            parts: [{ text: text.trim() }]
          },
          outputDimensionality: this.dimension
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`[GeminiEmbeddingProvider] API error HTTP ${res.status}: ${errText || res.statusText}`);
      }

      const data = (await res.json()) as { embedding?: { values?: number[] } };
      const values = data?.embedding?.values;

      if (!Array.isArray(values) || values.length === 0) {
        throw new Error("[GeminiEmbeddingProvider] Missing embedding values in API response.");
      }

      return values;
    } catch (err: unknown) {
      if (isAbortError(err)) {
        throw new Error(`[GeminiEmbeddingProvider] Embedding generation timed out after ${timeoutMs}ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  public async embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    if (!this.isConfigured()) {
      throw new Error("[GeminiEmbeddingProvider] GEMINI_API_KEY is not configured.");
    }

    const modelName = options?.model || this.model;
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const cleanModel = modelName.startsWith("models/") ? modelName : `models/${modelName}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/${cleanModel}:batchEmbedContents?key=${encodeURIComponent(this.apiKey)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const requests = texts.map(t => ({
        model: cleanModel,
        content: {
          parts: [{ text: t.trim() }]
        },
        outputDimensionality: this.dimension
      }));

      const res = await this.fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`[GeminiEmbeddingProvider] Batch API error HTTP ${res.status}: ${errText || res.statusText}`);
      }

      const data = (await res.json()) as { embeddings?: Array<{ values?: number[] }> };
      if (!Array.isArray(data?.embeddings) || data.embeddings.length === 0) {
        throw new Error("[GeminiEmbeddingProvider] Missing embeddings array in batch response.");
      }

      return data.embeddings.map((item, idx) => {
        if (!Array.isArray(item.values)) {
          throw new Error(`[GeminiEmbeddingProvider] Missing embedding vector at index ${idx}.`);
        }
        return item.values;
      });
    } catch (err: unknown) {
      if (isAbortError(err)) {
        throw new Error(`[GeminiEmbeddingProvider] Batch embedding generation timed out after ${timeoutMs}ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
