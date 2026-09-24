import { describe, it, expect } from "vitest";
import { createOpenAIStreamParser, parseOpenAIStream } from "../../src/ai/providers/chat-fallback/openai-stream.js";
import {
  GEMINI_SIGNATURE,
  GROQ_USAGE,
  cerebrasText,
  cerebrasToolCall,
  geminiText,
  geminiToolCalls,
  groqPartialThenError,
  groqStreamError,
  groqText,
  groqToolCall,
  openRouterMidStreamError,
  openRouterText
} from "./fixtures/chat-provider-streams.js";

describe("OpenAI-compatible stream parser", () => {
  describe("Groq", () => {
    it("streams content, ignores reasoning, and counts usage once (usage and x_groq.usage are the same)", () => {
      const out = parseOpenAIStream(groqText("İyi ", "akşamlar, efendim."));
      expect(out.text).toBe("İyi akşamlar, efendim.");
      expect(out.deltas).toEqual([
        { type: "text", text: "İyi ", toolCallCount: 0 },
        { type: "text", text: "akşamlar, efendim.", toolCallCount: 0 }
      ]);
      expect(out.usage).toEqual(GROQ_USAGE);
      expect(out.toolCalls).toEqual([]);
      expect(out.error).toBeNull();
    });

    it("assembles a tool call from indexed fragments", () => {
      const out = parseOpenAIStream(groqToolCall(["İstanbul", "New York"]));
      expect(out.toolCalls).toEqual([
        { id: "call_groq_1", type: "function", function: { name: "get_current_time", arguments: JSON.stringify({ cities: ["İstanbul", "New York"] }) } }
      ]);
      expect(out.toolCalls[0]).not.toHaveProperty("extra_content");
      expect(out.text).toBe("");
    });

    it("records an error object inside the 200 stream", () => {
      expect(parseOpenAIStream(groqStreamError()).error).toMatchObject({ code: "tool_use_failed" });
      const partial = parseOpenAIStream(groqPartialThenError());
      expect(partial.text).toBe("Efendim, ");
      expect(partial.error).toMatchObject({ type: "server_error" });
    });
  });

  describe("Gemini (OpenAI endpoint)", () => {
    it("keeps whole calls without index apart by id and keeps the thought signature", () => {
      const out = parseOpenAIStream(geminiToolCalls());
      expect(out.toolCalls).toEqual([
        {
          id: "function-call-111",
          type: "function",
          function: { name: "get_current_time", arguments: JSON.stringify({ cities: ["Tokyo"] }) },
          extra_content: { google: { thought_signature: GEMINI_SIGNATURE } }
        },
        { id: "function-call-222", type: "function", function: { name: "get_current_time", arguments: JSON.stringify({ cities: ["Londra"] }) } }
      ]);
      expect(out.usage).toEqual({ prompt_tokens: 1900, completion_tokens: 30, total_tokens: 1930 });
    });

    it("reads usage from the final chunk with empty choices", () => {
      const out = parseOpenAIStream(geminiText("Tokyo'da ", "saat 20:43."));
      expect(out.text).toBe("Tokyo'da saat 20:43.");
      expect(out.usage?.total_tokens).toBe(1975);
    });
  });

  describe("Cerebras", () => {
    it("ignores delta.reasoning and reads usage from the final chunk", () => {
      const out = parseOpenAIStream(cerebrasText("Buyurun, efendim."));
      expect(out.text).toBe("Buyurun, efendim.");
      expect(out.usage).toEqual({ prompt_tokens: 2000, completion_tokens: 20, total_tokens: 2020 });
      expect(parseOpenAIStream(cerebrasToolCall()).toolCalls[0]).toEqual({
        id: "call_cb_1", type: "function", function: { name: "get_current_time", arguments: "{\"cities\":[\"Paris\"]}" }
      });
    });
  });

  describe("OpenRouter", () => {
    it("skips ': OPENROUTER PROCESSING' comments and reads the final usage chunk", () => {
      const out = parseOpenAIStream(openRouterText("Hazırım, ", "efendim."));
      expect(out.text).toBe("Hazırım, efendim.");
      expect(out.usage?.total_tokens).toBe(2032);
      expect(out.error).toBeNull();
    });

    it("records a mid-stream error (top-level error, finish_reason error)", () => {
      const out = parseOpenAIStream(openRouterMidStreamError());
      expect(out.error).toEqual({ code: "server_error", message: "Provider disconnected unexpectedly" });
      expect(out.text).toBe("");
    });
  });

  it("works across arbitrary chunk boundaries and a missing final newline", () => {
    const body = groqToolCall(["Tokyo"]).replace(/\n\n$/, "");
    const parser = createOpenAIStreamParser();
    for (let i = 0; i < body.length; i += 7) parser.push(body.slice(i, i + 7));
    parser.flush();
    expect(parser.result().toolCalls[0].function.arguments).toBe(JSON.stringify({ cities: ["Tokyo"] }));
  });

  it("reports text that follows a tool call with its tool-call count (it is not shown to the user)", () => {
    const body = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "get_current_time", arguments: "{}" } }] } }] },
      { choices: [{ delta: { content: "late text" } }] }
    ].map((c) => `data: ${JSON.stringify(c)}\n`).join("");
    const out = parseOpenAIStream(body);
    expect(out.deltas).toEqual([{ type: "tool_call" }, { type: "text", text: "late text", toolCallCount: 1 }]);
  });

  it("generates an id for a call that arrives without one, and reports bad JSON lines", () => {
    const errors: unknown[] = [];
    const body = `data: {not json}\ndata: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ function: { name: "get_current_time", arguments: { cities: ["Oslo"] } } }] } }] })}\n`;
    const out = parseOpenAIStream(body, { provider: "gemini", now: () => 42, onParseError: (e) => errors.push(e) });
    expect(errors).toHaveLength(1);
    expect(out.toolCalls).toEqual([
      { id: "call_gemini_42_0", type: "function", function: { name: "get_current_time", arguments: JSON.stringify({ cities: ["Oslo"] }) } }
    ]);
  });
});
