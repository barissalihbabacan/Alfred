/**
 * When a failed chat turn moves on to the next provider.
 *
 * Pure and dependency-free (bundled into functions/index.js).
 *
 * The rule: a turn switches providers only while nothing has reached the user
 * yet (no `chunk` event sent in this turn). Once partial text is on screen,
 * switching would produce a second, different answer glued onto the first, so
 * the turn fails as before and the partial text is saved as `interrupted`.
 *
 * With nothing streamed yet, these failures move on:
 *   rate_limited  a 429 the per-turn wait budget cannot cover (incl. daily limits)
 *   server_error  HTTP 5xx
 *   network_error fetch/stream I/O failure (DNS, reset, "fetch failed", "terminated")
 *   timeout       the per-call timeout fired
 *   stream_error  an `{"error": …}` object inside a 200 stream
 *   client_error  any other 4xx (bad key, unknown model, bad request): the next
 *                 provider may well work, but this is a configuration problem,
 *                 so it is logged at ERROR severity
 * These never move on: an empty final answer (`empty_response`) and anything
 * unrecognised (a bug would just repeat on every provider).
 */

import { isRateLimitedError, toChatErrorEvent, type ChatErrorEvent } from "../groq/rate-limit.js";

export type FailoverReason =
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "timeout"
  | "stream_error"
  | "client_error";

export type ChatFailureKind = FailoverReason | "empty_response" | "unknown";

export interface ChatFailure {
  kind: ChatFailureKind;
  /** HTTP status when the failure was an HTTP response. */
  status?: number;
}

function field(err: unknown, name: string): unknown {
  return typeof err === "object" && err !== null ? (err as Record<string, unknown>)[name] : undefined;
}

/** Classifies an error thrown by one provider call. */
export function classifyChatFailure(err: unknown): ChatFailure {
  const status = field(err, "status");
  const httpStatus = typeof status === "number" && Number.isFinite(status) ? status : undefined;
  if (isRateLimitedError(err)) return { kind: "rate_limited", status: 429 };
  const code = field(err, "code");
  if (code === "stream_error") return { kind: "stream_error" };
  if (code === "empty_response") return { kind: "empty_response" };
  if (httpStatus !== undefined) {
    if (httpStatus === 429) return { kind: "rate_limited", status: httpStatus };
    if (httpStatus >= 500) return { kind: "server_error", status: httpStatus };
    if (httpStatus >= 400) return { kind: "client_error", status: httpStatus };
  }
  const name = field(err, "name");
  if (name === "TimeoutError" || name === "AbortError") return { kind: "timeout" };
  // undici: TypeError("fetch failed") for connection errors, TypeError("terminated")
  // when the body stream breaks; Node system errors carry an errno-style code.
  if (name === "TypeError") return { kind: "network_error" };
  if (typeof code === "string" && /^(ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR)/.test(code)) {
    return { kind: code === "ETIMEDOUT" || code === "UND_ERR_HEADERS_TIMEOUT" ? "timeout" : "network_error" };
  }
  return { kind: "unknown" };
}

export interface FailoverDecisionInput {
  failure: ChatFailure;
  /** True once any `chunk` event has been sent in this turn. */
  streamedToUser: boolean;
  /** True when another configured provider is left to try. */
  hasNextProvider: boolean;
}

export type FailoverDecision =
  | { failover: true; reason: FailoverReason; severity: "WARNING" | "ERROR" }
  | { failover: false; why: "partial_output" | "no_next_provider" | "not_retryable" };

const RETRYABLE = new Set<ChatFailureKind>([
  "rate_limited",
  "server_error",
  "network_error",
  "timeout",
  "stream_error",
  "client_error"
]);

export function decideFailover(input: FailoverDecisionInput): FailoverDecision {
  const { failure, streamedToUser, hasNextProvider } = input;
  if (!RETRYABLE.has(failure.kind)) return { failover: false, why: "not_retryable" };
  if (streamedToUser) return { failover: false, why: "partial_output" };
  if (!hasNextProvider) return { failover: false, why: "no_next_provider" };
  return {
    failover: true,
    reason: failure.kind as FailoverReason,
    severity: failure.kind === "client_error" ? "ERROR" : "WARNING"
  };
}

/** Error for a non-OK HTTP response; `status` drives {@link classifyChatFailure}. */
export function createProviderHttpError(label: string, status: number, body: string): Error & { status: number } {
  return Object.assign(new Error(`${label} API error (${status}): ${String(body || "").slice(0, 500)}`), { status });
}

/**
 * Which error ends a turn after every provider failed: the first rate-limit
 * error if there was one (it carries `code: "rate_limited"` and a retry hint
 * the client can show), otherwise the last error.
 */
export function pickFinalChatError(errors: unknown[]): unknown {
  const rateLimited = errors.find((e) => isRateLimitedError(e));
  return rateLimited ?? errors[errors.length - 1];
}

/** Appended to the error message when every configured provider failed. */
export const FALLBACK_EXHAUSTED_NOTE = "Yedek sağlayıcılar da yanıt veremedi.";

export type ChatTurnErrorEvent = ChatErrorEvent & { attemptedProviders?: string[] };

/**
 * The SSE `error` event that ends a failed turn: {@link toChatErrorEvent}, plus,
 * when the fallback ran out of providers (`attemptedProviders` on the error,
 * set by runChatTurnWithFallback), a note that the backups failed too and the
 * list of providers tried. Groq-only turns get exactly toChatErrorEvent's event.
 */
export function toChatTurnErrorEvent(err: unknown, fallback = "LLM provider temporarily unavailable."): ChatTurnErrorEvent {
  const event = toChatErrorEvent(err, fallback);
  const attempted = field(err, "attemptedProviders");
  if (Array.isArray(attempted) && attempted.length > 1) {
    return { ...event, error: `${event.error} ${FALLBACK_EXHAUSTED_NOTE}`, attemptedProviders: attempted.map(String) };
  }
  return event;
}
