import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_MAX_WAIT_MS,
  RATE_LIMIT_MIN_WAIT_MS,
  RATE_LIMIT_TURN_BUDGET_MS,
  computeRateLimitWait,
  createRateLimitedError,
  isRateLimitedError,
  parseGroqDurationSeconds,
  parseRetryAfterSeconds,
  rateLimitUserMessage,
  toChatErrorEvent
} from "../../src/ai/providers/groq/rate-limit.js";

// Shared with production: functions/index.js bundles src/ai/providers/groq/rate-limit.ts.
const RAW_429 =
  "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` " +
  "on tokens per minute (TPM): Limit 8000, Used 7421, Requested 1480. Please try again in 6.6s.";

describe("Groq rate-limit helpers", () => {
  describe("parseGroqDurationSeconds", () => {
    it("parses seconds, milliseconds and minute forms", () => {
      expect(parseGroqDurationSeconds("12.3s")).toBeCloseTo(12.3);
      expect(parseGroqDurationSeconds("450ms")).toBeCloseTo(0.45);
      expect(parseGroqDurationSeconds("1m2.5s")).toBeCloseTo(62.5);
      expect(parseGroqDurationSeconds("2m")).toBe(120);
    });

    it("returns null for anything else", () => {
      expect(parseGroqDurationSeconds("")).toBeNull();
      expect(parseGroqDurationSeconds("soon")).toBeNull();
      expect(parseGroqDurationSeconds("12")).toBeNull();
    });
  });

  describe("parseRetryAfterSeconds", () => {
    it("prefers a positive numeric retry-after header", () => {
      expect(parseRetryAfterSeconds("14", RAW_429)).toBe(14);
    });

    it("falls back to the body hint plus a 0.6 s margin", () => {
      expect(parseRetryAfterSeconds(null, RAW_429)).toBeCloseTo(7.2);
      expect(parseRetryAfterSeconds("0", "Please try again in 1m2s.")).toBeCloseTo(62.6);
      expect(parseRetryAfterSeconds("abc", "try again in 450ms")).toBeCloseTo(1.05);
    });

    it("defaults to 5 s without any hint", () => {
      expect(parseRetryAfterSeconds(undefined, undefined)).toBe(5);
      expect(parseRetryAfterSeconds("", "Rate limit reached")).toBe(5);
    });
  });

  describe("computeRateLimitWait", () => {
    it("clamps the wait to [2.5 s, 15 s]", () => {
      expect(computeRateLimitWait({ retryAfterSec: 0.4, attempt: 1, spentMs: 0 })).toEqual({ retry: true, waitMs: RATE_LIMIT_MIN_WAIT_MS });
      expect(computeRateLimitWait({ retryAfterSec: 40, attempt: 1, spentMs: 0 })).toEqual({ retry: true, waitMs: RATE_LIMIT_MAX_WAIT_MS });
      expect(computeRateLimitWait({ retryAfterSec: 7.2, attempt: 1, spentMs: 0 })).toEqual({ retry: true, waitMs: 7200 });
      expect(computeRateLimitWait({ retryAfterSec: NaN, attempt: 1, spentMs: 0 })).toEqual({ retry: true, waitMs: RATE_LIMIT_MIN_WAIT_MS });
    });

    it("stops after the last attempt", () => {
      expect(computeRateLimitWait({ retryAfterSec: 3, attempt: RATE_LIMIT_MAX_ATTEMPTS, spentMs: 0 })).toEqual({
        retry: false,
        reason: "max_attempts",
        waitMs: 3000
      });
    });

    it("stops when the wait would exceed the per-turn budget", () => {
      expect(computeRateLimitWait({ retryAfterSec: 15, attempt: 1, spentMs: RATE_LIMIT_TURN_BUDGET_MS - 14_999 })).toEqual({
        retry: false,
        reason: "budget_exhausted",
        waitMs: 15_000
      });
      expect(computeRateLimitWait({ retryAfterSec: 15, attempt: 1, spentMs: RATE_LIMIT_TURN_BUDGET_MS - 15_000 })).toEqual({
        retry: true,
        waitMs: 15_000
      });
    });

    it("bounds the 24 Sep production case (14 s, 15 s, 15 s = 44 s of waiting) to one wait", () => {
      // Groq asked for 14 s, then 15 s, then 15 s on consecutive attempts.
      const requested = [14, 15, 15];
      let spent = 0;
      const decisions = [];
      for (const [i, retryAfterSec] of requested.entries()) {
        const d = computeRateLimitWait({ retryAfterSec, attempt: i + 1, spentMs: spent });
        decisions.push(d);
        if (!d.retry) break;
        spent += d.waitMs;
      }
      expect(decisions).toEqual([
        { retry: true, waitMs: 14_000 },
        { retry: false, reason: "budget_exhausted", waitMs: 15_000 }
      ]);
      expect(spent).toBe(14_000);
    });

    it("never waits more than the budget in total, whatever Groq asks for", () => {
      for (const retryAfterSec of [0, 1, 2.5, 4, 7.7, 12, 15, 30]) {
        let spent = 0;
        for (let call = 0; call < 3; call++) {
          for (let attempt = 1; attempt <= RATE_LIMIT_MAX_ATTEMPTS; attempt++) {
            const d = computeRateLimitWait({ retryAfterSec, attempt, spentMs: spent });
            if (!d.retry) break;
            spent += d.waitMs;
          }
        }
        expect(spent).toBeLessThanOrEqual(RATE_LIMIT_TURN_BUDGET_MS);
      }
    });
  });

  describe("user-facing error", () => {
    it("is short Turkish text with an optional wait hint", () => {
      expect(rateLimitUserMessage(6_600)).toBe(
        "Groq kullanım sınırına ulaşıldı (dakikalık token limiti). Lütfen ~7 sn sonra tekrar deneyin."
      );
      expect(rateLimitUserMessage()).toBe(
        "Groq kullanım sınırına ulaşıldı (dakikalık token limiti). Lütfen biraz sonra tekrar deneyin."
      );
      expect(rateLimitUserMessage(0)).toBe(rateLimitUserMessage(null));
    });

    it("keeps the raw provider detail on the error (logs) but not in the SSE event", () => {
      const err = createRateLimitedError(RAW_429, "budget_exhausted", 15_000);
      expect(isRateLimitedError(err)).toBe(true);
      expect(err.message).toContain("Groq API error (429)");
      expect(err.message).toContain("tokens per minute");

      const event = toChatErrorEvent(err);
      expect(event).toEqual({
        type: "error",
        error: "Groq kullanım sınırına ulaşıldı (dakikalık token limiti). Lütfen ~15 sn sonra tekrar deneyin.",
        code: "rate_limited",
        retryAfterMs: 15_000
      });
      expect(JSON.stringify(event)).not.toMatch(/Rate limit reached|org_|TPM|\{"error"/);
    });

    it("truncates the logged detail", () => {
      expect(createRateLimitedError("x".repeat(5000), "max_attempts", 1).message.length).toBeLessThan(600);
    });

    it("leaves other errors in their previous shape", () => {
      expect(toChatErrorEvent(new Error("Groq API error (500): boom"))).toEqual({
        type: "error",
        error: "Groq API error (500): boom"
      });
      expect(toChatErrorEvent(null)).toEqual({ type: "error", error: "LLM provider temporarily unavailable." });
      expect(toChatErrorEvent({ message: "" }, "fallback")).toEqual({ type: "error", error: "fallback" });
    });
  });
});

describe("functions/index.js uses the shared rate-limit helpers", () => {
  const source = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");

  it("imports them from src/ via the bundle", () => {
    expect(source).toContain('from "../src/ai/providers/groq/rate-limit.js";');
  });

  it("announces the wait before sleeping and says it resumed afterwards", () => {
    expect(source).toMatch(
      /sendEvent\(\{ type: "rate_limited", provider: "groq", waitMs: decision\.waitMs, attempt: attempts \}\);\n\s*await new Promise\(\(r\) => setTimeout\(r, decision\.waitMs\)\);\n\s*sendEvent\(\{ type: "thinking" \}\);/
    );
  });

  it("charges every wait to the per-turn budget and gives up with a rate-limit error", () => {
    expect(source).toContain("spentMs: llmMetrics.rate_limit_wait_ms");
    expect(source).toContain("llmMetrics.rate_limit_wait_ms += decision.waitMs;");
    expect(source).toMatch(/if \(!decision\.retry\) \{\n\s*throw createRateLimitedError\(/);
  });

  it("maps stream failures through toChatErrorEvent", () => {
    expect(source).toContain('sendEvent(toChatErrorEvent(err, "LLM provider temporarily unavailable."));');
    expect(source).not.toMatch(/error: err\?\.message \|\| "LLM provider temporarily unavailable\."/);
  });
});
