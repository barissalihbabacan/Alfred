/**
 * Memory-extraction model calls for production: Groq first, then Gemini.
 *
 * Pure and dependency-free (bundled into functions/index.js); fetch, keys,
 * models and the error callback come in as parameters. The Ollama step that
 * follows (when both fail) stays in functions/index.js.
 *
 * Extraction runs after the reply, inside a 10 s budget, and never retries a
 * 429: the answer already went out, so a rate-limited provider just hands the
 * job to the next one.
 */

import { isUsableApiKey } from "./chat-providers.js";
import { parseRateLimitInfo, type RateLimitType } from "../groq/rate-limit.js";

/**
 * Small, cheap Gemini model for the extraction fallback (JSON classification,
 * no tools). Override with GEMINI_EXTRACTION_MODEL.
 */
export const DEFAULT_GEMINI_EXTRACTION_MODEL = "gemini-3.1-flash-lite";
export const DEFAULT_GROQ_EXTRACTION_MODEL = "openai/gpt-oss-20b";

export type ExtractionProviderId = "groq" | "gemini";

export interface ExtractionRequest {
  provider: ExtractionProviderId;
  model: string;
  url: string;
  init: { method: "POST"; headers: Record<string, string>; body: string };
  timeoutMs: number;
}

/** Groq request: exactly the former production call (model, messages, temperature 0.1, json_object). */
export function buildGroqExtractionRequest(apiKey: string, model: string, system: string, user: string): ExtractionRequest {
  return {
    provider: "groq",
    model,
    url: "https://api.groq.com/openai/v1/chat/completions",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      })
    },
    timeoutMs: 20_000
  };
}

/**
 * Gemini request via the OpenAI-compatible endpoint. No response_format: the
 * prompt already asks for JSON and extractJsonPayload() strips fences, so a
 * parameter the endpoint might treat differently is not worth the risk.
 * reasoning_effort "minimal" keeps a flash-lite model's thinking short.
 */
export function buildGeminiExtractionRequest(apiKey: string, model: string, system: string, user: string): ExtractionRequest {
  return {
    provider: "gemini",
    model,
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        temperature: 0.1,
        reasoning_effort: "minimal"
      })
    },
    timeoutMs: 10_000
  };
}

export interface ExtractionProviderError {
  provider: ExtractionProviderId;
  model: string;
  /** HTTP status, or undefined for a thrown fetch/JSON error. */
  httpStatus?: number;
  /** Response body (HTTP errors) or the error message; the caller truncates/logs it. */
  detail: string;
  /** On a 429: the limit and real wait, logged with decision "give_up". */
  rateLimit?: { limitType: RateLimitType; retryAfterMs: number | null };
}

export interface ExtractionCallOptions {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  groqKey?: string | null;
  groqModel?: string;
  geminiKey?: string | null;
  geminiModel?: string;
  system: string;
  user: string;
  onProviderError?: (error: ExtractionProviderError) => void;
}

export interface ExtractionCallResult {
  text: string;
  provider: ExtractionProviderId;
  model: string;
}

/** The extraction requests to try, in order, for the configured keys. */
export function planExtractionRequests(options: Omit<ExtractionCallOptions, "fetch" | "onProviderError">): ExtractionRequest[] {
  const requests: ExtractionRequest[] = [];
  if (isUsableApiKey(options.groqKey)) {
    requests.push(buildGroqExtractionRequest(String(options.groqKey), options.groqModel || DEFAULT_GROQ_EXTRACTION_MODEL, options.system, options.user));
  }
  const geminiModel = options.geminiModel || DEFAULT_GEMINI_EXTRACTION_MODEL;
  if (isUsableApiKey(options.geminiKey) && isUsableApiKey(geminiModel)) {
    requests.push(buildGeminiExtractionRequest(String(options.geminiKey), geminiModel, options.system, options.user));
  }
  return requests;
}

/**
 * Calls Groq, then Gemini, and returns the first non-empty answer, or null
 * when both fail (the caller then tries Ollama). Every failure is reported
 * through `onProviderError`.
 */
export async function callMemoryExtractionProviders(options: ExtractionCallOptions): Promise<ExtractionCallResult | null> {
  for (const request of planExtractionRequests(options)) {
    try {
      const res = await options.fetch(request.url, { ...request.init, signal: AbortSignal.timeout(request.timeoutMs) });
      if (res.ok) {
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === "string" && content) {
          return { text: content, provider: request.provider, model: request.model };
        }
        options.onProviderError?.({ provider: request.provider, model: request.model, httpStatus: res.status, detail: "empty extraction response" });
        continue;
      }
      const errText = await res.text().catch(() => "");
      let rateLimit: ExtractionProviderError["rateLimit"];
      if (res.status === 429) {
        let bodyMessage = "";
        try {
          const parsed: unknown = JSON.parse(errText);
          const obj = Array.isArray(parsed) ? parsed[0] : parsed;
          const message = (obj as { error?: { message?: unknown } } | null)?.error?.message;
          bodyMessage = typeof message === "string" ? message : "";
        } catch { /* not JSON */ }
        const info = parseRateLimitInfo(res.headers.get("retry-after"), bodyMessage);
        rateLimit = { limitType: info.limitType, retryAfterMs: info.retryAfterMs };
      }
      options.onProviderError?.({ provider: request.provider, model: request.model, httpStatus: res.status, detail: errText, rateLimit });
    } catch (err) {
      const message = typeof err === "object" && err !== null ? (err as { message?: unknown }).message : err;
      options.onProviderError?.({ provider: request.provider, model: request.model, detail: String(message || "unknown error") });
    }
  }
  return null;
}
