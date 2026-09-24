/**
 * Groq hiz siniri (`rate_limited` SSE olayi) icin arayuz yardimcilari.
 * Sunucu tarafindaki butce/mesaj mantigi src/ai/providers/groq/rate-limit.ts
 * icindedir; apps/web src/'den import etmedigi icin burada yalnizca gosterim var.
 */

/** Sunucunun gonderdigi `waitMs` degerini guvenli bir sureye cevirir (0..60 sn). */
export function normalizeRateLimitWaitMs(waitMs: unknown): number {
  if (typeof waitMs !== "number" || !Number.isFinite(waitMs) || waitMs <= 0) return 0;
  return Math.min(Math.round(waitMs), 60_000);
}

/**
 * Bekleme sirasinda "Düşünüyor..." yerine gosterilen durum metni.
 * `remainingMs` > 0 iken geri sayim, bittiginde yeniden deneme mesaji.
 */
export function formatRateLimitStatus(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "Groq sınırına ulaşıldı, yeniden deneniyor…";
  }
  const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return `Groq sınırına ulaşıldı, ~${seconds} sn bekleniyor…`;
}
