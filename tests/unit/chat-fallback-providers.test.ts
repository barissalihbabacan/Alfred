import { describe, it, expect } from "vitest";
import {
  CHAT_PROVIDER_ORDER,
  DEFAULT_CHAT_PROVIDER_ORDER,
  DEFAULT_EVREN_MODEL,
  DEFAULT_GEMINI_CHAT_MODEL,
  EVREN_CHAT_COMPLETIONS_URL,
  applyChatModelPreference,
  buildChatRequestBody,
  buildChatRequestHeaders,
  getChatProviderConfig,
  isUsableApiKey,
  parseChatProviderOrder,
  resolveChatProviders
} from "../../src/ai/providers/chat-fallback/chat-providers.js";
import { GET_CURRENT_TIME_TOOL_DEFINITION } from "../../src/ai/tools/time/current-time.js";

const KEYS = { evren: "evren_llm_test_key_123456", groq: "gsk_test", gemini: "AQ.test" };

describe("isUsableApiKey", () => {
  it("accepts a real-looking key", () => {
    expect(isUsableApiKey("evren_llm_abc1234567890")).toBe(true);
    expect(isUsableApiKey("gsk_abc")).toBe(true);
    expect(isUsableApiKey("  AQ.v1-x  ")).toBe(true);
  });

  it.each([undefined, null, "", "   ", "unset", "UNSET", " none ", "None"])("treats %j as unconfigured", (key) => {
    expect(isUsableApiKey(key as string | null | undefined)).toBe(false);
  });
});

describe("provider configuration", () => {
  it("falls back in the owner's order: EVREN, Groq, Gemini", () => {
    expect(CHAT_PROVIDER_ORDER).toEqual(["evren", "groq", "gemini"]);
  });

  it("has the documented endpoints and default models", () => {
    const table = CHAT_PROVIDER_ORDER.map((id) => {
      const c = getChatProviderConfig(id);
      return [id, c.url, c.model, c.secretName];
    });
    expect(table).toEqual([
      ["evren", EVREN_CHAT_COMPLETIONS_URL, DEFAULT_EVREN_MODEL, "EVREN_API_KEY"],
      ["groq", "https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-120b", "GROQ_API_KEY"],
      ["gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "gemini-3.8-flash", "GEMINI_API_KEY"]
    ]);
    expect(DEFAULT_EVREN_MODEL).toBe("deepseek-v4.1-flash");
    expect(DEFAULT_GEMINI_CHAT_MODEL).toBe("gemini-3.8-flash");
  });

  it("takes every model from the environment when set", () => {
    const env = {
      EVREN_MODEL: "deepseek-r1-tr",
      GROQ_MODEL: "llama-x",
      GEMINI_CHAT_MODEL: " gemini-2.5-flash "
    };
    expect(CHAT_PROVIDER_ORDER.map((id) => getChatProviderConfig(id, env).model)).toEqual([
      "deepseek-r1-tr", "llama-x", "gemini-2.5-flash"
    ]);
    expect(getChatProviderConfig("gemini", { GEMINI_CHAT_MODEL: "  " }).model).toBe(DEFAULT_GEMINI_CHAT_MODEL);
  });

  it("waits out a 429 on all providers", () => {
    expect(CHAT_PROVIDER_ORDER.map((id) => getChatProviderConfig(id).waitOnRateLimit)).toEqual([true, true, true]);
  });
});

describe("parseChatProviderOrder (CHAT_FALLBACK_ORDER)", () => {
  it("defaults to EVREN, Groq, Gemini", () => {
    expect(DEFAULT_CHAT_PROVIDER_ORDER).toEqual(["evren", "groq", "gemini"]);
    expect(parseChatProviderOrder(undefined)).toEqual([...DEFAULT_CHAT_PROVIDER_ORDER]);
    expect(parseChatProviderOrder(" ")).toEqual([...DEFAULT_CHAT_PROVIDER_ORDER]);
    expect(parseChatProviderOrder("nonsense")).toEqual([...DEFAULT_CHAT_PROVIDER_ORDER]);
  });

  it("keeps known ids in the given order, without duplicates", () => {
    expect(parseChatProviderOrder("groq")).toEqual(["groq"]);
    expect(parseChatProviderOrder("gemini, groq,gemini,foo")).toEqual(["gemini", "groq"]);
    expect(parseChatProviderOrder("evren, groq")).toEqual(["evren", "groq"]);
  });
});

describe("resolveChatProviders", () => {
  it("uses the default order when CHAT_FALLBACK_ORDER is unset", () => {
    const { providers, skipped } = resolveChatProviders(KEYS);
    expect(providers.map((p) => p.id)).toEqual(["evren", "groq", "gemini"]);
    expect(skipped).toEqual([]);
  });

  it("returns every provider with a usable key, in order, with the key attached", () => {
    const { providers, skipped } = resolveChatProviders(KEYS);
    expect(providers.map((p) => [p.id, p.apiKey])).toEqual([
      ["evren", "evren_llm_test_key_123456"],
      ["groq", "gsk_test"],
      ["gemini", "AQ.test"]
    ]);
    expect(skipped).toEqual([]);
  });

  it("skips providers whose secret is empty, 'unset' or 'none'", () => {
    const { providers, skipped } = resolveChatProviders({ evren: "unset", groq: "gsk_test", gemini: "unset" });
    expect(providers.map((p) => p.id)).toEqual(["groq"]);
    expect(skipped).toEqual(["evren", "gemini"]);
  });

  it("skips a provider whose model is set to 'none'", () => {
    const { providers, skipped } = resolveChatProviders(KEYS, { GEMINI_CHAT_MODEL: "none" });
    expect(providers.map((p) => p.id)).toEqual(["evren", "groq"]);
    expect(skipped).toEqual(["gemini"]);
  });

  it("still falls back when EVREN and Groq have no key", () => {
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

  it("adds Gemini's extras and EVREN's model-aware reasoning_effort", () => {
    const gemini = buildChatRequestBody(getChatProviderConfig("gemini"), { messages });
    expect(gemini).toMatchObject({ model: "gemini-3.8-flash", max_tokens: 4096, reasoning_effort: "low", stream_options: { include_usage: true } });

    const evrenDefault = buildChatRequestBody(getChatProviderConfig("evren"), { messages });
    expect(evrenDefault).toMatchObject({ model: "deepseek-v4.1-flash", max_tokens: 4096, reasoning_effort: "low", stream_options: { include_usage: true } });

    // gemma-4-31b rejects reasoning_effort on EVREN API, so it must be omitted.
    const evrenGemma = buildChatRequestBody(getChatProviderConfig("evren", { EVREN_MODEL: "gemma-4-31b" }), { messages });
    expect(evrenGemma).toMatchObject({ model: "gemma-4-31b", max_tokens: 4096, stream_options: { include_usage: true } });
    expect("reasoning_effort" in evrenGemma).toBe(false);
  });

  it("applyChatModelPreference reorders the preferred provider first and sets allow-listed models only", () => {
    const envGroq = applyChatModelPreference({}, { provider: "groq", model: "llama-3.3-70b-versatile" });
    expect(resolveChatProviders(KEYS, envGroq).providers.map((p) => [p.id, p.model])).toEqual([
      ["groq", "llama-3.3-70b-versatile"],
      ["evren", "deepseek-v4.1-flash"],
      ["gemini", "gemini-3.8-flash"]
    ]);

    const envEvren = applyChatModelPreference({}, { provider: "evren", model: "glm-5.3" });
    expect(resolveChatProviders(KEYS, envEvren).providers.map((p) => [p.id, p.model])).toEqual([
      ["evren", "glm-5.3"],
      ["groq", "openai/gpt-oss-120b"],
      ["gemini", "gemini-3.8-flash"]
    ]);

    // Unknown model is ignored while keeping the provider reorder.
    const envUnknownModel = applyChatModelPreference({}, { provider: "groq", model: "not-allowed-model" });
    expect(resolveChatProviders(KEYS, envUnknownModel).providers.map((p) => [p.id, p.model])).toEqual([
      ["groq", "openai/gpt-oss-120b"],
      ["evren", "deepseek-v4.1-flash"],
      ["gemini", "gemini-3.8-flash"]
    ]);
  });
});
