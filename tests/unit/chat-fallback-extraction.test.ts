import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_GEMINI_EXTRACTION_MODEL,
  buildGroqExtractionRequest,
  callMemoryExtractionProviders,
  planExtractionRequests,
  providerErrorDetail,
  type ExtractionProviderError
} from "../../src/ai/providers/chat-fallback/extraction-providers.js";
import {
  describeReasoningRuntime,
  describeRequestPipeline,
  buildAlfredSystemPrompt
} from "../../src/ai/prompts/alfred-system-prompt.js";
import { GROQ_TPD_429 } from "./fixtures/chat-provider-streams.js";

const EXTRACTED = JSON.stringify({ memories: [] });
const completion = (content: string) => JSON.stringify({ choices: [{ message: { role: "assistant", content } }] });

function mockFetch(replies: Array<{ status?: number; body: string } | Error>) {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: Record<string, string> }> = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected call");
    if (reply instanceof Error) throw reply;
    return new Response(reply.body, { status: reply.status ?? 200 });
  };
  return { fetch, calls };
}

const base = { system: "SYS", user: "USER", groqModel: "openai/gpt-oss-20b" };

describe("memory extraction: Groq, then Gemini", () => {
  it("keeps Groq's request exactly as before", () => {
    const req = buildGroqExtractionRequest("gsk_k", "openai/gpt-oss-20b", "SYS", "USER");
    expect(req.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(req.init.headers).toEqual({ "Content-Type": "application/json", "Authorization": "Bearer gsk_k" });
    expect(req.init.body).toBe(JSON.stringify({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "system", content: "SYS" }, { role: "user", content: "USER" }],
      temperature: 0.1,
      response_format: { type: "json_object" }
    }));
    expect(req.timeoutMs).toBe(20_000);
  });

  it("uses Groq when it answers", async () => {
    const m = mockFetch([{ body: completion(EXTRACTED) }]);
    const out = await callMemoryExtractionProviders({ ...base, fetch: m.fetch, groqKey: "gsk_k", geminiKey: "AQ.k" });
    expect(out).toEqual({ text: EXTRACTED, provider: "groq", model: "openai/gpt-oss-20b" });
    expect(m.calls).toHaveLength(1);
  });

  it("falls back to a small Gemini model when Groq is rate-limited, reporting the limit", async () => {
    const errors: ExtractionProviderError[] = [];
    const m = mockFetch([{ status: 429, body: JSON.stringify(GROQ_TPD_429) }, { body: completion(EXTRACTED) }]);
    const out = await callMemoryExtractionProviders({ ...base, fetch: m.fetch, groqKey: "gsk_k", geminiKey: "AQ.k", onProviderError: (e) => errors.push(e) });
    expect(out).toEqual({ text: EXTRACTED, provider: "gemini", model: DEFAULT_GEMINI_EXTRACTION_MODEL });
    expect(DEFAULT_GEMINI_EXTRACTION_MODEL).toBe("gemini-3.1-flash-lite");
    expect(m.calls[1].url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(m.calls[1].headers.Authorization).toBe("Bearer AQ.k");
    expect(m.calls[1].body).toEqual({
      model: "gemini-3.1-flash-lite",
      messages: [{ role: "system", content: "SYS" }, { role: "user", content: "USER" }],
      temperature: 0.1,
      reasoning_effort: "minimal"
    });
    expect(errors).toEqual([
      expect.objectContaining({ provider: "groq", httpStatus: 429, rateLimit: { limitType: "tpd", retryAfterMs: 199_152 } })
    ]);
  });

  it("reports only error.code and error.message of a JSON error body, never the model's output", async () => {
    // Groq's answer when the json_object output fails validation: the rejected
    // generation (here: facts about the user) comes back in failed_generation.
    const failed = {
      error: {
        message: "Failed to generate JSON. Please adjust your prompt. See 'failed_generation' for more details.",
        type: "invalid_request_error",
        code: "json_validate_failed",
        failed_generation: "{\"memories\":[{\"content\":\"Barış lives at Bağdat Caddesi 12\"}]}"
      }
    };
    const errors: ExtractionProviderError[] = [];
    const m = mockFetch([{ status: 400, body: JSON.stringify(failed) }, { body: completion(EXTRACTED) }]);
    await callMemoryExtractionProviders({ ...base, fetch: m.fetch, groqKey: "gsk_k", geminiKey: "AQ.k", onProviderError: (e) => errors.push(e) });
    expect(errors).toEqual([expect.objectContaining({ provider: "groq", httpStatus: 400 })]);
    expect(errors[0].detail).toBe(`json_validate_failed: ${failed.error.message}`);
    expect(JSON.stringify(errors)).not.toContain("Bağdat");

    expect(providerErrorDetail(JSON.stringify([{ error: { code: 429, message: "Resource exhausted" } }]))).toBe("429: Resource exhausted");
    expect(providerErrorDetail(JSON.stringify({ unexpected: "shape" }))).toBe("unrecognised error body");
    expect(providerErrorDetail("<html>502 Bad Gateway</html>")).toBe("<html>502 Bad Gateway</html>");
  });

  it("falls back on a thrown error or an empty answer too, and returns null when both fail (Ollama is next)", async () => {
    const errors: ExtractionProviderError[] = [];
    const m = mockFetch([new TypeError("fetch failed"), { body: completion("") }]);
    const out = await callMemoryExtractionProviders({ ...base, fetch: m.fetch, groqKey: "gsk_k", geminiKey: "AQ.k", onProviderError: (e) => errors.push(e) });
    expect(out).toBeNull();
    expect(errors.map((e) => [e.provider, e.httpStatus, e.detail])).toEqual([
      ["groq", undefined, "fetch failed"],
      ["gemini", 200, "empty extraction response"]
    ]);
  });

  it("honours GEMINI_EXTRACTION_MODEL and skips unconfigured providers", () => {
    expect(planExtractionRequests({ ...base, groqKey: "unset", geminiKey: "AQ.k", geminiModel: "gemini-3.5-flash-lite" }).map((r) => [r.provider, r.model]))
      .toEqual([["gemini", "gemini-3.5-flash-lite"]]);
    expect(planExtractionRequests({ ...base, groqKey: "gsk_k", geminiKey: "" }).map((r) => r.provider)).toEqual(["groq"]);
    expect(planExtractionRequests({ ...base, groqKey: "gsk_k", geminiKey: "AQ.k", geminiModel: "none" }).map((r) => r.provider)).toEqual(["groq"]);
  });

  it("is wired into production through functions/memory-extraction.js, Ollama included", () => {
    const index = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");
    const extraction = readFileSync(new URL("../../functions/memory-extraction.js", import.meta.url), "utf8");
    expect(extraction).toContain("call: (system, user) => callMemoryExtractionProviders({");
    expect(extraction).toMatch(/ollamaUrl,\s+ollamaModel,\s+system,/);
    // The Ollama step is no longer inline (index.js keeps /api/chat only for the chat path).
    expect(extraction).not.toContain("/api/chat");
    expect(index).not.toContain("extractionResText");
    expect(index).toContain("const GEMINI_EXTRACTION_MODEL = process.env.GEMINI_EXTRACTION_MODEL || DEFAULT_GEMINI_EXTRACTION_MODEL;");
    expect(index).toContain("geminiExtractionModel: GEMINI_EXTRACTION_MODEL");
  });
});

describe("capability line for a fallback provider", () => {
  it("names the provider actually answering", () => {
    expect(describeReasoningRuntime({ provider: "groq", model: "openai/gpt-oss-120b" })).toBe("Groq (openai/gpt-oss-120b)");
    expect(describeReasoningRuntime({ provider: "gemini", model: "gemini-3.8-flash" })).toBe(
      "Google Gemini (gemini-3.8-flash), standing in because Groq is unavailable"
    );
    expect(describeReasoningRuntime({ provider: "cerebras_secondary", model: "qwen-3.8-27b" })).toBe(
      "Cerebras (qwen-3.8-27b), standing in because Groq is unavailable"
    );
    expect(describeRequestPipeline({ provider: "openrouter", model: "openai/gpt-oss-120b" })).toContain(
      "→ OpenRouter API (openai/gpt-oss-120b) → SSE response."
    );
    const prompt = buildAlfredSystemPrompt({ runtime: { provider: "cerebras", model: "gpt-oss-120b" } });
    expect(prompt).toContain("reasoning via Cerebras (gpt-oss-120b), standing in because Groq is unavailable,");
    expect(prompt).toContain("Groq is the primary provider; this turn fell back because Groq was unavailable.");
    expect(prompt).not.toContain("Ollama on the MacBook over Tailscale is an optional alternative provider");
  });
});

describe("functions/index.js secrets", () => {
  const index = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");

  it("binds the Cerebras and OpenRouter keys to the api function", () => {
    expect(index).toContain('const CEREBRAS_API_KEY = defineSecret("CEREBRAS_API_KEY");');
    expect(index).toContain('const OPENROUTER_API_KEY = defineSecret("OPENROUTER_API_KEY");');
    expect(index).toContain("secrets: [GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, TAVILY_API_KEY]");
    expect(index).toContain('cerebras: gizliOku(CEREBRAS_API_KEY, "CEREBRAS_API_KEY"),');
    expect(index).toContain('openrouter: gizliOku(OPENROUTER_API_KEY, "OPENROUTER_API_KEY")');
  });

  it("announces the first provider in `start` and logs fallback fields on llm_request", () => {
    expect(index).toContain('sendEvent({ type: "start", conversationId: convId, provider: primary.id, model: primary.model });');
    expect(index).toMatch(/const llmMetrics = createChatTurnMetrics\(primary\.id, primary\.model\);/);
  });
});
