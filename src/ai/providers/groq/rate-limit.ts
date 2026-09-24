/**
 * Groq 429 (rate limit) handling for the production chat stream.
 *
 * Pure and dependency-free: bundled into functions/index.js (see CLAUDE.md
 * "Functions bundle"), so nothing here may import config, dotenv or I/O.
 *
 * Groq's free plan caps `openai/gpt-oss-120b` at 8,000 tokens per minute, and a
 * single chat turn can make several model calls (tool rounds). Each 429 says how
 * long to wait (`retry-after` header, or "try again in 12.3s" in the body).
 * Waiting that long up to 3 times per call, across rounds, once left a turn
 * spinning for 46 s before it failed with the raw provider JSON. These helpers
 * bound the total wait per turn and give the user a short message instead.
 */

/** Model calls are retried at most this many times in total (first try included). */
export const RATE_LIMIT_MAX_ATTEMPTS = 3;
/** Shortest wait before a retry, even if Groq asks for less. */
export const RATE_LIMIT_MIN_WAIT_MS = 2_500;
/** Longest single wait before a retry. */
export const RATE_LIMIT_MAX_WAIT_MS = 15_000;
/** Total time one chat turn may spend waiting on 429s, across all calls and tool rounds. */
export const RATE_LIMIT_TURN_BUDGET_MS = 25_000;
/** Assumed wait when Groq gives no hint at all. */
export const RATE_LIMIT_DEFAULT_WAIT_SEC = 5;
/** Safety margin added to the body's "try again in Xs" hint (it is rounded down). */
export const RATE_LIMIT_BODY_HINT_MARGIN_SEC = 0.6;

/** `code` carried by the SSE `error` event (and the thrown error) for rate-limit failures. */
export const RATE_LIMITED_ERROR_CODE = "rate_limited" as const;

/**
 * Parses a Groq duration such as `12.3s`, `450ms`, `1m2.5s` or `2m` into seconds.
 * Returns null for anything else.
 */
export function parseGroqDurationSeconds(text: string): number | null {
  const match = /^\s*(?:(\d+(?:\.\d+)?)m(?!s))?\s*(?:(\d+(?:\.\d+)?)(ms|s))?\s*$/i.exec(text);
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  const minutes = match[1] !== undefined ? Number(match[1]) : 0;
  let seconds = 0;
  if (match[2] !== undefined) {
    seconds = Number(match[2]);
    if (match[3].toLowerCase() === "ms") seconds /= 1000;
  }
  const total = minutes * 60 + seconds;
  return Number.isFinite(total) ? total : null;
}

/**
 * How long Groq asked us to wait, in seconds.
 *
 * 1. A positive numeric `retry-after` header wins (as before).
 * 2. Otherwise the error body's "try again in <duration>" hint, plus a small margin.
 * 3. Otherwise {@link RATE_LIMIT_DEFAULT_WAIT_SEC}.
 */
export function parseRetryAfterSeconds(
  retryAfterHeader: string | null | undefined,
  errorBodyMessage: string | null | undefined
): number {
  const header = retryAfterHeader ? parseFloat(retryAfterHeader) : NaN;
  if (Number.isFinite(header) && header > 0) return header;

  const hint = /try again in\s+((?:\d+(?:\.\d+)?m(?!s))?\s*(?:\d+(?:\.\d+)?(?:ms|s))?)/i.exec(errorBodyMessage || "");
  const hinted = hint && hint[1].trim() ? parseGroqDurationSeconds(hint[1]) : null;
  if (hinted !== null && hinted > 0) return hinted + RATE_LIMIT_BODY_HINT_MARGIN_SEC;

  return RATE_LIMIT_DEFAULT_WAIT_SEC;
}

export interface RateLimitWaitInput {
  /** Wait Groq asked for, in seconds (see {@link parseRetryAfterSeconds}). */
  retryAfterSec: number;
  /** 1-based attempt number of the model call that just got the 429. */
  attempt: number;
  /** Milliseconds this turn has already spent waiting on 429s. */
  spentMs: number;
  maxAttempts?: number;
  budgetMs?: number;
  minWaitMs?: number;
  maxWaitMs?: number;
}

export type RateLimitWaitDecision =
  | { retry: true; waitMs: number }
  | { retry: false; reason: "max_attempts" | "budget_exhausted"; waitMs: number };

/**
 * Decides whether to retry after a 429 and how long to wait first.
 *
 * The wait is the requested time clamped to [minWaitMs, maxWaitMs]. The call is
 * given up (no wait at all) when it has used its attempts, or when that wait
 * would take the turn past its budget: waiting less than Groq asked for would
 * only earn another 429, so it is better to fail fast with a clear message.
 * `waitMs` on a give-up is the wait that was not taken (a hint for the user).
 */
export function computeRateLimitWait(input: RateLimitWaitInput): RateLimitWaitDecision {
  const {
    retryAfterSec,
    attempt,
    spentMs,
    maxAttempts = RATE_LIMIT_MAX_ATTEMPTS,
    budgetMs = RATE_LIMIT_TURN_BUDGET_MS,
    minWaitMs = RATE_LIMIT_MIN_WAIT_MS,
    maxWaitMs = RATE_LIMIT_MAX_WAIT_MS
  } = input;

  const requestedMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : minWaitMs;
  const waitMs = Math.round(Math.min(Math.max(requestedMs, minWaitMs), maxWaitMs));

  if (attempt >= maxAttempts) return { retry: false, reason: "max_attempts", waitMs };
  const spent = Number.isFinite(spentMs) && spentMs > 0 ? spentMs : 0;
  if (spent + waitMs > budgetMs) return { retry: false, reason: "budget_exhausted", waitMs };
  return { retry: true, waitMs };
}

/**
 * The short, user-facing message for a turn that failed on Groq's rate limit.
 * `retryAfterMs` (optional) adds a rough "try again in ~N s" hint.
 * Never contains provider output: the raw 429 body goes to the logs only.
 */
export function rateLimitUserMessage(retryAfterMs?: number | null): string {
  const base = "Groq kullanım sınırına ulaşıldı (dakikalık token limiti).";
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return `${base} Lütfen ~${seconds} sn sonra tekrar deneyin.`;
  }
  return `${base} Lütfen biraz sonra tekrar deneyin.`;
}

/** Error thrown by the chat stream when a turn gives up on Groq's rate limit. */
export interface RateLimitedError extends Error {
  code: typeof RATE_LIMITED_ERROR_CODE;
  status: 429;
  /** Why the retries stopped. */
  reason: "max_attempts" | "budget_exhausted";
  /** Roughly how long until Groq accepts requests again. */
  retryAfterMs: number;
}

/**
 * Builds the error the chat stream throws when it stops retrying a 429.
 * `message` keeps the (truncated) provider detail for logs; clients get
 * {@link toChatErrorEvent}'s friendly text instead.
 */
export function createRateLimitedError(
  detail: string,
  reason: RateLimitedError["reason"],
  retryAfterMs: number
): RateLimitedError {
  const trimmed = String(detail || "").slice(0, 500);
  return Object.assign(new Error(`Groq API error (429): ${trimmed}`), {
    code: RATE_LIMITED_ERROR_CODE,
    status: 429 as const,
    reason,
    retryAfterMs: Math.max(0, Math.round(retryAfterMs))
  });
}

export function isRateLimitedError(err: unknown): err is RateLimitedError {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === RATE_LIMITED_ERROR_CODE;
}

export type ChatErrorEvent =
  | { type: "error"; error: string; code: typeof RATE_LIMITED_ERROR_CODE; retryAfterMs: number }
  | { type: "error"; error: string };

/**
 * The SSE `error` event for a failed chat turn. Rate-limit failures get the
 * friendly message plus `code: "rate_limited"` and `retryAfterMs`; every other
 * error keeps its previous shape (`err.message`, or the fallback).
 */
export function toChatErrorEvent(err: unknown, fallback = "LLM provider temporarily unavailable."): ChatErrorEvent {
  if (isRateLimitedError(err)) {
    return {
      type: "error",
      error: rateLimitUserMessage(err.retryAfterMs),
      code: RATE_LIMITED_ERROR_CODE,
      retryAfterMs: err.retryAfterMs
    };
  }
  const message = typeof err === "object" && err !== null ? (err as { message?: unknown }).message : undefined;
  return { type: "error", error: typeof message === "string" && message ? message : fallback };
}
