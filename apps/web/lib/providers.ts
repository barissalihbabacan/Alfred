/**
 * Sohbet saglayicilarinin arayuzdeki adlari ve `provider_fallback` durum metni.
 * Sunucu tarafindaki sira ve kararlar src/ai/providers/chat-fallback/ icindedir;
 * apps/web src/'den import etmedigi icin burada yalnizca gosterim var.
 */

const PROVIDER_NAMES: Record<string, string> = {
  evren: "EVREN",
  groq: "Groq",
  gemini: "Gemini",
  ollama: "Ollama"
};

/** Saglayici kimliginin gorunen adi; bilinmeyen kimlik oldugu gibi, bos ise "Groq". */
export function providerDisplayName(id: unknown): string {
  if (typeof id !== "string" || !id.trim()) return "Groq";
  return PROVIDER_NAMES[id.trim().toLowerCase()] ?? id.trim();
}

/** Yonelme eki (Gemini'ye, Groq'a). */
function dativeOf(name: string): string {
  const special: Record<string, string> = { Groq: "'a" };
  if (special[name]) return name + special[name];
  const lower = name.toLocaleLowerCase("tr-TR");
  const vowels = lower.match(/[aeıioöuü]/g);
  const last = vowels ? vowels[vowels.length - 1] : "e";
  const back = "aıou".includes(last);
  const suffix = back ? "a" : "e";
  return /[aeıioöuü]$/.test(lower) ? `${name}'y${suffix}` : `${name}'${suffix}`;
}

const REASON_TEXT: Record<string, string> = {
  rate_limited: "sınıra ulaştı",
  server_error: "hata verdi",
  network_error: "yanıt vermedi",
  timeout: "yanıt vermedi",
  stream_error: "yanıtı tamamlayamadı",
  client_error: "isteği reddetti"
};

/**
 * `provider_fallback` olayi icin kisa durum metni, or.
 * "Groq sınıra ulaştı, Gemini'ye geçiliyor…".
 */
export function formatProviderFallbackStatus(from: unknown, to: unknown, reason: unknown): string {
  const fromName = providerDisplayName(from);
  const toName = providerDisplayName(to);
  const what = (typeof reason === "string" && REASON_TEXT[reason]) || "kullanılamıyor";
  if (fromName === toName) {
    // Ayni saglayicinin ikinci modeli.
    return `${fromName} ${what}, başka bir ${toName} modeli deneniyor…`;
  }
  return `${fromName} ${what}, ${dativeOf(toName)} geçiliyor…`;
}
