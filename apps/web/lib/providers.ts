/**
 * Sohbet saglayicilarinin arayuzdeki adlari ve `provider_fallback` durum metni.
 * Sunucu tarafindaki sira ve kararlar src/ai/providers/chat-fallback/ icindedir;
 * apps/web src/'den import etmedigi icin burada yalnizca gosterim var.
 */

import { translate, type Lang, type MessageKey } from "./i18n";

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
  /** Per UI language; product names and sizes read the same in both. */
  badge: Record<Lang, string>;
  description: Record<Lang, string>;
}

export const CHAT_MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: "evren:qwen3.8-flash-next",
    provider: "evren",
    model: "qwen3.8-flash-next",
    label: "Qwen 3.8 Flash Next",
    badge: { en: "256K · Default", tr: "256K · Varsayılan" },
    description: { en: "EVREN 15M/day quota · Low-latency multilingual replies", tr: "EVREN 15M/gün kota · Düşük gecikmeli çok dilli yanıtlar" }
  },
  {
    id: "evren:deepseek-v4.1-flash",
    provider: "evren",
    model: "deepseek-v4.1-flash",
    label: "DeepSeek V4.1 Flash",
    badge: { en: "1M · Reasoning", tr: "1M · Muhakeme" },
    description: { en: "EVREN · Deep reasoning and tool use", tr: "EVREN · Derin muhakeme ve araç kullanımı" }
  },
  {
    id: "evren:glm-5.3",
    provider: "evren",
    model: "glm-5.3",
    label: "GLM-5.3",
    badge: { en: "512K · Coding", tr: "512K · Kodlama" },
    description: { en: "EVREN · Software architecture and deep technical analysis", tr: "EVREN · Yazılım mimarisi ve derin teknik analiz" }
  },
  {
    id: "evren:mimo-v2.6-pro",
    provider: "evren",
    model: "mimo-v2.6-pro",
    label: "MiMo V2.6 Pro",
    badge: { en: "1M · Pro", tr: "1M · Pro" },
    description: { en: "EVREN · Long context and thorough reasoning", tr: "EVREN · Uzun bağlam ve kapsamlı muhakeme" }
  },
  {
    id: "evren:gemma-4-31b",
    provider: "evren",
    model: "gemma-4-31b",
    label: "Gemma 4 31B",
    badge: { en: "256K · 31B", tr: "256K · 31B" },
    description: { en: "EVREN · Google's open-weight 31B model", tr: "EVREN · Google açık ağırlıklı 31B model" }
  },
  {
    id: "groq:openai/gpt-oss-120b",
    provider: "groq",
    model: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    badge: { en: "Groq · LPU", tr: "Groq · LPU" },
    description: { en: "Groq Cloud · Very fast inference", tr: "Groq Bulut · Çok yüksek hızlı çıkarım" }
  },
  {
    id: "groq:llama-3.3-70b-versatile",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    badge: { en: "Groq · 70B", tr: "Groq · 70B" },
    description: { en: "Groq Cloud · Balanced general-purpose model", tr: "Groq Bulut · Dengeli genel amaçlı model" }
  },
  {
    id: "gemini:gemini-3.8-flash",
    provider: "gemini",
    model: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    badge: { en: "Google · Flash", tr: "Google · Flash" },
    description: { en: "Google Gemini · Fallback cloud provider", tr: "Google Gemini · Yedek bulut sağlayıcısı" }
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

const REASON_KEYS: Record<string, MessageKey> = {
  rate_limited: "fallback.reason.rateLimited",
  server_error: "fallback.reason.serverError",
  network_error: "fallback.reason.noResponse",
  timeout: "fallback.reason.noResponse",
  stream_error: "fallback.reason.streamError",
  client_error: "fallback.reason.clientError"
};

/**
 * `provider_fallback` olayi icin kisa durum metni, or.
 * "Groq sınıra ulaştı, Gemini'ye geçiliyor…" / "Groq hit its rate limit, switching to Gemini…".
 */
export function formatProviderFallbackStatus(from: unknown, to: unknown, reason: unknown, lang: Lang): string {
  const fromName = providerDisplayName(from);
  const toName = providerDisplayName(to);
  const reasonKey = typeof reason === "string" && Object.hasOwn(REASON_KEYS, reason)
    ? REASON_KEYS[reason]
    : "fallback.reason.unavailable";
  const what = translate(lang, reasonKey);
  if (fromName === toName) {
    // Ayni saglayicinin ikinci modeli.
    return translate(lang, "fallback.sameProvider", { from: fromName, what, to: toName });
  }
  const target = lang === "tr" ? dativeOf(toName) : toName;
  return translate(lang, "fallback.switch", { from: fromName, what, to: target });
}
