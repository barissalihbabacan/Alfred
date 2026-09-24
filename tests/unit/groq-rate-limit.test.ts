import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  RATE_LIMIT_BODY_HINT_MARGIN_MS,
  RATE_LIMIT_DEFAULT_WAIT_MS,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_MIN_WAIT_MS,
  RATE_LIMIT_TURN_BUDGET_MS,
  classifyRateLimit,
  computeRateLimitWait,
  createRateLimitedError,
  formatTurkishDuration,
  isRateLimitedError,
  parseGroqDurationSeconds,
  parseRateLimitInfo,
  rateLimitUserMessage,
  toChatErrorEvent,
  type RateLimitInfo
} from "../../src/ai/providers/groq/rate-limit.js";

// Shared with production: functions/index.js bundles src/ai/providers/groq/rate-limit.ts.

/** Verbatim `error.message` of the production 429 on 24 Sep 2026, 13:04 UTC. */
const PROD_TPD_429 =
  "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01k5x` service tier `on_demand` " +
  "on tokens per day (TPD): Limit 200000, Used 197637, Requested 2824. Please try again in 3m19.152s. " +
  "Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing";
const TPM_429 =
  "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` " +
  "on tokens per minute (TPM): Limit 8000, Used 7421, Requested 1480. Please try again in 6.6s.";
const RPM_429 =
  "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` " +
  "on requests per minute (RPM): Limit 30, Used 30, Requested 1. Please try again in 450ms.";
const RPD_429 =
  "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` " +
  "on requests per day (RPD): Limit 1000, Used 1000, Requested 1. Please try again in 2h5m.";

const info = (partial: Partial<RateLimitInfo>): RateLimitInfo => ({
  limitType: "tpm",
  retryAfterMs: null,
  retryAfterSource: "none",
  ...partial
});

describe("Groq rate-limit helpers", () => {
  describe("parseGroqDurationSeconds", () => {
    it("parses hour, minute, second and millisecond forms", () => {
      expect(parseGroqDurationSeconds("12.3s")).toBeCloseTo(12.3);
      expect(parseGroqDurationSeconds("450ms")).toBeCloseTo(0.45);
      expect(parseGroqDurationSeconds("1m2.5s")).toBeCloseTo(62.5);
      expect(parseGroqDurationSeconds("3m19.152s")).toBeCloseTo(199.152);
      expect(parseGroqDurationSeconds("2m")).toBe(120);
      expect(parseGroqDurationSeconds("2h5m")).toBe(7500);
      expect(parseGroqDurationSeconds("1h0m30s")).toBe(3630);
    });

    it("returns null for anything else", () => {
      expect(parseGroqDurationSeconds("")).toBeNull();
      expect(parseGroqDurationSeconds("soon")).toBeNull();
      expect(parseGroqDurationSeconds("12")).toBeNull();
      expect(parseGroqDurationSeconds("5s2m")).toBeNull();
    });
  });

  describe("classifyRateLimit", () => {
    it("reads the limit from the 429 body", () => {
      expect(classifyRateLimit(PROD_TPD_429)).toBe("tpd");
      expect(classifyRateLimit(TPM_429)).toBe("tpm");
      expect(classifyRateLimit(RPM_429)).toBe("rpm");
      expect(classifyRateLimit(RPD_429)).toBe("rpd");
    });

    it("accepts the phrase without the abbreviation", () => {
      expect(classifyRateLimit("Rate limit reached on tokens per day. Please try again later.")).toBe("tpd");
      expect(classifyRateLimit("limit on Requests Per Minute")).toBe("rpm");
    });

    it("is unknown for anything else", () => {
      expect(classifyRateLimit("Rate limit reached")).toBe("unknown");
      expect(classifyRateLimit("on audio seconds per hour (ASH)")).toBe("unknown");
      expect(classifyRateLimit(undefined)).toBe("unknown");
    });
  });

  describe("parseRateLimitInfo", () => {
    it("keeps the real, unclamped wait of the production TPD 429", () => {
      expect(parseRateLimitInfo(null, PROD_TPD_429)).toEqual({
        limitType: "tpd",
        retryAfterMs: 199_152,
        retryAfterSource: "message"
      });
    });

    it("parses the other body hints", () => {
      expect(parseRateLimitInfo(null, TPM_429)).toEqual({ limitType: "tpm", retryAfterMs: 6_600, retryAfterSource: "message" });
      expect(parseRateLimitInfo(null, RPM_429)).toEqual({ limitType: "rpm", retryAfterMs: 450, retryAfterSource: "message" });
      expect(parseRateLimitInfo(null, RPD_429)).toEqual({ limitType: "rpd", retryAfterMs: 7_500_000, retryAfterSource: "message" });
      expect(parseRateLimitInfo("", "Please try again in 1m2.5s.").retryAfterMs).toBe(62_500);
    });

    it("prefers a positive numeric retry-after header over the body", () => {
      expect(parseRateLimitInfo("200", PROD_TPD_429)).toEqual({ limitType: "tpd", retryAfterMs: 200_000, retryAfterSource: "header" });
      expect(parseRateLimitInfo(" 14 ", TPM_429)).toEqual({ limitType: "tpm", retryAfterMs: 14_000, retryAfterSource: "header" });
    });

    it("falls back to the body when the header is missing, zero or not a number", () => {
      for (const header of [undefined, null, "", "0", "abc", "-3", "Wed, 24 Sep 2026 13:08:00 GMT"]) {
        expect(parseRateLimitInfo(header, TPM_429)).toEqual({ limitType: "tpm", retryAfterMs: 6_600, retryAfterSource: "message" });
      }
    });

    it("reports no wait when there is no hint", () => {
      expect(parseRateLimitInfo(undefined, undefined)).toEqual({ limitType: "unknown", retryAfterMs: null, retryAfterSource: "none" });
      expect(parseRateLimitInfo("", "Rate limit reached on tokens per minute (TPM)")).toEqual({
        limitType: "tpm",
        retryAfterMs: null,
        retryAfterSource: "none"
      });
    });
  });

  describe("computeRateLimitWait", () => {
    it("gives up at once on the production TPD 429 (no pointless 15 s sleeps)", () => {
      expect(computeRateLimitWait({ info: parseRateLimitInfo(null, PROD_TPD_429), attempt: 1, spentMs: 0 })).toEqual({
        retry: false,
        decision: "give_up",
        reason: "daily_limit",
        waitMs: 0
      });
    });

    it("gives up on any daily limit, however short the wait", () => {
      for (const limitType of ["tpd", "rpd"] as const) {
        expect(
          computeRateLimitWait({ info: info({ limitType, retryAfterMs: 1_000, retryAfterSource: "header" }), attempt: 1, spentMs: 0 })
        ).toMatchObject({ retry: false, reason: "daily_limit" });
      }
    });

    it("gives up at once when a per-minute wait is longer than the budget (e.g. 3m19s)", () => {
      expect(
        computeRateLimitWait({ info: info({ limitType: "tpm", retryAfterMs: 199_152, retryAfterSource: "message" }), attempt: 1, spentMs: 0 })
      ).toEqual({ retry: false, decision: "give_up", reason: "budget_exhausted", waitMs: 0 });
      expect(
        computeRateLimitWait({ info: info({ limitType: "unknown", retryAfterMs: 26_000, retryAfterSource: "header" }), attempt: 1, spentMs: 0 })
      ).toMatchObject({ retry: false, reason: "budget_exhausted" });
    });

    it("waits the real time (plus the margin for a body hint), never clamped down", () => {
      expect(computeRateLimitWait({ info: parseRateLimitInfo(null, TPM_429), attempt: 1, spentMs: 0 })).toEqual({
        retry: true,
        decision: "wait",
        waitMs: 6_600 + RATE_LIMIT_BODY_HINT_MARGIN_MS
      });
      expect(computeRateLimitWait({ info: info({ retryAfterMs: 20_000, retryAfterSource: "header" }), attempt: 1, spentMs: 0 })).toEqual({
        retry: true,
        decision: "wait",
        waitMs: 20_000
      });
    });

    it("waits at least the minimum, and the default without a hint", () => {
      expect(computeRateLimitWait({ info: parseRateLimitInfo(null, RPM_429), attempt: 1, spentMs: 0 })).toEqual({
        retry: true,
        decision: "wait",
        waitMs: RATE_LIMIT_MIN_WAIT_MS
      });
      expect(computeRateLimitWait({ info: info({}), attempt: 1, spentMs: 0 })).toEqual({
        retry: true,
        decision: "wait",
        waitMs: RATE_LIMIT_DEFAULT_WAIT_MS
      });
    });

    it("stops after the last attempt", () => {
      expect(
        computeRateLimitWait({ info: info({ retryAfterMs: 3_000, retryAfterSource: "header" }), attempt: RATE_LIMIT_MAX_ATTEMPTS, spentMs: 0 })
      ).toEqual({ retry: false, decision: "give_up", reason: "max_attempts", waitMs: 0 });
    });

    it("only waits if the wait fits in what is left of the per-turn budget", () => {
      const fifteen = info({ retryAfterMs: 15_000, retryAfterSource: "header" });
      expect(computeRateLimitWait({ info: fifteen, attempt: 1, spentMs: RATE_LIMIT_TURN_BUDGET_MS - 14_999 })).toMatchObject({
        retry: false,
        reason: "budget_exhausted"
      });
      expect(computeRateLimitWait({ info: fifteen, attempt: 1, spentMs: RATE_LIMIT_TURN_BUDGET_MS - 15_000 })).toEqual({
        retry: true,
        decision: "wait",
        waitMs: 15_000
      });
    });

    it("bounds consecutive per-minute 429s (14 s, 15 s, 15 s) to one wait", () => {
      const requested = [14, 15, 15];
      let spent = 0;
      const decisions = [];
      for (const [i, sec] of requested.entries()) {
        const d = computeRateLimitWait({ info: info({ retryAfterMs: sec * 1000, retryAfterSource: "header" }), attempt: i + 1, spentMs: spent });
        decisions.push(d);
        if (!d.retry) break;
        spent += d.waitMs;
      }
      expect(decisions).toEqual([
        { retry: true, decision: "wait", waitMs: 14_000 },
        { retry: false, decision: "give_up", reason: "budget_exhausted", waitMs: 0 }
      ]);
      expect(spent).toBe(14_000);
    });

    it("never waits more than the budget in total, whatever Groq asks for", () => {
      for (const sec of [0, 1, 2.5, 4, 7.7, 12, 15, 24, 30, 199]) {
        for (const retryAfterSource of ["header", "message"] as const) {
          let spent = 0;
          for (let call = 0; call < 3; call++) {
            for (let attempt = 1; attempt <= RATE_LIMIT_MAX_ATTEMPTS; attempt++) {
              const d = computeRateLimitWait({ info: info({ retryAfterMs: sec * 1000, retryAfterSource }), attempt, spentMs: spent });
              if (!d.retry) break;
              spent += d.waitMs;
            }
          }
          expect(spent).toBeLessThanOrEqual(RATE_LIMIT_TURN_BUDGET_MS);
        }
      }
    });
  });

  describe("formatTurkishDuration", () => {
    it("uses seconds under a minute, rounding up", () => {
      expect(formatTurkishDuration(450)).toBe("~1 sn");
      expect(formatTurkishDuration(6_600)).toBe("~7 sn");
      expect(formatTurkishDuration(12_000)).toBe("~12 sn");
      expect(formatTurkishDuration(59_000)).toBe("~59 sn");
    });

    it("uses rounded minutes, then hours", () => {
      expect(formatTurkishDuration(59_600)).toBe("yaklaşık 1 dakika");
      expect(formatTurkishDuration(62_500)).toBe("yaklaşık 1 dakika");
      expect(formatTurkishDuration(199_152)).toBe("yaklaşık 3 dakika");
      expect(formatTurkishDuration(59 * 60_000 + 50_000)).toBe("yaklaşık 1 saat");
      expect(formatTurkishDuration(7_500_000)).toBe("yaklaşık 2 saat 5 dakika");
      expect(formatTurkishDuration(3 * 3_600_000)).toBe("yaklaşık 3 saat");
    });
  });

  describe("user-facing error", () => {
    it("names the limit and the real time", () => {
      expect(rateLimitUserMessage("tpd", 199_152)).toBe(
        "Groq'un günlük token limiti doldu. Lütfen yaklaşık 3 dakika sonra tekrar deneyin."
      );
      expect(rateLimitUserMessage("tpm", 12_000)).toBe("Groq'un dakikalık token limiti doldu. Lütfen ~12 sn sonra tekrar deneyin.");
      expect(rateLimitUserMessage("rpm", 450)).toBe("Groq'un dakikalık istek limiti doldu. Lütfen ~1 sn sonra tekrar deneyin.");
      expect(rateLimitUserMessage("rpd", 7_500_000)).toBe(
        "Groq'un günlük istek limiti doldu. Lütfen yaklaşık 2 saat 5 dakika sonra tekrar deneyin."
      );
      expect(rateLimitUserMessage("unknown", 30_000)).toBe("Groq kullanım sınırına ulaşıldı. Lütfen ~30 sn sonra tekrar deneyin.");
    });

    it("falls back to 'biraz sonra' without a known time", () => {
      expect(rateLimitUserMessage()).toBe("Groq kullanım sınırına ulaşıldı. Lütfen biraz sonra tekrar deneyin.");
      expect(rateLimitUserMessage("unknown", null)).toBe(rateLimitUserMessage());
      expect(rateLimitUserMessage("unknown", 0)).toBe(rateLimitUserMessage());
      expect(rateLimitUserMessage("tpd", null)).toBe("Groq'un günlük token limiti doldu. Lütfen biraz sonra tekrar deneyin.");
    });

    it("turns the production TPD 429 into the right SSE error event", () => {
      const parsed = parseRateLimitInfo(null, PROD_TPD_429);
      const decision = computeRateLimitWait({ info: parsed, attempt: 1, spentMs: 0 });
      expect(decision.retry).toBe(false);
      const err = createRateLimitedError(PROD_TPD_429, decision.retry ? "max_attempts" : decision.reason, parsed);
      expect(isRateLimitedError(err)).toBe(true);
      expect(err).toMatchObject({ status: 429, reason: "daily_limit", limitType: "tpd", retryAfterMs: 199_152 });
      expect(err.message).toContain("Groq API error (429)");
      expect(err.message).toContain("tokens per day");

      const event = toChatErrorEvent(err);
      expect(event).toEqual({
        type: "error",
        error: "Groq'un günlük token limiti doldu. Lütfen yaklaşık 3 dakika sonra tekrar deneyin.",
        code: "rate_limited",
        limitType: "tpd",
        retryAfterMs: 199_152
      });
      expect(JSON.stringify(event)).not.toMatch(/Rate limit reached|org_|TPD|Upgrade|\{"error"/);
    });

    it("omits retryAfterMs from the event when the wait is unknown", () => {
      const err = createRateLimitedError("Rate limit reached", "max_attempts", { limitType: "unknown", retryAfterMs: null });
      expect(err.retryAfterMs).toBeNull();
      expect(toChatErrorEvent(err)).toEqual({
        type: "error",
        error: "Groq kullanım sınırına ulaşıldı. Lütfen biraz sonra tekrar deneyin.",
        code: "rate_limited",
        limitType: "unknown"
      });
    });

    it("truncates the logged detail", () => {
      expect(createRateLimitedError("x".repeat(5000), "max_attempts", info({})).message.length).toBeLessThan(600);
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

  it("parses the real wait and limit type, and decides before sleeping", () => {
    expect(source).toContain('const rateLimitInfo = parseRateLimitInfo(groqRes.headers.get("retry-after"), errBodyMessage);');
    expect(source).toMatch(/computeRateLimitWait\(\{\n\s*info: rateLimitInfo,/);
  });

  it("announces the wait before sleeping and says it resumed afterwards", () => {
    expect(source).toMatch(
      /sendEvent\(\{ type: "rate_limited", provider: "groq", waitMs: decision\.waitMs, attempt: attempts \}\);\n\s*await new Promise\(\(r\) => setTimeout\(r, decision\.waitMs\)\);\n\s*sendEvent\(\{ type: "thinking" \}\);/
    );
  });

  it("charges every wait to the per-turn budget and gives up with the real wait and limit", () => {
    expect(source).toContain("spentMs: llmMetrics.rate_limit_wait_ms");
    expect(source).toContain("llmMetrics.rate_limit_wait_ms += decision.waitMs;");
    expect(source).toMatch(/if \(!decision\.retry\) \{\n\s*throw createRateLimitedError\(errBodyMessage \|\| errText, decision\.reason, rateLimitInfo\);/);
  });

  it("logs the limit type, real wait and decision", () => {
    expect(source).toMatch(
      /event: "llm_rate_limited",[\s\S]{0,200}limit_type: rateLimitInfo\.limitType,\n\s*retry_after_ms: rateLimitInfo\.retryAfterMs,\n\s*decision: decision\.decision,/
    );
  });

  it("logs the limit type on a memory-extraction 429", () => {
    expect(source).toContain('rateLimitFields = { limit_type: info.limitType, retry_after_ms: info.retryAfterMs, decision: "give_up" };');
  });

  it("maps stream failures through toChatErrorEvent", () => {
    expect(source).toContain('sendEvent(toChatErrorEvent(err, "LLM provider temporarily unavailable."));');
    expect(source).not.toMatch(/error: err\?\.message \|\| "LLM provider temporarily unavailable\."/);
  });
});
