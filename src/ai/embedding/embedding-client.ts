/**
 * Pure embedding client shared by production (functions/index.js, bundled by
 * functions/build.js) and the src/ embedding providers.
 *
 * Deliberately dependency-free: no src/core/config (dotenv), no file reads, no
 * logger. Keys, URLs, fetch and timeouts come in as parameters, and errors the
 * caller may want to log are reported through a callback, so the Cloud
 * Function keeps emitting its own `embedding_error` events.
 */

// text-embedding-004 was shut down on 14 Jan 2026. gemini-embedding-001 returns
// 3072 dimensions by default; the stored schema is 768, so the size is pinned.
// Outputs below 3072 are not normalised, which does not change the result
// because retrieval compares with cosine similarity.
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
export const OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";
export const EMBEDDING_DIMENSION = 768;
export const EMBEDDING_TIMEOUT_MS = 15000;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Minimal fetch signature, so callers and tests can inject their own. */
export type EmbeddingFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface EmbeddingResult {
  values: number[];
  model: string;
}

/** A Gemini failure production logs and then falls back from. */
export type GeminiEmbeddingError =
  | { kind: "http"; model: string; status: number; body: string }
  | { kind: "exception"; model: string; error: unknown };

export interface EmbeddingRequest {
  url: string;
  init: {
    method: "POST";
    headers: { "Content-Type": "application/json" };
    body: string;
  };
}

/** `gemini-embedding-001` and `models/gemini-embedding-001` both give `models/gemini-embedding-001`. */
export function geminiModelPath(model: string): string {
  return model.startsWith("models/") ? model : `models/${model}`;
}

/**
 * Request for Gemini `:embedContent`. The key travels as the `?key=` query
 * parameter; never log the returned URL.
 */
export function buildGeminiEmbedContentRequest(
  text: string,
  apiKey: string,
  model: string = GEMINI_EMBEDDING_MODEL,
  dimension: number = EMBEDDING_DIMENSION
): EmbeddingRequest {
  const modelPath = geminiModelPath(model);
  return {
    url: `${GEMINI_API_BASE}/${modelPath}:embedContent?key=${encodeURIComponent(apiKey)}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelPath,
        content: {
          parts: [{ text: text.trim() }]
        },
        outputDimensionality: dimension
      })
    }
  };
}

/** Request for Ollama `/api/embed`. Trailing slashes on the base URL are dropped. */
export function buildOllamaEmbedRequest(
  baseUrl: string,
  input: string | string[],
  model: string = OLLAMA_EMBEDDING_MODEL
): EmbeddingRequest {
  return {
    url: `${baseUrl.replace(/\/+$/, "")}/api/embed`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input })
    }
  };
}

/** `embedding.values` of a Gemini `:embedContent` response, or null if missing/empty. */
export function parseGeminiEmbedding(data: unknown): number[] | null {
  const values = (data as { embedding?: { values?: unknown } } | null | undefined)?.embedding?.values;
  return Array.isArray(values) && values.length > 0 ? (values as number[]) : null;
}

/**
 * First vector of an Ollama response: `embeddings[0]` (`/api/embed`), else
 * `embedding` (legacy shape), else null. An empty array is accepted, as
 * production always has. A `null` body throws, as production always has.
 */
export function parseOllamaEmbedding(data: unknown): number[] | null {
  const d = data as { embeddings?: Record<number, unknown> | null; embedding?: unknown };
  const first = d.embeddings?.[0];
  if (Array.isArray(first)) return first as number[];
  return Array.isArray(d.embedding) ? (d.embedding as number[]) : null;
}

/**
 * Vectors from different models do not share a space; only records embedded
 * with the same model are compared.
 */
export function isComparableEmbedding(record: { embedding?: unknown; embeddingModel?: unknown }, model: string): boolean {
  return Array.isArray(record.embedding) && record.embedding.length > 0 && record.embeddingModel === model;
}

export const EMBEDDING_UNAVAILABLE_MESSAGE =
  "[Embedding] Neither Gemini nor Ollama could generate embedding (check GEMINI_API_KEY).";

export interface GenerateEmbeddingOptions {
  /** Gemini API key; blank or missing skips Gemini. Trimmed before use. */
  geminiApiKey?: string | null;
  /** Ollama base URL; missing or containing "placeholder" skips Ollama. */
  ollamaUrl?: string | null;
  fetchFn?: EmbeddingFetch;
  timeoutMs?: number;
  /** Called when Gemini answers non-OK or throws, before falling back to Ollama. */
  onGeminiError?: (error: GeminiEmbeddingError) => void;
}

/**
 * Production embedding path: Gemini `gemini-embedding-001` (768 dims), then
 * Ollama `nomic-embed-text`, then throw `EMBEDDING_UNAVAILABLE_MESSAGE`.
 *
 * - Gemini non-OK or exception (including the timeout) → `onGeminiError`, then Ollama.
 * - Gemini OK without values → Ollama, without reporting an error.
 * - Ollama non-OK or without a vector → the final error. An Ollama fetch that
 *   throws (network error, timeout) propagates as is.
 */
export async function generateEmbedding(text: string, options: GenerateEmbeddingOptions = {}): Promise<EmbeddingResult> {
  const fetchFn: EmbeddingFetch = options.fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? EMBEDDING_TIMEOUT_MS;
  const key = (options.geminiApiKey || "").trim();
  const ollamaUrl = options.ollamaUrl;

  if (key) {
    try {
      const request = buildGeminiEmbedContentRequest(text, key);
      const res = await fetchFn(request.url, { ...request.init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) {
        const values = parseGeminiEmbedding(await res.json());
        if (values) {
          return { values, model: GEMINI_EMBEDDING_MODEL };
        }
      } else {
        const body = await res.text().catch(() => "");
        options.onGeminiError?.({ kind: "http", model: GEMINI_EMBEDDING_MODEL, status: res.status, body });
      }
    } catch (error: unknown) {
      options.onGeminiError?.({ kind: "exception", model: GEMINI_EMBEDDING_MODEL, error });
    }
  }

  if (ollamaUrl && !ollamaUrl.includes("placeholder")) {
    const request = buildOllamaEmbedRequest(ollamaUrl, text);
    const res = await fetchFn(request.url, { ...request.init, signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) {
      const vector = parseOllamaEmbedding(await res.json());
      if (vector) {
        return { values: vector, model: OLLAMA_EMBEDDING_MODEL };
      }
    }
  }

  throw new Error(EMBEDDING_UNAVAILABLE_MESSAGE);
}
