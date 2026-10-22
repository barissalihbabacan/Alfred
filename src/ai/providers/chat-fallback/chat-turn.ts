/**
 * One production chat turn over OpenAI-compatible providers, with fallback.
 *
 * Pure orchestration: every side effect (fetch, SSE, sleep, logs, tools,
 * the system prompt) is injected by functions/index.js, so the unit tests
 * drive the whole turn with mocked fetch responses and SSE fixtures.
 *
 * Per provider, in order (chat-providers.ts):
 *   - the tool loop is the former Groq loop: up to `maxTurns` model calls,
 *     tools offered on every call except the last, every tool call answered
 *     through `runTool`, and an `{"error": …}` object in the stream fails the
 *     call (`stream_error`);
 *   - a 429 is waited out only when the wait fits the per-turn budget
 *     (rate-limit.ts, shared across providers); otherwise it gives up at once.
 * When a call fails and failover.ts allows it (nothing streamed to the user
 * yet, another provider left), the whole turn restarts on the next provider
 * from the user's message, with a system prompt rebuilt for that provider.
 *
 * Why restart instead of carrying completed tool rounds over: the tool
 * history is provider-specific. Gemini 3 rejects a prior function call that
 * has no thought signature (400), and Groq's calls never have one; tool-call
 * ids are provider-generated too. The tool is deterministic and cheap, and
 * the restarted prompt also names the provider that really answers.
 */

import {
  buildChatRequestBody,
  buildChatRequestHeaders,
  type ResolvedChatProvider
} from "./chat-providers.js";
import { createOpenAIStreamParser, type StreamUsage } from "./openai-stream.js";
import {
  classifyChatFailure,
  createProviderHttpError,
  decideFailover,
  pickFinalChatError
} from "./failover.js";
import {
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_TURN_BUDGET_MS,
  computeRateLimitWait,
  createRateLimitedError,
  parseRateLimitInfo,
  type RateLimitWaitDecision
} from "../groq/rate-limit.js";
import {
  linkWebSearchCitations,
  type WebSearchResultItem
} from "../../tools/web/web-search.js";

export type LogSeverity = "INFO" | "WARNING" | "ERROR";

/** Metrics of one turn; functions/index.js logs them as the `llm_request` event. */
export interface ChatTurnMetrics {
  provider: string;
  model: string;
  llm_calls: number;
  tool_rounds: number;
  tool_calls: number;
  rate_limit_retries: number;
  rate_limit_wait_ms: number;
  time_to_first_token_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  reasoning_tokens: number | null;
  /** Providers the turn moved away from, in order. */
  fallback_from: string[];
  /** Every provider this turn tried, in order (the last one answered or failed last). */
  attempted_providers: string[];
}

/** Mutable turn state, read by the caller's error handler. */
export interface ChatTurnState {
  /** Text of the answering round shown to the user; reset after each tool round. */
  accumulatedText: string;
  /** True once a `chunk` event was sent in this turn (then no provider switch). */
  streamedToUser: boolean;
  /** Provider currently (or last) answering. */
  providerId: string | null;
  model: string | null;
}

export function createChatTurnState(): ChatTurnState {
  return { accumulatedText: "", streamedToUser: false, providerId: null, model: null };
}

export function createChatTurnMetrics(provider: string, model: string): ChatTurnMetrics {
  return {
    provider,
    model,
    llm_calls: 0,
    tool_rounds: 0,
    tool_calls: 0,
    rate_limit_retries: 0,
    rate_limit_wait_ms: 0,
    time_to_first_token_ms: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    reasoning_tokens: null,
    fallback_from: [],
    attempted_providers: []
  };
}

/** Adds one call's usage to the turn totals (fields a provider leaves out stay as they are). */
export function addUsageToMetrics(metrics: ChatTurnMetrics, usage: StreamUsage | null | undefined): void {
  if (!usage || typeof usage !== "object") return;
  const pairs: Array<[keyof ChatTurnMetrics, unknown]> = [
    ["prompt_tokens", usage.prompt_tokens],
    ["completion_tokens", usage.completion_tokens],
    ["total_tokens", usage.total_tokens],
    ["reasoning_tokens", usage.completion_tokens_details?.reasoning_tokens]
  ];
  for (const [field, value] of pairs) {
    if (typeof value === "number") {
      const current = metrics[field];
      (metrics as unknown as Record<string, number>)[field] = (typeof current === "number" ? current : 0) + value;
    }
  }
}

export type ChatFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface ChatTurnDeps {
  /** Providers to try, in order, with usable keys (resolveChatProviders). */
  providers: ResolvedChatProvider[];
  /** Messages for a fresh turn on `provider`: its system prompt, history, the user message. */
  buildMessages: (provider: { id: string; model: string }) => unknown[];
  /** Tool definitions (OpenAI format), offered on every call except the last. */
  tools: unknown[];
  maxTurns: number;
  /**
   * Tools after which the next round is the final one (no tools offered), so
   * the model answers from what it got. web_search: a second search round
   * resends the prompt with both result sets and blew Groq's 8,000 tokens/min
   * on one question (live, 28 Sep).
   */
  finalRoundAfter?: readonly string[];
  /** Runs one tool call; may be async (web_search). A thrown error becomes `{ error }` for the model. */
  runTool: (name: string, args: unknown) => unknown | Promise<unknown>;
  fetch: ChatFetch;
  sendEvent: (event: Record<string, unknown>) => void;
  sleep: (ms: number) => Promise<void>;
  logEvent: (severity: LogSeverity, event: string, message: string, fields: Record<string, unknown>) => void;
  metrics: ChatTurnMetrics;
  state: ChatTurnState;
  /** Called on the first content or tool-call delta of the turn (TTFT). */
  onFirstToken?: () => void;
  /** Called for a data line that is not valid JSON. */
  onParseError?: (provider: string, error: unknown) => void;
  /** Per-call timeout (fetch and body). */
  timeoutMs?: number;
  /** Monotonic clock in ms for tool durations (performance.now in production). */
  clock?: () => number;
}

export interface ChatTurnOutcome {
  providerId: string;
  model: string;
}

/** The error message when no provider has a usable key (the former Groq-only message). */
export const NO_PROVIDER_CONFIGURED_MESSAGE = "GROQ_API_KEY is not configured in Cloud Functions environment.";

function errorBodyMessage(errText: string): string {
  try {
    const parsed: unknown = JSON.parse(errText);
    // Gemini's OpenAI endpoint may wrap the error in an array.
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    const message = (obj as { error?: { message?: unknown } } | null)?.error?.message;
    return typeof message === "string" ? message : "";
  } catch {
    return "";
  }
}

function shortError(err: unknown): string {
  const message = typeof err === "object" && err !== null ? (err as { message?: unknown }).message : err;
  return String(message || "unknown error").slice(0, 300);
}

/** One model call: POST with the shared 429 policy; returns the OK response or throws. */
async function postWithRateLimit(
  deps: ChatTurnDeps,
  provider: ResolvedChatProvider,
  body: string,
  round: number,
  hasNextProvider: boolean
): Promise<Response> {
  const { metrics } = deps;
  const timeoutMs = deps.timeoutMs ?? 60_000;
  let attempts = 0;
  let res: Response | undefined;
  metrics.llm_calls++;
  while (attempts < RATE_LIMIT_MAX_ATTEMPTS) {
    attempts++;
    res = await deps.fetch(provider.url, {
      method: "POST",
      headers: buildChatRequestHeaders(provider, provider.apiKey),
      body,
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (res.status === 429) {
      // The 429 body goes to the logs only (it carries no key); the user gets
      // the short message from toChatErrorEvent.
      const errText = await res.text().catch(() => "");
      const detail = errorBodyMessage(errText);
      // Real (unclamped) wait and limit type (TPM/TPD/RPM/RPD).
      const rateLimitInfo = parseRateLimitInfo(res.headers.get("retry-after"), detail);
      // The wait budget is per turn, across tool rounds, retries and providers.
      // A wait that does not fit, or a daily limit: give up without sleeping.
      // A provider marked waitOnRateLimit: false moves on at once while
      // another provider is left.
      const decision: RateLimitWaitDecision = !provider.waitOnRateLimit && hasNextProvider
        ? { retry: false, decision: "give_up", reason: "fallback_preferred", waitMs: 0 }
        : computeRateLimitWait({
          info: rateLimitInfo,
          attempt: attempts,
          spentMs: metrics.rate_limit_wait_ms
        });
      deps.logEvent("WARNING", "llm_rate_limited", decision.retry
        ? `[${provider.label}] Rate limit (429, ${rateLimitInfo.limitType}) hit, waiting ${decision.waitMs}ms before retry ${attempts}...`
        : `[${provider.label}] Rate limit (429, ${rateLimitInfo.limitType}) hit, giving up (${decision.reason}) after ${metrics.rate_limit_wait_ms}ms of waiting`, {
        provider: provider.id,
        model: provider.model,
        limit_type: rateLimitInfo.limitType,
        retry_after_ms: rateLimitInfo.retryAfterMs,
        decision: decision.decision,
        wait_ms: decision.waitMs,
        attempt: attempts,
        round,
        total_wait_ms: metrics.rate_limit_wait_ms,
        budget_ms: RATE_LIMIT_TURN_BUDGET_MS,
        outcome: decision.retry ? "retry" : decision.reason,
        detail: detail.slice(0, 300)
      });
      if (!decision.retry) {
        throw createRateLimitedError(detail || errText, decision.reason, rateLimitInfo, provider.label);
      }
      metrics.rate_limit_retries++;
      metrics.rate_limit_wait_ms += decision.waitMs;
      // Announced before sleeping so the client can count down; "thinking" after.
      deps.sendEvent({ type: "rate_limited", provider: provider.id, waitMs: decision.waitMs, attempt: attempts });
      await deps.sleep(decision.waitMs);
      deps.sendEvent({ type: "thinking" });
      continue;
    }
    break;
  }

  if (!res) throw new Error(`${provider.label} request was not sent.`);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw createProviderHttpError(provider.label, res.status, errText);
  }
  return res;
}

/** The tool loop on one provider. Resolves when the model answered without a tool call. */
async function runOnProvider(deps: ChatTurnDeps, provider: ResolvedChatProvider, hasNextProvider: boolean): Promise<void> {
  const { state, metrics } = deps;
  const clock = deps.clock ?? (() => Date.now());
  const payload: unknown[] = [...deps.buildMessages({ id: provider.id, model: provider.model })];
  const webSearchResults: WebSearchResultItem[] = [];
  let toolTurn = 0;

  let finalRound = false;
  while (toolTurn < deps.maxTurns) {
    toolTurn++;
    // Tools stay available on every round except the last: a model that asks
    // for cities one at a time can call again in round two (without tools it
    // called anyway and Groq returned tool_use_failed, 24 Sep). The last round
    // has no tools, so the model must write the answer.
    const tools = deps.tools.length > 0 && toolTurn < deps.maxTurns && !finalRound ? deps.tools : undefined;
    const body = JSON.stringify(buildChatRequestBody(provider, { messages: payload, tools }));
    const res = await postWithRateLimit(deps, provider, body, toolTurn, hasNextProvider);
    const textBeforeRound = state.accumulatedText.length;

    const parser = createOpenAIStreamParser({
      provider: provider.id,
      onParseError: (err) => deps.onParseError?.(provider.id, err)
    });
    const handle = (deltas: ReturnType<typeof parser.push>) => {
      for (const delta of deltas) {
        deps.onFirstToken?.();
        if (delta.type !== "text") continue;
        // Text that arrives after a tool call in the same call is not shown.
        if (delta.toolCallCount === 0) {
          state.accumulatedText += delta.text;
          state.streamedToUser = true;
          deps.sendEvent({ type: "chunk", text: delta.text });
        }
      }
    };

    if (!res.body) throw new TypeError(`${provider.label} returned no response body.`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      handle(parser.push(decoder.decode(value, { stream: true })));
    }
    handle(parser.push(decoder.decode()));
    handle(parser.flush());

    const result = parser.result();
    addUsageToMetrics(metrics, result.usage);

    if (result.error) {
      deps.logEvent("WARNING", "llm_stream_error", `[${provider.label}] Error inside the response stream.`, {
        provider: provider.id,
        model: provider.model,
        round: toolTurn,
        code: String(result.error.code || result.error.type || "unknown").slice(0, 64),
        detail: String(result.error.message || "").slice(0, 200)
      });
      const streamErr = Object.assign(new Error("Alfred yanıtı tamamlayamadı. Lütfen tekrar deneyin."), {
        code: "stream_error"
      });
      throw streamErr;
    }

    const toolCalls = result.toolCalls;
    if (toolCalls.length === 0) {
      if (webSearchResults.length > 0 && state.accumulatedText) {
        state.accumulatedText = linkWebSearchCitations(state.accumulatedText, webSearchResults);
      }
      return;
    }

    if (!tools) {
      // Tool calls on the round that offered no tools. Groq refuses them in
      // the stream (tool_use_failed -> stream_error above); Gemini sends
      // them, and running them would end the turn with no
      // text ("empty_response", which never fails over). Text this round
      // already streamed is the answer; otherwise it is a stream error, so
      // the next provider is tried while nothing has reached the user.
      if (state.accumulatedText.length > textBeforeRound) {
        if (webSearchResults.length > 0 && state.accumulatedText) {
          state.accumulatedText = linkWebSearchCitations(state.accumulatedText, webSearchResults);
        }
        return;
      }
      deps.logEvent("WARNING", "llm_stream_error", `[${provider.label}] Tool call on the last round, where no tools were offered.`, {
        provider: provider.id,
        model: provider.model,
        round: toolTurn,
        code: "tool_call_without_tools",
        detail: ""
      });
      throw Object.assign(new Error("Alfred yanıtı tamamlayamadı. Lütfen tekrar deneyin."), { code: "stream_error" });
    }

    metrics.tool_rounds++;
    if (toolCalls.some((tc) => deps.finalRoundAfter?.includes(tc.function.name))) finalRound = true;
    metrics.tool_calls += toolCalls.length;
    deps.sendEvent({
      type: "tool_call",
      toolCalls: toolCalls.map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }))
    });

    payload.push({
      role: "assistant",
      content: result.text || null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.function.name, arguments: tc.function.arguments },
        // Gemini thought signature: must go back with the call.
        ...(tc.extra_content !== undefined ? { extra_content: tc.extra_content } : {})
      }))
    });

    for (const tc of toolCalls) {
      const fnName = tc.function.name;
      let fnArgs: unknown = tc.function.arguments;
      if (typeof fnArgs === "string") {
        try { fnArgs = JSON.parse(fnArgs); } catch { /* keep the raw string */ }
      }

      const toolStart = clock();
      let toolResult: unknown;
      try {
        toolResult = await deps.runTool(fnName, fnArgs);
      } catch {
        toolResult = { error: `Tool ${String(fnName)} failed.` };
      }
      const toolOk = !(toolResult && typeof toolResult === "object" && (toolResult as { error?: unknown }).error);
      if (toolOk && fnName === "web_search" && toolResult && typeof toolResult === "object") {
        const items = (toolResult as { results?: unknown }).results;
        if (Array.isArray(items)) {
          for (const item of items) {
            if (item && typeof item === "object") webSearchResults.push(item as WebSearchResultItem);
          }
        }
      }
      const toolName = typeof fnName === "string" ? fnName.slice(0, 64) : null;
      // Arguments are never logged; only the tool name.
      deps.logEvent(toolOk ? "INFO" : "WARNING", "tool_call", `Tool ${toolName} ${toolOk ? "ok" : "error"}`, {
        tool: toolName,
        provider: provider.id,
        round: toolTurn,
        outcome: toolOk ? "ok" : "error",
        duration_ms: Math.round(clock() - toolStart)
      });

      deps.sendEvent({ type: "tool_call", tool: fnName, arguments: fnArgs });
      deps.sendEvent({ type: "tool_result", tool: fnName, toolCallId: tc.id, result: toolResult });

      payload.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(toolResult) });
    }

    state.accumulatedText = "";
  }
}

/**
 * Runs the turn: the first provider, then the next ones while failover.ts
 * allows it. Resolves with the provider that answered (its text is
 * `state.accumulatedText`); throws the error that ends the turn. When every
 * provider failed and more than one was tried, that error carries
 * `attemptedProviders` (see toChatTurnErrorEvent).
 */
export async function runChatTurnWithFallback(deps: ChatTurnDeps): Promise<ChatTurnOutcome> {
  const { providers, state, metrics } = deps;
  if (providers.length === 0) throw new Error(NO_PROVIDER_CONFIGURED_MESSAGE);

  const errors: unknown[] = [];
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    state.providerId = provider.id;
    state.model = provider.model;
    metrics.provider = provider.id;
    metrics.model = provider.model;
    metrics.attempted_providers.push(provider.id);

    try {
      await runOnProvider(deps, provider, i < providers.length - 1);
      return { providerId: provider.id, model: provider.model };
    } catch (err) {
      errors.push(err);
      const failure = classifyChatFailure(err);
      const decision = decideFailover({
        failure,
        streamedToUser: state.streamedToUser,
        hasNextProvider: i < providers.length - 1
      });
      if (!decision.failover) {
        const exhausted = decision.why === "no_next_provider";
        const final = exhausted ? pickFinalChatError(errors) : err;
        if (exhausted && metrics.attempted_providers.length > 1 && typeof final === "object" && final !== null) {
          (final as { attemptedProviders?: string[] }).attemptedProviders = [...metrics.attempted_providers];
        }
        throw final;
      }

      const next = providers[i + 1];
      deps.logEvent(decision.severity, "llm_provider_fallback",
        `[LLM] ${provider.label} failed (${decision.reason}${failure.status ? ` ${failure.status}` : ""}), switching to ${next.label}`, {
          from: provider.id,
          from_model: provider.model,
          to: next.id,
          to_model: next.model,
          reason: decision.reason,
          http_status: failure.status ?? null,
          ...(decision.reason === "client_error"
            ? { note: "non-429 4xx: check this provider's key, model id and request" }
            : {}),
          error: shortError(err)
        });
      metrics.fallback_from.push(provider.id);
      deps.sendEvent({ type: "provider_fallback", from: provider.id, to: next.id, model: next.model, reason: decision.reason });
      state.accumulatedText = "";
    }
  }
  // Unreachable: the last provider either answers or throws above.
  throw pickFinalChatError(errors);
}
