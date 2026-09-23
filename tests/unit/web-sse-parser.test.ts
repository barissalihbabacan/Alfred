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
