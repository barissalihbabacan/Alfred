import { describe, it, expect } from "vitest";
import { formatRateLimitStatus, normalizeRateLimitWaitMs } from "../../apps/web/lib/rate-limit.js";
import { ChatStreamError } from "../../apps/web/lib/api.js";

describe("Web rate-limit status (apps/web/lib/rate-limit.ts)", () => {
  it("counts down in whole seconds, rounding up", () => {
    expect(formatRateLimitStatus(15_000)).toBe("Groq sınırına ulaşıldı, ~15 sn bekleniyor…");
    expect(formatRateLimitStatus(14_001)).toBe("Groq sınırına ulaşıldı, ~15 sn bekleniyor…");
    expect(formatRateLimitStatus(200)).toBe("Groq sınırına ulaşıldı, ~1 sn bekleniyor…");
  });

  it("switches to a retry message once the wait is over", () => {
    expect(formatRateLimitStatus(0)).toBe("Groq sınırına ulaşıldı, yeniden deneniyor…");
    expect(formatRateLimitStatus(-500)).toBe("Groq sınırına ulaşıldı, yeniden deneniyor…");
    expect(formatRateLimitStatus(NaN)).toBe("Groq sınırına ulaşıldı, yeniden deneniyor…");
  });

  it("sanitises the server's waitMs", () => {
    expect(normalizeRateLimitWaitMs(14_000)).toBe(14_000);
    expect(normalizeRateLimitWaitMs(2_500.4)).toBe(2_500);
    expect(normalizeRateLimitWaitMs(10 * 60_000)).toBe(60_000);
    expect(normalizeRateLimitWaitMs(-1)).toBe(0);
    expect(normalizeRateLimitWaitMs("15000")).toBe(0);
    expect(normalizeRateLimitWaitMs(undefined)).toBe(0);
    expect(normalizeRateLimitWaitMs(Infinity)).toBe(0);
  });
});

describe("ChatStreamError (apps/web/lib/api.ts)", () => {
  it("carries the server's code and retry hint", () => {
    const err = new ChatStreamError("Groq kullanım sınırına ulaşıldı.", "rate_limited", 15_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Groq kullanım sınırına ulaşıldı.");
    expect(err.code).toBe("rate_limited");
    expect(err.retryAfterMs).toBe(15_000);
    expect(new ChatStreamError("x").code).toBeUndefined();
  });
});
