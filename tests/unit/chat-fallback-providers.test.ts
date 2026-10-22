import { describe, it, expect } from "vitest";
import {
  CHAT_PROVIDER_ORDER,
  DEFAULT_CHAT_PROVIDER_ORDER,
  DEFAULT_GEMINI_CHAT_MODEL,
  buildChatRequestBody,
  buildChatRequestHeaders,
  getChatProviderConfig,
  isUsableApiKey,
  parseChatProviderOrder,
  resolveChatProviders
} from "../../src/ai/providers/chat-fallback/chat-providers.js";
import { GET_CURRENT_TIME_TOOL_DEFINITION } from "../../src/ai/tools/time/current-time.js";

const KEYS = { groq: "gsk_test", gemini: "AQ.test" };

describe("isUsableApiKey", () => {
  it("accepts a real-looking key", () => {
    expect(isUsableApiKey("gsk_abc")).toBe(true);
    expect(isUsableApiKey("  AQ.v1-x  ")).toBe(true);
  });

  it.each([undefined, null, "", "   ", "unset", "UNSET", " none ", "None"])("treats %j as unconfigured", (key) => {
    expect(isUsableApiKey(key as string | null | undefined)).toBe(false);
  });
});

describe("provider configuration", () => {
  it("falls back in the owner's order: Groq, Gemini", () => {
    expect(CHAT_PROVIDER_ORDER).toEqual(["groq", "gemini"]);
  });

  it("has the documented endpoints and default models", () => {
    const table = CHAT_PROVIDER_ORDER.map((id) => {
      const c = getChatProviderConfig(id);
      return [id, c.url, c.model, c.secretName];
    });
    expect(table).toEqual([
      ["groq", "https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-120b", "GROQ_API_KEY"],
      ["gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "gemini-3.8-flash", "GEMINI_API_KEY"]
    ]);
    expect(DEFAULT_GEMINI_CHAT_MODEL).toBe("gemini-3.8-flash");
  });

  it("takes every model from the environment when set", () => {
    const env = {
      GROQ_MODEL: "llama-x",
      GEMINI_CHAT_MODEL: " gemini-2.5-flash "
    };
    expect(CHAT_PROVIDER_ORDER.map((id) => getChatProviderConfig(id, env).model)).toEqual([
      "llama-x", "gemini-2.5-flash"
    ]);
    expect(getChatProviderConfig("gemini", { GEMINI_CHAT_MODEL: "  " }).model).toBe(DEFAULT_GEMINI_CHAT_MODEL);
  });

  it("waits out a 429 on both providers", () => {
    expect(CHAT_PROVIDER_ORDER.map((id) => getChatProviderConfig(id).waitOnRateLimit)).toEqual([true, true]);
  });
});

describe("parseChatProviderOrder (CHAT_FALLBACK_ORDER)", () => {
  it("defaults to Groq, Gemini", () => {
    expect(DEFAULT_CHAT_PROVIDER_ORDER).toEqual(["groq", "gemini"]);
    expect(parseChatProviderOrder(undefined)).toEqual([...DEFAULT_CHAT_PROVIDER_ORDER]);
    expect(parseChatProviderOrder(" ")).toEqual([...DEFAULT_CHAT_PROVIDER_ORDER]);
    expect(parseChatProviderOrder("nonsense")).toEqual([...DEFAULT_CHAT_PROVIDER_ORDER]);
  });

  it("keeps known ids in the given order, without duplicates", () => {
    expect(parseChatProviderOrder("groq")).toEqual(["groq"]);
    expect(parseChatProviderOrder("gemini, groq,gemini,foo")).toEqual(["gemini", "groq"]);
  });
});

describe("resolveChatProviders", () => {
  it("uses the default order when CHAT_FALLBACK_ORDER is unset", () => {
    const { providers, skipped } = resolveChatProviders(KEYS);
    expect(providers.map((p) => p.id)).toEqual(["groq", "gemini"]);
    expect(skipped).toEqual([]);
  });

  it("returns every provider with a usable key, in order, with the key attached", () => {
    const { providers, skipped } = resolveChatProviders(KEYS);
    expect(providers.map((p) => [p.id, p.apiKey])).toEqual([
      ["groq", "gsk_test"],
      ["gemini", "AQ.test"]
    ]);
    expect(skipped).toEqual([]);
  });

  it("skips providers whose secret is empty, 'unset' or 'none'", () => {
    const { providers, skipped } = resolveChatProviders({ groq: "gsk_test", gemini: "unset" });
    expect(providers.map((p) => p.id)).toEqual(["groq"]);
    expect(skipped).toEqual(["gemini"]);
  });

  it("skips a provider whose model is set to 'none'", () => {
    const { providers, skipped } = resolveChatProviders(KEYS, { GEMINI_CHAT_MODEL: "none" });
    expect(providers.map((p) => p.id)).toEqual(["groq"]);
    expect(skipped).toEqual(["gemini"]);
  });

  it("still falls back when Groq itself has no key", () => {
    expect(resolveChatProviders({ gemini: "AQ.test" }).providers.map((p) => p.id)).toEqual(["gemini"]);
  });
});

describe("request shape", () => {
  const messages = [{ role: "system", content: "S" }, { role: "user", content: "Merhaba" }];
  const tools = [GET_CURRENT_TIME_TOOL_DEFINITION];

  it("keeps Groq's request byte-for-byte as before the fallback", () => {
    const groq = getChatProviderConfig("groq");
    // The former inline payload in functions/index.js.
    const legacy = { model: "openai/gpt-oss-120b", messages, stream: true, temperature: 0.6, max_tokens: 1500, tools };
    expect(JSON.stringify(buildChatRequestBody(groq, { messages, tools }))).toBe(JSON.stringify(legacy));
    const legacyNoTools = { model: "openai/gpt-oss-120b", messages, stream: true, temperature: 0.6, max_tokens: 1500 };
    expect(JSON.stringify(buildChatRequestBody(groq, { messages }))).toBe(JSON.stringify(legacyNoTools));
    expect(JSON.stringify(buildChatRequestBody(groq, { messages, tools: [] }))).toBe(JSON.stringify(legacyNoTools));
    expect(buildChatRequestHeaders(groq, "gsk_test")).toEqual({ "Content-Type": "application/json", "Authorization": "Bearer gsk_test" });
  });

  it("sends the same OpenAI-format tool definition to every provider", () => {
    for (const id of CHAT_PROVIDER_ORDER) {
      const body = buildChatRequestBody(getChatProviderConfig(id), { messages, tools });
      expect(body.tools).toEqual([GET_CURRENT_TIME_TOOL_DEFINITION]);
      expect(body.stream).toBe(true);
      expect(body.messages).toBe(messages);
    }
  });

  it("adds Gemini's extras", () => {
    const gemini = buildChatRequestBody(getChatProviderConfig("gemini"), { messages });
    expect(gemini).toMatchObject({ model: "gemini-3.8-flash", max_tokens: 4096, reasoning_effort: "low", stream_options: { include_usage: true } });
  });
});
