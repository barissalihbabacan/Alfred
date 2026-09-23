import { IEmbeddingProvider, EmbeddingOptions } from "./types.js";
import { EmbeddingConfig, getMemoryConfig } from "../../core/config/index.js";
import { isAbortError } from "../../core/errors/index.js";
import { buildOllamaEmbedRequest } from "./embedding-client.js";

export interface OllamaEmbeddingProviderOptions {
  config?: Partial<EmbeddingConfig>;
  fetchFn?: typeof fetch;
}

/**
 * OllamaEmbeddingProvider
 *
 * Connects to Ollama's embeddings endpoint (/api/embed or /api/embeddings)
 * using an environment-driven configuration completely separate from chat models.
 */
export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  public readonly id = "ollama" as const;
  public readonly model: string;
  public readonly dimension: number;

  private baseUrl: string;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options?: OllamaEmbeddingProviderOptions) {
    const memoryConfig = getMemoryConfig().embedding;
    const config = {
      ...memoryConfig,
      ...options?.config
    };

    this.model = config.model;
    this.dimension = config.dimension;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs;
    this.fetchFn = options?.fetchFn || globalThis.fetch;
  }

  public isConfigured(): boolean {
    return Boolean(this.baseUrl && this.baseUrl.trim().length > 0 && this.model && this.model.trim().length > 0);
  }

  public async embed(text: string, options?: EmbeddingOptions): Promise<number[]> {
    if (!text || !text.trim()) {
      throw new Error("[OllamaEmbeddingProvider] Cannot embed empty text.");
    }

    const batch = await this.embedBatch([text], options);
    if (!batch || batch.length === 0 || !batch[0]) {
      throw new Error("[OllamaEmbeddingProvider] Failed to generate embedding: empty response.");
    }

    return batch[0];
  }

  public async embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    const model = options?.model || this.model;
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // 1. Attempt /api/embed (modern Ollama multi-input API)
      const request = buildOllamaEmbedRequest(this.baseUrl, texts.length === 1 ? texts[0] : texts, model);
      try {
        const res = await this.fetchFn(request.url, { ...request.init, signal: controller.signal });

        if (res.ok) {
          const data = (await res.json()) as { embeddings?: number[][] };
          if (Array.isArray(data.embeddings) && data.embeddings.length > 0) {
            return data.embeddings;
          }
        }
      } catch (err: unknown) {
        if (isAbortError(err)) {
          throw new Error(`[OllamaEmbeddingProvider] Embedding generation timed out after ${timeoutMs}ms.`);
        }
        // Fall back to /api/embeddings for legacy Ollama or single queries
      }

      // 2. Fallback to /api/embeddings sequentially for older Ollama versions
      const legacyUrl = `${this.baseUrl}/api/embeddings`;
      const results: number[][] = [];

      for (const text of texts) {
        const res = await this.fetchFn(legacyUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            prompt: text
          }),
          signal: controller.signal
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(
            `[OllamaEmbeddingProvider] Ollama API error HTTP ${res.status}: ${errText || res.statusText}`
          );
        }

        const data = (await res.json()) as { embedding?: number[] };
        if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
          throw new Error(`[OllamaEmbeddingProvider] Missing embedding array in Ollama response.`);
        }

        results.push(data.embedding);
      }

      return results;
    } catch (err: unknown) {
      if (isAbortError(err)) {
        throw new Error(`[OllamaEmbeddingProvider] Embedding generation timed out after ${timeoutMs}ms.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
