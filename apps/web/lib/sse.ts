/**
 * functions/index.js `/chat` uc noktasinin SSE olaylari. Her olay tek bir
 * `data: <json>\n\n` blogudur:
 *
 *   start        { conversationId, provider, model }
 *   thinking     {}
 *   chunk        { text }            -- `<think>` izleri icerebilir, gosterimde temizlenir
 *   tool_call    { tool, arguments } veya { toolCalls: [{ id, name, arguments }] }
 *   tool_result  { tool, toolCallId, result }
 *   rate_limited { provider, waitMs, attempt } -- Groq 429: sunucu `waitMs` bekleyip yeniden deneyecek;
 *                                    bekleme bitince `thinking` gelir
 *   done         {}                  -- yanit bitti; sunucu bellek kaydi icin baglantiyi bir sure acik tutabilir
 *   error        { error, code?, retryAfterMs? } -- `code: "rate_limited"`: Groq sinirinda vazgecildi;
 *                                    `error` kullaniciya gosterilecek kisa mesajdir
 *
 * Bilinmeyen `type` degerleri yok sayilir (sunucu yeni olay ekleyebilir).
 */
export type ChatStreamEvent =
  | { type: "start"; conversationId?: string; provider?: string; model?: string }
  | { type: "thinking" }
  | { type: "chunk"; text?: string }
  | { type: "tool_call"; tool?: string; arguments?: unknown; toolCalls?: unknown[] }
  | { type: "tool_result"; tool?: string; toolCallId?: string; result?: unknown }
  | { type: "rate_limited"; provider?: string; waitMs?: number; attempt?: number }
  | { type: "done" }
  | { type: "error"; error?: string; code?: string; retryAfterMs?: number };

const KNOWN_TYPES = new Set([
  "start",
  "thinking",
  "chunk",
  "tool_call",
  "tool_result",
  "rate_limited",
  "done",
  "error"
]);

function parseBlock(block: string): ChatStreamEvent | null {
  // Bir blok birden fazla `data:` satiri icerebilir (SSE spesifikasyonu); bunlar
  // yeni satirla birlestirilir. `:` ile baslayan yorum/keep-alive satirlari atlanir.
  const dataLines: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    if (rawLine.startsWith("data:")) {
      dataLines.push(rawLine.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;

  try {
    const parsed = JSON.parse(dataLines.join("\n"));
    if (parsed && typeof parsed === "object" && KNOWN_TYPES.has(parsed.type)) {
      return parsed as ChatStreamEvent;
    }
  } catch {
    // Bozuk blok: yok say.
  }
  return null;
}

/**
 * Akis parcalarini (TextDecoder ciktisi) biriktirip tamamlanan olaylari dondurur.
 * Olay isleme (ve olasi hata firlatma) cagirana birakilir; boylece bir `error`
 * olayi JSON ayristirma hatasi gibi sessizce yutulmaz.
 */
export function createSseParser() {
  let buffer = "";
  return {
    push(chunk: string): ChatStreamEvent[] {
      buffer += chunk;
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? "";
      return blocks.map(parseBlock).filter((e): e is ChatStreamEvent => e !== null);
    },
    /** Akis bittiginde tamponda kalan son (bos satirla bitmemis) blogu isler. */
    flush(): ChatStreamEvent[] {
      const rest = buffer;
      buffer = "";
      const event = rest.trim() ? parseBlock(rest) : null;
      return event ? [event] : [];
    }
  };
}

/** Model yanitindaki `<think>...</think>` (veya kapanmamis `<think>...`) izlerini temizler. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
}
