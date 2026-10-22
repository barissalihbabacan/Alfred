import { describe, it, expect } from "vitest";
import {
  FALLBACK_EXHAUSTED_NOTE,
  classifyChatFailure,
  createProviderHttpError,
  decideFailover,
  pickFinalChatError,
  toChatTurnErrorEvent,
  type ChatFailureKind
} from "../../src/ai/providers/chat-fallback/failover.js";
import {
  computeRateLimitWait,
  createRateLimitedError,
  parseRateLimitInfo,
  rateLimitUserMessage,
  toChatErrorEvent,
  turkishGenitiveSuffix
} from "../../src/ai/providers/groq/rate-limit.js";
import { GROQ_TPD_429, GROQ_TPM_429 } from "./fixtures/chat-provider-streams.js";

const timeoutError = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

describe("classifyChatFailure", () => {
  it.each<[string, unknown, ChatFailureKind, number | undefined]>([
    ["rate-limit give-up", createRateLimitedError("x", "daily_limit", { limitType: "tpd", retryAfterMs: 1 }), "rate_limited", 429],
    ["plain 429", createProviderHttpError("Gemini", 429, "quota"), "rate_limited", 429],
    ["500", createProviderHttpError("Groq", 500, "boom"), "server_error", 500],
    ["503", createProviderHttpError("Groq", 503, "over capacity"), "server_error", 503],
    ["400", createProviderHttpError("Gemini", 400, "bad request"), "client_error", 400],
    ["401", createProviderHttpError("Gemini", 401, "no auth"), "client_error", 401],
    ["402", createProviderHttpError("Gemini", 402, "payment_required"), "client_error", 402],
    ["404 (unknown model)", createProviderHttpError("Gemini", 404, "model not found"), "client_error", 404],
    ["fetch failed", new TypeError("fetch failed"), "network_error", undefined],
    ["body terminated", new TypeError("terminated"), "network_error", undefined],
    ["ECONNRESET", Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }), "network_error", undefined],
    ["timeout", timeoutError(), "timeout", undefined],
    ["abort", Object.assign(new Error("aborted"), { name: "AbortError" }), "timeout", undefined],
    ["stream error", Object.assign(new Error("Alfred yanıtı tamamlayamadı."), { code: "stream_error" }), "stream_error", undefined],
    ["empty answer", Object.assign(new Error("boş"), { code: "empty_response" }), "empty_response", undefined],
    ["a bug", new RangeError("x is not a function"), "unknown", undefined]
  ])("%s -> %s", (_label, err, kind, status) => {
    const failure = classifyChatFailure(err);
    expect(failure.kind).toBe(kind);
    expect(failure.status).toBe(status);
  });
});

describe("failover decision matrix", () => {
  // The Groq 429s from production: TPM with a 2.4 s hint fits the 25 s budget, TPD never does.
  const tpm = parseRateLimitInfo(null, GROQ_TPM_429.error.message);
  const tpd = parseRateLimitInfo(null, GROQ_TPD_429.error.message);

  it("waits out a TPM 429 that fits the budget (no failover yet)", () => {
    expect(computeRateLimitWait({ info: tpm, attempt: 1, spentMs: 0 })).toEqual({ retry: true, decision: "wait", waitMs: 3000 });
  });

  it("fails over on a TPD 429 at once, and on a TPM 429 once the budget is spent", () => {
    const daily = computeRateLimitWait({ info: tpd, attempt: 1, spentMs: 0 });
    expect(daily).toMatchObject({ retry: false, reason: "daily_limit" });
    const late = computeRateLimitWait({ info: tpm, attempt: 2, spentMs: 23_000 });
    expect(late).toMatchObject({ retry: false, reason: "budget_exhausted" });
    for (const reason of ["daily_limit", "budget_exhausted", "max_attempts"] as const) {
      const err = createRateLimitedError("x", reason, tpd);
      expect(decideFailover({ failure: classifyChatFailure(err), streamedToUser: false, hasNextProvider: true }))
        .toEqual({ failover: true, reason: "rate_limited", severity: "WARNING" });
    }
  });

  it.each<[string, unknown, string, "WARNING" | "ERROR"]>([
    ["5xx", createProviderHttpError("Groq", 502, ""), "server_error", "WARNING"],
    ["network", new TypeError("fetch failed"), "network_error", "WARNING"],
    ["timeout", timeoutError(), "timeout", "WARNING"],
    ["stream error", Object.assign(new Error("x"), { code: "stream_error" }), "stream_error", "WARNING"],
    ["4xx other than 429 (logged as ERROR)", createProviderHttpError("Gemini", 400, "bad"), "client_error", "ERROR"]
  ])("fails over on %s while nothing was streamed", (_label, err, reason, severity) => {
    expect(decideFailover({ failure: classifyChatFailure(err), streamedToUser: false, hasNextProvider: true }))
      .toEqual({ failover: true, reason, severity });
  });

  it("never switches once partial text reached the user", () => {
    for (const err of [createProviderHttpError("Groq", 500, ""), Object.assign(new Error("x"), { code: "stream_error" }), new TypeError("terminated")]) {
      expect(decideFailover({ failure: classifyChatFailure(err), streamedToUser: true, hasNextProvider: true }))
        .toEqual({ failover: false, why: "partial_output" });
    }
  });

  it("stops on the last provider, on an empty answer and on unknown errors", () => {
    expect(decideFailover({ failure: { kind: "server_error", status: 500 }, streamedToUser: false, hasNextProvider: false }))
      .toEqual({ failover: false, why: "no_next_provider" });
    expect(decideFailover({ failure: { kind: "empty_response" }, streamedToUser: false, hasNextProvider: true }))
      .toEqual({ failover: false, why: "not_retryable" });
    expect(decideFailover({ failure: { kind: "unknown" }, streamedToUser: false, hasNextProvider: true }))
      .toEqual({ failover: false, why: "not_retryable" });
  });
});

describe("final error of a turn", () => {
  it("prefers the first rate-limit error (it has a retry hint), else the last error", () => {
    const rl = createRateLimitedError("x", "daily_limit", { limitType: "tpd", retryAfterMs: 199_152 });
    const e500 = createProviderHttpError("Groq", 500, "");
    const e401 = createProviderHttpError("Gemini", 401, "");
    expect(pickFinalChatError([rl, e500, e401])).toBe(rl);
    expect(pickFinalChatError([e500, e401])).toBe(e401);
  });

  it("adds a note when every provider failed; Groq-only turns keep the old event", () => {
    const rl = createRateLimitedError("x", "daily_limit", { limitType: "tpd", retryAfterMs: 199_152 });
    expect(toChatTurnErrorEvent(rl)).toEqual(toChatErrorEvent(rl));
    const exhausted = Object.assign(createRateLimitedError("x", "daily_limit", { limitType: "tpd", retryAfterMs: 199_152 }), {
      attemptedProviders: ["groq", "gemini"]
    });
    expect(toChatTurnErrorEvent(exhausted)).toEqual({
      type: "error",
      error: `Groq'un günlük token limiti doldu. Lütfen yaklaşık 3 dakika sonra tekrar deneyin. ${FALLBACK_EXHAUSTED_NOTE}`,
      code: "rate_limited",
      limitType: "tpd",
      retryAfterMs: 199_152,
      attemptedProviders: ["groq", "gemini"]
    });
    const plain = Object.assign(new Error("Gemini API error (401): x"), { attemptedProviders: ["groq", "gemini"] });
    expect(toChatTurnErrorEvent(plain).error).toBe(`Gemini API error (401): x ${FALLBACK_EXHAUSTED_NOTE}`);
    expect(toChatTurnErrorEvent(null)).toEqual({ type: "error", error: "LLM provider temporarily unavailable." });
  });

  it("names the provider in a non-Groq rate-limit message", () => {
    const err = createRateLimitedError("x", "max_attempts", { limitType: "rpm", retryAfterMs: 12_000 }, "Gemini");
    expect(err.message).toBe("Gemini API error (429): x");
    expect(toChatErrorEvent(err).error).toBe("Gemini'nin dakikalık istek limiti doldu. Lütfen ~12 sn sonra tekrar deneyin.");
    expect(rateLimitUserMessage("unknown", null, "Gemini")).toBe("Gemini kullanım sınırına ulaşıldı. Lütfen biraz sonra tekrar deneyin.");
    expect(rateLimitUserMessage("tpd", null, "Gemini")).toBe("Gemini'nin günlük token limiti doldu. Lütfen biraz sonra tekrar deneyin.");
    expect(createRateLimitedError("x", "max_attempts", { limitType: "tpm", retryAfterMs: 1 })).not.toHaveProperty("providerLabel");
  });

  it("builds Turkish genitive suffixes for provider names", () => {
    expect(["Groq", "Gemini"].map((n) => n + turkishGenitiveSuffix(n))).toEqual([
      "Groq'un", "Gemini'nin"
    ]);
  });
});
