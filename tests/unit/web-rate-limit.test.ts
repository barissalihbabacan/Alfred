import { describe, it, expect } from "vitest";
import { formatRateLimitStatus, normalizeRateLimitWaitMs } from "../../apps/web/lib/rate-limit.js";
import { formatProviderFallbackStatus, providerDisplayName } from "../../apps/web/lib/providers.js";
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
    expect(formatRateLimitStatus(15_000, "gemini")).toBe("Gemini sınırına ulaşıldı, ~15 sn bekleniyor…");
    expect(formatRateLimitStatus(0, "openrouter")).toBe("OpenRouter sınırına ulaşıldı, yeniden deneniyor…");
    expect(formatRateLimitStatus(15_000, undefined)).toBe("Groq sınırına ulaşıldı, ~15 sn bekleniyor…");
  });

  it("describes a switch in Turkish, with the right suffix", () => {
    expect(formatProviderFallbackStatus("groq", "gemini", "rate_limited")).toBe("Groq sınıra ulaştı, Gemini'ye geçiliyor…");
    expect(formatProviderFallbackStatus("gemini", "cerebras", "server_error")).toBe("Gemini hata verdi, Cerebras'a geçiliyor…");
    expect(formatProviderFallbackStatus("cerebras_secondary", "openrouter", "network_error")).toBe("Cerebras yanıt vermedi, OpenRouter'a geçiliyor…");
    expect(formatProviderFallbackStatus("openrouter", "groq", "timeout")).toBe("OpenRouter yanıt vermedi, Groq'a geçiliyor…");
    expect(formatProviderFallbackStatus("cerebras", "cerebras_secondary", "rate_limited")).toBe("Cerebras sınıra ulaştı, başka bir Cerebras modeli deneniyor…");
    expect(formatProviderFallbackStatus("groq", "gemini", "client_error")).toBe("Groq isteği reddetti, Gemini'ye geçiliyor…");
    expect(formatProviderFallbackStatus("groq", "gemini", "mystery")).toBe("Groq kullanılamıyor, Gemini'ye geçiliyor…");
  });

  it("maps provider ids to display names", () => {
    expect(["groq", "gemini", "cerebras", "cerebras_secondary", "openrouter", "ollama", "", undefined, "Mistral"].map(providerDisplayName)).toEqual([
      "Groq", "Gemini", "Cerebras", "Cerebras", "OpenRouter", "Ollama", "Groq", "Groq", "Mistral"
    ]);
  });
});
