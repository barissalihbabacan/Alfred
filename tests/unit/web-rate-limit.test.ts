import { describe, it, expect } from "vitest";
import { formatRateLimitStatus, normalizeRateLimitWaitMs } from "../../apps/web/lib/rate-limit.js";
import { formatProviderFallbackStatus, providerDisplayName } from "../../apps/web/lib/providers.js";
import { ChatStreamError } from "../../apps/web/lib/api.js";

describe("Web rate-limit status (apps/web/lib/rate-limit.ts)", () => {
  it("counts down in whole seconds, rounding up", () => {
    expect(formatRateLimitStatus(15_000, undefined, "tr")).toBe("Groq sınırına ulaşıldı, ~15 sn bekleniyor…");
    expect(formatRateLimitStatus(14_001, undefined, "tr")).toBe("Groq sınırına ulaşıldı, ~15 sn bekleniyor…");
    expect(formatRateLimitStatus(200, undefined, "tr")).toBe("Groq sınırına ulaşıldı, ~1 sn bekleniyor…");
  });

  it("counts down in English too", () => {
    expect(formatRateLimitStatus(14_001, undefined, "en")).toBe("Groq rate limit reached, waiting ~15 s…");
    expect(formatRateLimitStatus(0, "gemini", "en")).toBe("Gemini rate limit reached, retrying…");
  });

  it("switches to a retry message once the wait is over", () => {
    expect(formatRateLimitStatus(0, undefined, "tr")).toBe("Groq sınırına ulaşıldı, yeniden deneniyor…");
    expect(formatRateLimitStatus(-500, undefined, "tr")).toBe("Groq sınırına ulaşıldı, yeniden deneniyor…");
    expect(formatRateLimitStatus(NaN, undefined, "tr")).toBe("Groq sınırına ulaşıldı, yeniden deneniyor…");
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
    expect(err.limitType).toBeUndefined();
  });

  it("carries the limit type of a daily-limit give-up", () => {
    const err = new ChatStreamError(
      "Groq'un günlük token limiti doldu. Lütfen yaklaşık 3 dakika sonra tekrar deneyin.",
      "rate_limited",
      199_152,
      "tpd"
    );
    expect(err.retryAfterMs).toBe(199_152);
    expect(err.limitType).toBe("tpd");
  });
});

describe("Provider fallback status (apps/web/lib/providers.ts)", () => {
  it("names the provider that is being waited on", () => {
    expect(formatRateLimitStatus(15_000, "gemini", "tr")).toBe("Gemini sınırına ulaşıldı, ~15 sn bekleniyor…");
    expect(formatRateLimitStatus(0, "gemini", "tr")).toBe("Gemini sınırına ulaşıldı, yeniden deneniyor…");
    expect(formatRateLimitStatus(15_000, undefined, "tr")).toBe("Groq sınırına ulaşıldı, ~15 sn bekleniyor…");
  });

  it("describes a switch in Turkish, with the right suffix", () => {
    expect(formatProviderFallbackStatus("groq", "gemini", "rate_limited", "tr")).toBe("Groq sınıra ulaştı, Gemini'ye geçiliyor…");
    expect(formatProviderFallbackStatus("gemini", "groq", "timeout", "tr")).toBe("Gemini yanıt vermedi, Groq'a geçiliyor…");
    expect(formatProviderFallbackStatus("groq", "groq", "rate_limited", "tr")).toBe("Groq sınıra ulaştı, başka bir Groq modeli deneniyor…");
    expect(formatProviderFallbackStatus("groq", "gemini", "client_error", "tr")).toBe("Groq isteği reddetti, Gemini'ye geçiliyor…");
    expect(formatProviderFallbackStatus("groq", "gemini", "mystery", "tr")).toBe("Groq kullanılamıyor, Gemini'ye geçiliyor…");
  });

  it("describes a switch in English", () => {
    expect(formatProviderFallbackStatus("groq", "gemini", "rate_limited", "en")).toBe("Groq hit its rate limit, switching to Gemini…");
    expect(formatProviderFallbackStatus("gemini", "groq", "timeout", "en")).toBe("Gemini did not respond, switching to Groq…");
    expect(formatProviderFallbackStatus("groq", "groq", "server_error", "en")).toBe("Groq returned an error, trying another Groq model…");
    expect(formatProviderFallbackStatus("groq", "gemini", "hasOwnProperty", "en")).toBe("Groq is unavailable, switching to Gemini…");
  });

  it("maps provider ids to display names", () => {
    expect(["groq", "gemini", "ollama", "", undefined, "Mistral"].map(providerDisplayName)).toEqual([
      "Groq", "Gemini", "Ollama", "Groq", "Groq", "Mistral"
    ]);
  });
});
