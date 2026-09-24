import { describe, it, expect } from "vitest";
import { createSseParser, stripThinking } from "../../apps/web/lib/sse.js";

// Frames exactly as functions/index.js `sendEvent()` writes them:
// res.write(`data: ${JSON.stringify(obj)}\n\n`)
const frame = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;

describe("Web SSE parser (functions /chat stream)", () => {
  it("parses the full event sequence emitted by the api function", () => {
    const parser = createSseParser();
    const stream =
      frame({ type: "start", conversationId: "c1", provider: "groq", model: "openai/gpt-oss-120b" }) +
      frame({ type: "thinking" }) +
      frame({ type: "chunk", text: "Good " }) +
      frame({ type: "tool_call", tool: "get_current_time", arguments: { city: "London" } }) +
      frame({ type: "tool_result", tool: "get_current_time", toolCallId: "t1", result: { ok: true } }) +
      frame({ type: "chunk", text: "morning, sir." }) +
      frame({ type: "done" });

    const events = parser.push(stream);
    expect(events.map((e) => e.type)).toEqual([
      "start",
      "thinking",
      "chunk",
      "tool_call",
      "tool_result",
      "chunk",
      "done"
    ]);
    expect(events[0]).toMatchObject({ conversationId: "c1", model: "openai/gpt-oss-120b" });
    expect(parser.flush()).toEqual([]);
  });

  it("reassembles events split across network chunks, including inside multi-byte text", () => {
    const parser = createSseParser();
    const raw = frame({ type: "chunk", text: "İyi günler, efendim." }) + frame({ type: "done" });
    const encoded = new TextEncoder().encode(raw);
    const decoder = new TextDecoder();

    const events = [];
    // Feed one byte at a time to hit every possible split point.
    for (const byte of encoded) {
      events.push(...parser.push(decoder.decode(new Uint8Array([byte]), { stream: true })));
    }
    events.push(...parser.push(decoder.decode()), ...parser.flush());

    expect(events).toEqual([{ type: "chunk", text: "İyi günler, efendim." }, { type: "done" }]);
  });

  it("surfaces error events instead of swallowing them", () => {
    const parser = createSseParser();
    const events = parser.push(frame({ type: "error", error: "LLM provider temporarily unavailable." }));
    expect(events).toEqual([{ type: "error", error: "LLM provider temporarily unavailable." }]);
  });

  it("parses rate_limited events and the rate-limit error that may follow", () => {
    const parser = createSseParser();
    const events = parser.push(
      frame({ type: "thinking" }) +
        frame({ type: "rate_limited", provider: "groq", waitMs: 14000, attempt: 1 }) +
        frame({ type: "thinking" }) +
        frame({
          type: "error",
          error: "Groq'un dakikalık token limiti doldu. Lütfen ~15 sn sonra tekrar deneyin.",
          code: "rate_limited",
          limitType: "tpm",
          retryAfterMs: 15000
        })
    );
    expect(events).toEqual([
      { type: "thinking" },
      { type: "rate_limited", provider: "groq", waitMs: 14000, attempt: 1 },
      { type: "thinking" },
      {
        type: "error",
        error: "Groq'un dakikalık token limiti doldu. Lütfen ~15 sn sonra tekrar deneyin.",
        code: "rate_limited",
        limitType: "tpm",
        retryAfterMs: 15000
      }
    ]);
  });

  it("parses a daily-limit give-up that comes without any rate_limited wait", () => {
    const parser = createSseParser();
    const error = {
      type: "error",
      error: "Groq'un günlük token limiti doldu. Lütfen yaklaşık 3 dakika sonra tekrar deneyin.",
      code: "rate_limited",
      limitType: "tpd",
      retryAfterMs: 199152
    };
    expect(parser.push(frame({ type: "thinking" }) + frame(error))).toEqual([{ type: "thinking" }, error]);
  });

  it("still ignores unknown event types between known ones", () => {
    const parser = createSseParser();
    const events = parser.push(
      frame({ type: "rate_limited", waitMs: 3000, attempt: 1 }) +
        frame({ type: "quota_warning", waitMs: 1 }) +
        frame({ type: "RATE_LIMITED" }) +
        frame({ type: "chunk", text: "Saat 14:05, efendim." })
    );
    expect(events.map((e) => e.type)).toEqual(["rate_limited", "chunk"]);
  });

  it("handles CRLF framing, comments and a trailing unterminated block", () => {
    const parser = createSseParser();
    const events = parser.push(`: keep-alive\r\n\r\ndata: {"type":"thinking"}\r\n\r\ndata: {"type":"done"}`);
    expect(events).toEqual([{ type: "thinking" }]);
    expect(parser.flush()).toEqual([{ type: "done" }]);
  });

  it("ignores malformed JSON and unknown event types", () => {
    const parser = createSseParser();
    const events = parser.push(`data: {not json}\n\n` + frame({ type: "mystery" }) + frame({ type: "done" }));
    expect(events).toEqual([{ type: "done" }]);
  });

  it("strips closed and unclosed <think> traces", () => {
    expect(stripThinking("<think>plan</think>Answer")).toBe("Answer");
    expect(stripThinking("<think>still reasoning")).toBe("");
    expect(stripThinking("Plain text")).toBe("Plain text");
  });
});
