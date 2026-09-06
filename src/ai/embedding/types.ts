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
   * Generates embedding vectors for a batch of text chunks.
   */
  embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]>;

  /**
   * Returns true if the embedding provider is configured and available.
   */
  isConfigured(): boolean;
}
