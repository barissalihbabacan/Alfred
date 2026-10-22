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

export interface ModelOption {
  id: string;
  provider: "evren" | "groq" | "gemini";
  model: string;
  label: string;
  badge: string;
  description: string;
}

export const CHAT_MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: "evren:qwen3.8-flash-next",
    provider: "evren",
    model: "qwen3.8-flash-next",
    label: "Qwen 3.8 Flash Next",
    badge: "256K · Varsayılan",
    description: "EVREN 15M/gün kota · Düşük gecikmeli çok dilli yanıtlar"
  },
  {
    id: "evren:deepseek-v4.1-flash",
    provider: "evren",
    model: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    badge: "1M · Muhakeme",
    description: "EVREN · Derin muhakeme ve araç kullanımı"
  },
  {
    id: "evren:glm-5.3",
    provider: "evren",
    model: "glm-5.3",
    label: "GLM-5.3",
    badge: "512K · Kodlama",
    description: "EVREN · Yazılım mimarisi ve derin teknik analiz"
  },
  {
    id: "evren:mimo-v2.6-pro",
    provider: "evren",
    model: "mimo-v2.6-pro",
    label: "MiMo V2.6 Pro",
    badge: "1M · Pro",
    description: "EVREN · Uzun bağlam ve kapsamlı muhakeme"
  },
  {
    id: "evren:gemma-4-31b",
    provider: "evren",
    model: "gemma-4-31b",
    label: "Gemma 4 31B",
    badge: "256K · 31B",
    description: "EVREN · Google açık ağırlıklı 31B model"
  },
  {
    id: "groq:openai/gpt-oss-120b",
    provider: "groq",
    model: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    badge: "Groq · LPU",
    description: "Groq Bulut · Çok yüksek hızlı çıkarım"
  },
  {
    id: "groq:llama-3.3-70b-versatile",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    badge: "Groq · 70B",
    description: "Groq Bulut · Dengeli genel amaçlı model"
  },
  {
    id: "gemini:gemini-3.8-flash",
    provider: "gemini",
    model: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    badge: "Google · Flash",
    description: "Google Gemini · Yedek bulut sağlayıcısı"
  }
];

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
