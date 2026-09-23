import { IEmbeddingProvider } from "./types.js";
import { OllamaEmbeddingProvider } from "./ollama-embedding-provider.js";
import { GeminiEmbeddingProvider } from "./gemini-embedding-provider.js";
import { MockEmbeddingProvider } from "./mock-embedding-provider.js";
import { FallbackEmbeddingProvider } from "./fallback-embedding-provider.js";
import { GEMINI_EMBEDDING_MODEL } from "./embedding-client.js";
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

  if (config.provider === "gemini") {
    // Production's path (shared generateEmbedding): Gemini gemini-embedding-001,
    // then Ollama nomic-embed-text when an Ollama URL is explicitly configured
    // (EMBEDDING_BASE_URL or OLLAMA_BASE_URL). Each vector records the model
    // that produced it (embedDetailed). generateEmbedding pins its models, so
    // a custom EMBEDDING_MODEL keeps the plain Gemini provider (no fallback).
    const geminiApiKey = (process.env.GEMINI_API_KEY || "").trim();
    const ollamaUrl = (process.env.EMBEDDING_BASE_URL || process.env.OLLAMA_BASE_URL || "").trim();
    if (config.model === GEMINI_EMBEDDING_MODEL) {
      const fallback = new FallbackEmbeddingProvider({ geminiApiKey, ollamaUrl, timeoutMs: config.timeoutMs });
      if (fallback.isConfigured()) {
        cachedProvider = fallback;
        return cachedProvider;
      }
    } else {
      const gemini = new GeminiEmbeddingProvider();
      if (gemini.isConfigured()) {
        cachedProvider = gemini;
        return cachedProvider;
      }
    }
    console.warn("[EmbeddingFactory] Neither GEMINI_API_KEY nor an Ollama URL is configured, falling back to mock embedding provider.");
  }

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
