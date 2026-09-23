import { IEmbeddingProvider, EmbeddingOptions } from "./types.js";

export interface MockEmbeddingProviderOptions {
  model?: string;
  dimension?: number;
  shouldFail?: boolean;
  failureMessage?: string;
}

/**
 * Deterministic hash function (Murmur/FNV-style 32-bit hash).
 */
function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * MockEmbeddingProvider
 *
 * Provides deterministic, dependency-free semantic embeddings for unit tests
 * and local offline execution. Uses token feature-hashing to ensure semantically
 * similar sentences have measurably high cosine similarity.
 */
export class MockEmbeddingProvider implements IEmbeddingProvider {
  public readonly id = "mock" as const;
  public readonly model: string;
  public readonly dimension: number;

  public shouldFail: boolean;
  public failureMessage: string;

  constructor(options?: MockEmbeddingProviderOptions) {
    this.model = options?.model || "alfred-mock-embed-v1";
    this.dimension = options?.dimension || 768;
    this.shouldFail = options?.shouldFail || false;
    this.failureMessage = options?.failureMessage || "Simulated embedding provider failure";
  }

  public isConfigured(): boolean {
    return true;
  }

  public async embed(text: string, _options?: EmbeddingOptions): Promise<number[]> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    if (!text || !text.trim()) {
      throw new Error("[MockEmbeddingProvider] Cannot embed empty text.");
    }

    const vector = new Array<number>(this.dimension).fill(0);
    const textLower = text
      .toLowerCase()
      .replace(/[^\w\s\u00C0-\u017F\u0100-\u024F\u1E00-\u1EFF]/g, " ");
    const tokens = textLower
      .split(/\s+/)
      .filter((t) => t.length > 0);

    if (tokens.length === 0) {
      vector[0] = 1.0;
      return vector;
    }

    // Word and character 3-gram feature hashing (fast deterministic subword embeddings)
    for (const token of tokens) {
      const idx = hashString(token) % this.dimension;
      vector[idx] += 2.5;

      // Subword 3-grams capture morphological variants (e.g. prefer vs prefers)
      if (token.length >= 3) {
        for (let i = 0; i <= token.length - 3; i++) {
          const gram = token.slice(i, i + 3);
          const gIdx = hashString(gram) % this.dimension;
          vector[gIdx] += 1.0;
        }
      }
    }

    // L2 Normalize
    let sumSq = 0;
    for (let i = 0; i < this.dimension; i++) {
      sumSq += vector[i] * vector[i];
    }

    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) {
        vector[i] = vector[i] / norm;
      }
    } else {
      vector[0] = 1.0;
    }

    return vector;
  }

  public async embedBatch(texts: string[], options?: EmbeddingOptions): Promise<number[][]> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text, options));
    }
    return results;
  }
}
