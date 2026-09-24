import { describe, it, expect } from "vitest";
import {
  CHAT_PROVIDER_ORDER,
  DEFAULT_CHAT_PROVIDER_ORDER,
  DEFAULT_CEREBRAS_MODEL,
  DEFAULT_CEREBRAS_SECONDARY_MODEL,
  DEFAULT_GEMINI_CHAT_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  buildChatRequestBody,
  buildChatRequestHeaders,
  getChatProviderConfig,
  isUsableApiKey,
  parseChatProviderOrder,
  resolveChatProviders
} from "../../src/ai/providers/chat-fallback/chat-providers.js";
import { GET_CURRENT_TIME_TOOL_DEFINITION } from "../../src/ai/tools/time/current-time.js";

const KEYS = { groq: "gsk_test", gemini: "AQ.test", cerebras: "csk-test", openrouter: "sk-or-test" };
/** Every known provider, Cerebras included (not the production default). */
const FULL_ORDER = { CHAT_FALLBACK_ORDER: CHAT_PROVIDER_ORDER.join(",") };

describe("isUsableApiKey", () => {
  it("accepts a real-looking key", () => {
    expect(isUsableApiKey("gsk_abc")).toBe(true);
    expect(isUsableApiKey("  sk-or-v1-x  ")).toBe(true);
  });

  it.each([undefined, null, "", "   ", "unset", "UNSET", " none ", "None"])("treats %j as unconfigured", (key) => {
    expect(isUsableApiKey(key as string | null | undefined)).toBe(false);
  });
});

describe("provider configuration", () => {
  it("falls back in the owner's order: Groq, Gemini, Cerebras gpt-oss, Cerebras qwen, OpenRouter", () => {
    expect(CHAT_PROVIDER_ORDER).toEqual(["groq", "gemini", "cerebras", "cerebras_secondary", "openrouter"]);
  });

  it("has the documented endpoints and default models", () => {
    const table = CHAT_PROVIDER_ORDER.map((id) => {
      const c = getChatProviderConfig(id);
      return [id, c.url, c.model, c.secretName];
    });
    expect(table).toEqual([
      ["groq", "https://api.groq.com/openai/v1/chat/completions", "openai/gpt-oss-120b", "GROQ_API_KEY"],
      ["gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", "gemini-3.8-flash", "GEMINI_API_KEY"],
      ["cerebras", "https://api.cerebras.ai/v1/chat/completions", "gpt-oss-120b", "CEREBRAS_API_KEY"],
      ["cerebras_secondary", "https://api.cerebras.ai/v1/chat/completions", "qwen-3.8-27b", "CEREBRAS_API_KEY"],
      ["openrouter", "https://openrouter.ai/api/v1/chat/completions", "openai/gpt-oss-120b", "OPENROUTER_API_KEY"]
    ]);
    expect([DEFAULT_GEMINI_CHAT_MODEL, DEFAULT_CEREBRAS_MODEL, DEFAULT_CEREBRAS_SECONDARY_MODEL, DEFAULT_OPENROUTER_MODEL]).toEqual([
      "gemini-3.8-flash", "gpt-oss-120b", "qwen-3.8-27b", "openai/gpt-oss-120b"
    ]);
  });

  it("takes every model from the environment when set", () => {
    const env = {
      GROQ_MODEL: "llama-x",
      GEMINI_CHAT_MODEL: " gemini-2.5-flash ",
      CEREBRAS_MODEL: "gpt-oss-120b-next",
      CEREBRAS_SECONDARY_MODEL: "qwen-other",
      OPENROUTER_MODEL: "qwen/qwen3.8-27b:free"
    };
    expect(CHAT_PROVIDER_ORDER.map((id) => getChatProviderConfig(id, env).model)).toEqual([
      "llama-x", "gemini-2.5-flash", "gpt-oss-120b-next", "qwen-other", "qwen/qwen3.8-27b:free"
    ]);
    expect(getChatProviderConfig("gemini", { GEMINI_CHAT_MODEL: "  " }).model).toBe(DEFAULT_GEMINI_CHAT_MODEL);
  });

  it("waits out a 429 everywhere except on Cerebras gpt-oss-120b (5 requests/min: the qwen step is better)", () => {
    expect(CHAT_PROVIDER_ORDER.map((id) => getChatProviderConfig(id).waitOnRateLimit)).toEqual([true, true, false, true, true]);
  });
});

describe("parseChatProviderOrder (CHAT_FALLBACK_ORDER)", () => {
  it("defaults to Groq, Gemini, OpenRouter (Cerebras left out: 402 payment_required)", () => {
    expect(DEFAULT_CHAT_PROVIDER_ORDER).toEqual(["groq", "gemini", "openrouter"]);
    expect(parseChatProviderOrder(undefined)).toEqual([...DEFAULT_CHAT_PROVIDER_ORDER]);
    expect(parseChatProviderOrder(" ")).toEqual([...DEFAULT_CHAT_PROVIDER_ORDER]);
    expect(parseChatProviderOrder("nonsense")).toEqual([...DEFAULT_CHAT_PROVIDER_ORDER]);
  });

  it("can still list Cerebras explicitly", () => {
    expect(parseChatProviderOrder(CHAT_PROVIDER_ORDER.join(","))).toEqual([...CHAT_PROVIDER_ORDER]);
  });

  it("keeps known ids in the given order, without duplicates", () => {
    expect(parseChatProviderOrder("groq")).toEqual(["groq"]);
    expect(parseChatProviderOrder("groq, OpenRouter,groq,foo,gemini")).toEqual(["groq", "openrouter", "gemini"]);
  });
});

describe("resolveChatProviders", () => {
  it("uses the default order, without Cerebras, when CHAT_FALLBACK_ORDER is unset", () => {
    const { providers, skipped } = resolveChatProviders(KEYS);
    expect(providers.map((p) => p.id)).toEqual(["groq", "gemini", "openrouter"]);
    expect(skipped).toEqual([]);
  });

  it("returns every provider with a usable key, in order, with the key attached", () => {
    const { providers, skipped } = resolveChatProviders(KEYS, FULL_ORDER);
    expect(providers.map((p) => [p.id, p.apiKey])).toEqual([
      ["groq", "gsk_test"],
      ["gemini", "AQ.test"],
      ["cerebras", "csk-test"],
      ["cerebras_secondary", "csk-test"],
      ["openrouter", "sk-or-test"]
    ]);
    expect(skipped).toEqual([]);
  });

  it("skips providers whose secret is empty, 'unset' or 'none'", () => {
    const { providers, skipped } = resolveChatProviders({ groq: "gsk_test", gemini: "", cerebras: "unset", openrouter: "none" }, FULL_ORDER);
    expect(providers.map((p) => p.id)).toEqual(["groq"]);
    expect(skipped).toEqual(["gemini", "cerebras", "cerebras_secondary", "openrouter"]);
  });

  it("skips the second Cerebras step when CEREBRAS_SECONDARY_MODEL=none", () => {
    const { providers, skipped } = resolveChatProviders(KEYS, { ...FULL_ORDER, CEREBRAS_SECONDARY_MODEL: "none" });
    expect(providers.map((p) => p.id)).toEqual(["groq", "gemini", "cerebras", "openrouter"]);
    expect(skipped).toEqual(["cerebras_secondary"]);
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

  it("adds each provider's extras", () => {
    const gemini = buildChatRequestBody(getChatProviderConfig("gemini"), { messages });
    expect(gemini).toMatchObject({ model: "gemini-3.8-flash", max_tokens: 4096, reasoning_effort: "low", stream_options: { include_usage: true } });

    const cerebras = buildChatRequestBody(getChatProviderConfig("cerebras"), { messages });
    expect(Object.keys(cerebras)).toEqual(["model", "messages", "stream", "temperature", "max_tokens"]);

    const qwen = buildChatRequestBody(getChatProviderConfig("cerebras_secondary"), { messages });
    expect(qwen).toMatchObject({ model: "qwen-3.8-27b", reasoning_effort: "low", max_tokens: 4096 });

    const openrouter = buildChatRequestBody(getChatProviderConfig("openrouter"), { messages });
    expect(openrouter).toMatchObject({ model: "openai/gpt-oss-120b", provider: { require_parameters: true } });
  });

  it("sends OpenRouter's attribution headers (ASCII only, valid for fetch)", () => {
    const headers = buildChatRequestHeaders(getChatProviderConfig("openrouter"), "sk-or-test");
    expect(headers).toEqual({
      "Content-Type": "application/json",
      "Authorization": "Bearer sk-or-test",
      "HTTP-Referer": "https://butler-alfred.web.app",
      "X-Title": "B.U.T.L.E.R. Alfred",
      "X-OpenRouter-Title": "B.U.T.L.E.R. Alfred"
    });
    for (const value of Object.values(headers)) expect(/^[\x20-\x7e]*$/.test(value)).toBe(true);
    expect(() => new Headers(headers)).not.toThrow();
  });
});
