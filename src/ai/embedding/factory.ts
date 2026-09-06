import { IEmbeddingProvider } from "./types.js";
import { OllamaEmbeddingProvider } from "./ollama-embedding-provider.js";
import { MockEmbeddingProvider } from "./mock-embedding-provider.js";
import { getMemoryConfig } from "../../core/config/index.js";

let cachedProvider: IEmbeddingProvider | null = null;

/**
 * Returns the active embedding provider singleton based on environment configuration.
 */
export function getEmbeddingProvider(): IEmbeddingProvider {
  if (cachedProvider) {
    return cachedProvider;
  }

  // During Vitest unit tests, default to MockEmbeddingProvider unless live is requested
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    if (process.env.USE_LIVE_EMBEDDING_IN_TESTS !== "true") {
      cachedProvider = new MockEmbeddingProvider();
      return cachedProvider;
    }
  }

  const config = getMemoryConfig().embedding;

  if (config.provider === "ollama") {
    const ollama = new OllamaEmbeddingProvider();
    if (ollama.isConfigured()) {
      cachedProvider = ollama;
      return cachedProvider;
    }
  }

  // Fallback to deterministic local mock provider if Ollama not configured or provider === "mock" | "local"
  cachedProvider = new MockEmbeddingProvider({
    model: config.model || "alfred-local-embed-v1",
    dimension: config.dimension || 768
  });
  return cachedProvider;
}

/**
 * Overrides the active embedding provider (primarily for unit tests).
 */
export function setEmbeddingProvider(provider: IEmbeddingProvider | null): void {
  cachedProvider = provider;
}
