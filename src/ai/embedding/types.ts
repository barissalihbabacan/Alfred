/**
 * Embedding Abstraction for B.U.T.L.E.R. Alfred
 *
 * Minimal contract decoupling semantic vector generation from
 * underlying providers (Ollama, local deterministic, or future models).
 */

export interface EmbeddingOptions {
  model?: string;
  timeoutMs?: number;
}

export interface IEmbeddingProvider {
  /** Provider identifier (e.g. 'ollama', 'local', 'mock') */
  readonly id: string;

  /** Embedding model name (e.g. 'nomic-embed-text', 'all-minilm') */
  readonly model: string;

  /** Output vector dimensionality */
  readonly dimension: number;

  /**
   * Generates an embedding vector for a single text chunk.
   */
  embed(text: string, options?: EmbeddingOptions): Promise<number[]>;

  /**
   * Like `embed`, but also reports which provider/model actually produced the
   * vector. Optional: a provider that can fall back to another model (e.g.
   * `FallbackEmbeddingProvider`, Gemini -> Ollama) must implement it, because
   * vectors from different models must never be compared. Callers go through
   * `embedWithModel`, which falls back to `embed` + `this.model`.
   */
  embedDetailed?(text: string, options?: EmbeddingOptions): Promise<DetailedEmbedding>;

  /**
   * Generates embedding vectors for a batch of text chunks.
   */
  embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]>;

  /**
   * Returns true if the embedding provider is configured and available.
   */
  isConfigured(): boolean;
}

/** A vector together with the provider and model that produced it. */
export interface DetailedEmbedding {
  values: number[];
  /** Model that produced `values`; stored as `embeddingModel`. */
  model: string;
  /** Provider that produced `values` (e.g. 'gemini', 'ollama'); stored as `embeddingProvider`. */
  provider: string;
}

/**
 * Embeds `text` and reports the model that really produced the vector:
 * `embedDetailed` when the provider has it, else `embed` + the provider's
 * static `id` / `model`.
 */
export async function embedWithModel(
  provider: IEmbeddingProvider,
  text: string,
  options?: EmbeddingOptions
): Promise<DetailedEmbedding> {
  if (provider.embedDetailed) {
    return provider.embedDetailed(text, options);
  }
  return { values: await provider.embed(text, options), model: provider.model, provider: provider.id };
}
