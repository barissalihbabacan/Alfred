/**
 * Groq 429 (rate limit) handling for the production chat stream.
 *
 * Pure and dependency-free: bundled into functions/index.js (see CLAUDE.md
 * "Functions bundle"), so nothing here may import config, dotenv or I/O.
 *
 * Groq's free plan caps `openai/gpt-oss-120b` at 8,000 tokens per minute and
 * 200,000 tokens per day, and a single chat turn can make several model calls
 * (tool rounds). Each 429 says which limit was hit ("... on tokens per day
 * (TPD) ...") and how long to wait (`retry-after` header, or "try again in
 * 3m19.152s" in the body).
 *
 * The flow is: {@link parseRateLimitInfo} reads the real (unclamped) wait and
 * the limit type, {@link computeRateLimitWait} decides *before* sleeping
 * whether that wait fits the turn's budget, and {@link toChatErrorEvent} turns
 * a give-up into a short Turkish message naming the right limit and the real
 * time. Only the parsing of the 429 body is Groq-specific; the decision and
 * the message take a provider-neutral {@link RateLimitInfo}, so another
 * provider can reuse them.
 */

/** Model calls are retried at most this many times in total (first try included). */
export const RATE_LIMIT_MAX_ATTEMPTS = 3;
/** Shortest wait before a retry, even if Groq asks for less. */
export const RATE_LIMIT_MIN_WAIT_MS = 2_500;
/**
 * Total time one chat turn may spend waiting on 429s, across all calls and
 * tool rounds. A wait that does not fit in what is left is not taken at all.
 */
export const RATE_LIMIT_TURN_BUDGET_MS = 25_000;
/** Assumed wait when Groq gives no hint at all. */
export const RATE_LIMIT_DEFAULT_WAIT_MS = 5_000;
/** Safety margin added to the body's "try again in Xs" hint before sleeping (it is rounded down). */
export const RATE_LIMIT_BODY_HINT_MARGIN_MS = 600;

/** `code` carried by the SSE `error` event (and the thrown error) for rate-limit failures. */
export const RATE_LIMITED_ERROR_CODE = "rate_limited" as const;

/**
 * Which limit a 429 was for: tokens per minute / day, requests per minute / day.
 * `unknown` when the body names none of them (or another one, e.g. audio seconds).
 */
export type RateLimitType = "tpm" | "tpd" | "rpm" | "rpd" | "unknown";

/** What a 429 told us, provider-neutral. */
export interface RateLimitInfo {
  limitType: RateLimitType;
  /** The real wait the provider asked for, unclamped; null when it gave no usable hint. */
  retryAfterMs: number | null;
  /** Where `retryAfterMs` came from. */
  retryAfterSource: "header" | "message" | "none";
}

/**
 * Parses a Groq duration such as `12.3s`, `450ms`, `1m2.5s`, `3m19.152s`, `2m`
 * or `2h5m` into seconds. Units must appear in h, m, s/ms order.
 * Returns null for anything else.
 */
export function parseGroqDurationSeconds(text: string): number | null {
  const match = /^\s*(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m(?!s))?(?:(\d+(?:\.\d+)?)(ms|s))?\s*$/i.exec(text);
  if (!match || (match[1] === undefined && match[2] === undefined && match[3] === undefined)) return null;
  const hours = match[1] !== undefined ? Number(match[1]) : 0;
  const minutes = match[2] !== undefined ? Number(match[2]) : 0;
  let seconds = 0;
  if (match[3] !== undefined) {
    seconds = Number(match[3]);
    if (match[4].toLowerCase() === "ms") seconds /= 1000;
  }
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) ? total : null;
}

/** Classifies the limit a 429 body names, e.g. "on tokens per day (TPD)". */
export function classifyRateLimit(errorBodyMessage: string | null | undefined): RateLimitType {
  const text = String(errorBodyMessage || "");
  const code = /\((TPM|TPD|RPM|RPD)\)/i.exec(text);
  if (code) return code[1].toLowerCase() as RateLimitType;
  const phrase = /\b(tokens|requests)\s+per\s+(minute|day)\b/i.exec(text);
  if (phrase) {
    const kind = phrase[1].toLowerCase() === "tokens" ? "t" : "r";
    const period = phrase[2].toLowerCase() === "minute" ? "m" : "d";
    return `${kind}p${period}` as RateLimitType;
  }
  // Gemini names quotas instead ("GenerateRequestsPerDayPerProjectPerModel-FreeTier",
  // "…input_token_count…PerMinute…"); only a daily one changes the decision.
  if (/PerDay|\bper\s+day\b|\bdaily\b/i.test(text)) return /token/i.test(text) ? "tpd" : "rpd";
  return "unknown";
}

/**
 * Reads the limit type and the real wait from a 429.
 *
 * The wait is, in order: a positive numeric `retry-after` header (seconds), else
 * the body's "try again in <duration>" (Groq) or "retry in <duration>" (Gemini)
 * hint, else null. It is never clamped.
 */
export function parseRateLimitInfo(
  retryAfterHeader: string | null | undefined,
  errorBodyMessage: string | null | undefined
): RateLimitInfo {
  const limitType = classifyRateLimit(errorBodyMessage);

  const headerText = typeof retryAfterHeader === "string" ? retryAfterHeader.trim() : "";
  const header = /^\d+(?:\.\d+)?$/.test(headerText) ? Number(headerText) : NaN;
  if (Number.isFinite(header) && header > 0) {
    return { limitType, retryAfterMs: Math.round(header * 1000), retryAfterSource: "header" };
  }

  // Groq: "Please try again in 3m19.152s."; Gemini: "Please retry in 33.52s."
  const hint = /(?:try again|retry) in\s+((?:\d+(?:\.\d+)?(?:h|ms|m|s))+)/i.exec(errorBodyMessage || "");
  const hinted = hint ? parseGroqDurationSeconds(hint[1]) : null;
  if (hinted !== null && hinted > 0) {
    return { limitType, retryAfterMs: Math.round(hinted * 1000), retryAfterSource: "message" };
  }

  return { limitType, retryAfterMs: null, retryAfterSource: "none" };
}

/** True for limits that reset daily: never worth waiting for inside a chat turn. */
export function isDailyRateLimit(limitType: RateLimitType): boolean {
  return limitType === "tpd" || limitType === "rpd";
}

/**
 * Why a 429 is not waited out. `fallback_preferred`: the caller has another
 * provider that is a better bet than waiting (set by the chat fallback, never
 * by {@link computeRateLimitWait}).
 */
export type RateLimitGiveUpReason = "daily_limit" | "max_attempts" | "budget_exhausted" | "fallback_preferred";

export interface RateLimitWaitInput {
  /** What the 429 said (see {@link parseRateLimitInfo}). */
  info: RateLimitInfo;
  /** 1-based attempt number of the model call that just got the 429. */
  attempt: number;
  /** Milliseconds this turn has already spent waiting on 429s. */
  spentMs: number;
  maxAttempts?: number;
  budgetMs?: number;
  minWaitMs?: number;
}

export type RateLimitWaitDecision =
  | { retry: true; decision: "wait"; waitMs: number }
  | { retry: false; decision: "give_up"; reason: RateLimitGiveUpReason; waitMs: 0 };

/**
 * Decides, before sleeping, whether to retry after a 429 and how long to wait.
 *
 * Gives up at once (no sleep) on a daily limit, after the last attempt, or when
 * the real wait (plus a small margin for a body hint, at least `minWaitMs`)
 * does not fit in what is left of the turn's budget: waiting less than the
 * provider asked for would only earn another 429. Otherwise waits exactly that.
 */
export function computeRateLimitWait(input: RateLimitWaitInput): RateLimitWaitDecision {
  const {
    info,
    attempt,
    spentMs,
    maxAttempts = RATE_LIMIT_MAX_ATTEMPTS,
    budgetMs = RATE_LIMIT_TURN_BUDGET_MS,
    minWaitMs = RATE_LIMIT_MIN_WAIT_MS
  } = input;
  const giveUp = (reason: RateLimitGiveUpReason): RateLimitWaitDecision => ({
    retry: false,
    decision: "give_up",
    reason,
    waitMs: 0
  });

  if (isDailyRateLimit(info.limitType)) return giveUp("daily_limit");
  if (attempt >= maxAttempts) return giveUp("max_attempts");

  const real = info.retryAfterMs;
  const requestedMs =
    typeof real === "number" && Number.isFinite(real) && real > 0
      ? real + (info.retryAfterSource === "message" ? RATE_LIMIT_BODY_HINT_MARGIN_MS : 0)
      : RATE_LIMIT_DEFAULT_WAIT_MS;
  const waitMs = Math.round(Math.max(requestedMs, minWaitMs));

  const spent = Number.isFinite(spentMs) && spentMs > 0 ? spentMs : 0;
  if (spent + waitMs > budgetMs) return giveUp("budget_exhausted");
  return { retry: true, decision: "wait", waitMs };
}

/**
 * A wait in Turkish, rounded for a person: "~12 sn" under a minute, then
 * "yaklaşık 3 dakika", "yaklaşık 2 saat 5 dakika".
 */
export function formatTurkishDuration(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `~${seconds} sn`;
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  if (totalMinutes < 60) return `yaklaşık ${totalMinutes} dakika`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `yaklaşık ${hours} saat ${minutes} dakika` : `yaklaşık ${hours} saat`;
}

/**
 * Turkish genitive suffix for a provider name, with the apostrophe:
 * Groq'un, Gemini'nin. Follows the last vowel as
 * pronounced by Turkish speakers (vowel harmony); a final vowel takes "n".
 */
export function turkishGenitiveSuffix(name: string): string {
  const lower = name.toLocaleLowerCase("tr-TR");
  const vowels = lower.match(/[aeıioöuü]/g);
  const last = vowels ? vowels[vowels.length - 1] : "e";
  const harmony: Record<string, string> = { a: "ın", ı: "ın", e: "in", i: "in", o: "un", u: "un", ö: "ün", ü: "ün" };
  const suffix = harmony[last] ?? "in";
  return /[aeıioöuü]$/.test(lower) ? `'n${suffix}` : `'${suffix}`;
}

const LIMIT_LABELS: Record<Exclude<RateLimitType, "unknown">, string> = {
  tpm: "dakikalık token limiti",
  tpd: "günlük token limiti",
  rpm: "dakikalık istek limiti",
  rpd: "günlük istek limiti"
};

/**
 * The short, user-facing message for a turn that failed on Groq's rate limit:
 * which limit, and roughly when to try again (when known).
 * Never contains provider output: the raw 429 body goes to the logs only.
 */
export function rateLimitUserMessage(
  limitType: RateLimitType = "unknown",
  retryAfterMs?: number | null,
  providerLabel = "Groq"
): string {
  const label = providerLabel || "Groq";
  const base = limitType !== "unknown" && LIMIT_LABELS[limitType]
    ? `${label}${turkishGenitiveSuffix(label)} ${LIMIT_LABELS[limitType]} doldu.`
    : `${label} kullanım sınırına ulaşıldı.`;
  if (typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return `${base} Lütfen ${formatTurkishDuration(retryAfterMs)} sonra tekrar deneyin.`;
  }
  return `${base} Lütfen biraz sonra tekrar deneyin.`;
}

/** Error thrown by the chat stream when a turn gives up on Groq's rate limit. */
export interface RateLimitedError extends Error {
  code: typeof RATE_LIMITED_ERROR_CODE;
  status: 429;
  /** Why the retries stopped. */
  reason: RateLimitGiveUpReason;
  /** Which limit was hit. */
  limitType: RateLimitType;
  /** The real time until the provider accepts requests again; null if unknown. */
  retryAfterMs: number | null;
  /** Provider name for the user message ("Groq" unless given). */
  providerLabel?: string;
}

/**
 * Builds the error the chat stream throws when it stops retrying a 429.
 * `message` keeps the (truncated) provider detail for logs; clients get
 * {@link toChatErrorEvent}'s friendly text instead.
 */
export function createRateLimitedError(
  detail: string,
  reason: RateLimitGiveUpReason,
  info: Pick<RateLimitInfo, "limitType" | "retryAfterMs">,
  providerLabel = "Groq"
): RateLimitedError {
  const trimmed = String(detail || "").slice(0, 500);
  const real = info.retryAfterMs;
  const label = providerLabel || "Groq";
  return Object.assign(new Error(`${label} API error (429): ${trimmed}`), {
    code: RATE_LIMITED_ERROR_CODE,
    status: 429 as const,
    reason,
    limitType: info.limitType,
    ...(label !== "Groq" ? { providerLabel: label } : {}),
    retryAfterMs: typeof real === "number" && Number.isFinite(real) && real > 0 ? Math.round(real) : null
  });
}

export function isRateLimitedError(err: unknown): err is RateLimitedError {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === RATE_LIMITED_ERROR_CODE;
}

export type ChatErrorEvent =
  | {
      type: "error";
      error: string;
      code: typeof RATE_LIMITED_ERROR_CODE;
      limitType: RateLimitType;
      /** Present only when the real wait is known. */
      retryAfterMs?: number;
    }
  | { type: "error"; error: string };

/**
 * The SSE `error` event for a failed chat turn. Rate-limit failures get the
 * friendly message plus `code: "rate_limited"`, `limitType` and the real
 * `retryAfterMs` (when known); every other error keeps its previous shape
 * (`err.message`, or the fallback).
 */
export function toChatErrorEvent(err: unknown, fallback = "LLM provider temporarily unavailable."): ChatErrorEvent {
  if (isRateLimitedError(err)) {
    const limitType = err.limitType || "unknown";
    return {
      type: "error",
      error: rateLimitUserMessage(limitType, err.retryAfterMs, err.providerLabel),
      code: RATE_LIMITED_ERROR_CODE,
      limitType,
      ...(typeof err.retryAfterMs === "number" ? { retryAfterMs: err.retryAfterMs } : {})
    };
  }
  const message = typeof err === "object" && err !== null ? (err as { message?: unknown }).message : undefined;
  return { type: "error", error: typeof message === "string" && message ? message : fallback };
}
