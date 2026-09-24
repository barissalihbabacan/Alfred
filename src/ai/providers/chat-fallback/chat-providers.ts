/**
 * Production chat providers and their fallback order.
 *
 * Pure and dependency-free: bundled into functions/index.js (see CLAUDE.md
 * "Functions bundle"), so nothing here may import config, dotenv or I/O.
 * Environment values and API keys are passed in by the caller.
 *
 * All four speak the OpenAI Chat Completions wire format (streaming SSE,
 * `tools` in OpenAI function format), so one request builder and one stream
 * parser serve them all:
 *
 *   1. Groq       openai/gpt-oss-120b   (primary; request shape unchanged)
 *   2. Gemini     gemini-3.8-flash      (OpenAI-compatible endpoint, billed per token)
 *   3. Cerebras   gpt-oss-120b          (free tier: 5 requests/min, so a 429 moves on at once)
 *   4. Cerebras   qwen-3.8-27b          (same key; much higher request limits)
 *   5. OpenRouter openai/gpt-oss-120b   (paid model: needs OpenRouter credits)
 *
 * Docs (checked 24 Sep 2026):
 *   Groq       https://console.groq.com/docs/openai
 *   Gemini     https://ai.google.dev/gemini-api/docs/openai
 *   Cerebras   https://inference-docs.cerebras.ai/api-reference/chat-completions
 *              https://inference-docs.cerebras.ai/capabilities/tool-use (both models)
 *              https://inference-docs.cerebras.ai/capabilities/reasoning
 *   OpenRouter https://openrouter.ai/docs/api-reference/overview
 */

export type ChatProviderId = "groq" | "gemini" | "cerebras" | "cerebras_secondary" | "openrouter";

/** Fallback order. Groq stays first; the others are only used when it is unavailable. */
export const CHAT_PROVIDER_ORDER: readonly ChatProviderId[] = [
  "groq",
  "gemini",
  "cerebras",
  "cerebras_secondary",
  "openrouter"
];

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
/**
 * Gemini's current Flash model. The 2.5 models are limited to projects that
 * already used them ("we are limiting access to the 2.5 models to users who
 * have actively used them in the past", Gemini models page), so a 3.x Flash
 * is the safe default. Override with GEMINI_CHAT_MODEL.
 */
export const DEFAULT_GEMINI_CHAT_MODEL = "gemini-3.8-flash";
/** Same family as the primary, so answers stay consistent. */
export const DEFAULT_CEREBRAS_MODEL = "gpt-oss-120b";
/**
 * Second Cerebras model, tried when the first one is rate-limited (gpt-oss-120b
 * allows 5 requests/min on the owner's plan; a tool question takes 2).
 * Cerebras documents tool calling for it; set CEREBRAS_SECONDARY_MODEL=none to skip it.
 */
export const DEFAULT_CEREBRAS_SECONDARY_MODEL = "qwen-3.8-27b";
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-oss-120b";

/** Site and app name OpenRouter asks callers to send (attribution; not auth). */
export const OPENROUTER_REFERER = "https://butler-alfred.web.app";
export const OPENROUTER_APP_TITLE = "B.U.T.L.E.R. Alfred";

export interface ChatProviderConfig {
  id: ChatProviderId;
  /** Human-readable name for logs and the client ("Groq", "Gemini", ...). */
  label: string;
  /** Full chat-completions URL. */
  url: string;
  model: string;
  /** Name of the Secret Manager secret / env var holding the key (never the key). */
  secretName: string;
  /**
   * Extra request-body fields merged after the common ones. Empty for Groq,
   * whose request is pinned byte-for-byte by the tests.
   */
  extraBody: Record<string, unknown>;
  /** Extra headers besides Content-Type and Authorization. */
  extraHeaders: Record<string, string>;
  /** Value of `max_tokens`. */
  maxTokens: number;
  /**
   * Whether a 429 is waited out (within the per-turn budget) before moving on.
   * False when the next provider is a better bet than waiting (Cerebras
   * gpt-oss-120b, then Cerebras qwen).
   */
  waitOnRateLimit: boolean;
}

/** Env values the provider list reads (process.env in production). */
export type ChatProviderEnv = Partial<Record<string, string | undefined>>;

/**
 * True when `key` looks like a configured key. Empty, whitespace and the
 * placeholder values "unset" / "none" (any case) count as unconfigured, so a
 * secret created with a dummy value just to let the deploy bind it is skipped.
 */
export function isUsableApiKey(key: string | null | undefined): boolean {
  if (typeof key !== "string") return false;
  const trimmed = key.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  return lower !== "unset" && lower !== "none";
}

function envModel(env: ChatProviderEnv, name: string, fallback: string): string {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** Configuration of one provider, with models taken from `env` when set. */
export function getChatProviderConfig(id: ChatProviderId, env: ChatProviderEnv = {}): ChatProviderConfig {
  switch (id) {
    case "groq":
      return {
        id,
        label: "Groq",
        url: "https://api.groq.com/openai/v1/chat/completions",
        model: envModel(env, "GROQ_MODEL", DEFAULT_GROQ_MODEL),
        secretName: "GROQ_API_KEY",
        extraBody: {},
        extraHeaders: {},
        maxTokens: 1500,
        waitOnRateLimit: true
      };
    case "gemini":
      return {
        id,
        label: "Gemini",
        url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        model: envModel(env, "GEMINI_CHAT_MODEL", DEFAULT_GEMINI_CHAT_MODEL),
        secretName: "GEMINI_API_KEY",
        // Gemini 3 cannot turn thinking off; "low" keeps latency and cost down.
        // Thinking tokens count against max_tokens, hence the larger cap.
        // include_usage: Gemini only reports usage in the stream when asked.
        extraBody: { reasoning_effort: "low", stream_options: { include_usage: true } },
        extraHeaders: {},
        maxTokens: 4096,
        waitOnRateLimit: true
      };
    case "cerebras":
      return {
        id,
        label: "Cerebras",
        url: "https://api.cerebras.ai/v1/chat/completions",
        model: envModel(env, "CEREBRAS_MODEL", DEFAULT_CEREBRAS_MODEL),
        secretName: "CEREBRAS_API_KEY",
        // stream_options is not documented for Cerebras; its streaming example
        // already carries `usage` in the final chunk, so nothing extra is sent.
        extraBody: {},
        extraHeaders: {},
        maxTokens: 1500,
        // 5 requests/min: waiting ~12 s for the bucket is worse than the qwen step.
        waitOnRateLimit: false
      };
    case "cerebras_secondary":
      return {
        id,
        label: "Cerebras",
        url: "https://api.cerebras.ai/v1/chat/completions",
        model: envModel(env, "CEREBRAS_SECONDARY_MODEL", DEFAULT_CEREBRAS_SECONDARY_MODEL),
        secretName: "CEREBRAS_API_KEY",
        // qwen-3.8-27b reasons at "high" by default and reasoning counts toward
        // max tokens; "low" keeps it quick. Reasoning arrives in delta.reasoning
        // (ignored). gpt-oss accepts "low" too, if the model is overridden.
        extraBody: { reasoning_effort: "low" },
        extraHeaders: {},
        maxTokens: 4096,
        waitOnRateLimit: true
      };
    case "openrouter":
      return {
        id,
        label: "OpenRouter",
        url: "https://openrouter.ai/api/v1/chat/completions",
        model: envModel(env, "OPENROUTER_MODEL", DEFAULT_OPENROUTER_MODEL),
        secretName: "OPENROUTER_API_KEY",
        // Route only to upstream providers that support every parameter sent
        // (i.e. `tools`); usage is always in the final chunk on OpenRouter.
        extraBody: { provider: { require_parameters: true } },
        extraHeaders: {
          "HTTP-Referer": OPENROUTER_REFERER,
          "X-Title": OPENROUTER_APP_TITLE,
          "X-OpenRouter-Title": OPENROUTER_APP_TITLE
        },
        maxTokens: 1500,
        waitOnRateLimit: true
      };
  }
}

/**
 * Parses CHAT_FALLBACK_ORDER (comma-separated provider ids). Unknown ids and
 * duplicates are dropped. Empty or unset → the default order. `"groq"` alone
 * disables fallback.
 */
export function parseChatProviderOrder(value: string | null | undefined): ChatProviderId[] {
  if (typeof value !== "string" || !value.trim()) return [...CHAT_PROVIDER_ORDER];
  const known = new Set<string>(CHAT_PROVIDER_ORDER);
  const out: ChatProviderId[] = [];
  for (const raw of value.split(",")) {
    const id = raw.trim().toLowerCase();
    if (known.has(id) && !out.includes(id as ChatProviderId)) out.push(id as ChatProviderId);
  }
  return out.length > 0 ? out : [...CHAT_PROVIDER_ORDER];
}

export interface ResolvedChatProvider extends ChatProviderConfig {
  apiKey: string;
}

/**
 * The providers to try for one chat turn, in order, with their keys. Providers
 * whose key is not usable ({@link isUsableApiKey}) are left out; `skipped`
 * lists them so the caller can log it. A model set to "none" / "unset" (e.g.
 * CEREBRAS_SECONDARY_MODEL=none) also skips its step. Keys never leave this object except in
 * the Authorization header.
 */
export function resolveChatProviders(
  keys: Partial<Record<Exclude<ChatProviderId, "cerebras_secondary">, string | null | undefined>>,
  env: ChatProviderEnv = {}
): { providers: ResolvedChatProvider[]; skipped: ChatProviderId[] } {
  const providers: ResolvedChatProvider[] = [];
  const skipped: ChatProviderId[] = [];
  for (const id of parseChatProviderOrder(env.CHAT_FALLBACK_ORDER)) {
    const config = getChatProviderConfig(id, env);
    // The secondary Cerebras model shares CEREBRAS_API_KEY.
    const key = id === "cerebras_secondary" ? keys.cerebras : keys[id];
    if (!isUsableApiKey(config.model)) {
      skipped.push(id);
      continue;
    }
    if (!isUsableApiKey(key)) {
      skipped.push(id);
      continue;
    }
    providers.push({ ...config, apiKey: String(key).trim() });
  }
  return { providers, skipped };
}

/** Request headers. For Groq exactly `Content-Type` + `Authorization`, as before. */
export function buildChatRequestHeaders(provider: ChatProviderConfig, apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${apiKey}`,
    ...provider.extraHeaders
  };
}

export interface ChatRequestInput {
  messages: unknown[];
  /** Tool definitions (OpenAI format); omitted from the body when empty/undefined. */
  tools?: unknown[];
}

/**
 * Streaming request body. For Groq it is exactly the former production payload:
 * `{ model, messages, stream: true, temperature: 0.6, max_tokens: 1500, tools? }`
 * in that key order (the tests compare the JSON string).
 */
export function buildChatRequestBody(provider: ChatProviderConfig, input: ChatRequestInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: input.messages,
    stream: true,
    temperature: 0.6,
    max_tokens: provider.maxTokens
  };
  if (input.tools && input.tools.length > 0) body.tools = input.tools;
  for (const [field, value] of Object.entries(provider.extraBody)) body[field] = value;
  return body;
}
