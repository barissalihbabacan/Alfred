import { describe, it, expect } from "vitest";
import { buildHealthStatus } from "../../src/ai/providers/chat-fallback/health-status.js";
import {
  DEFAULT_GEMINI_CHAT_MODEL,
  getChatProviderConfig
} from "../../src/ai/providers/chat-fallback/chat-providers.js";

const KEYS = { groq: "gsk_test", gemini: "AQ.test" };
const GROQ_MODEL = getChatProviderConfig("groq").model;

describe("buildHealthStatus (the /health answer)", () => {
  it("reports Groq and its model when Groq has a key", () => {
    expect(buildHealthStatus({ llmProvider: "groq", keys: KEYS })).toEqual({
      status: "ok",
      activeProvider: "groq",
      model: GROQ_MODEL,
      providerStatus: { groqConfigured: true, ollamaReachable: false, modelReady: true }
    });
  });

  it("treats a placeholder Groq key as missing and reports the first usable fallback", () => {
    for (const groq of ["unset", "none", "", "  ", undefined, null]) {
      const health = buildHealthStatus({ llmProvider: "groq", keys: { ...KEYS, groq } });
      expect(health.activeProvider, String(groq)).toBe("gemini");
      expect(health.model).toBe(DEFAULT_GEMINI_CHAT_MODEL);
      expect(health.providerStatus).toEqual({ groqConfigured: false, ollamaReachable: false, modelReady: true });
    }
  });

  it("is offline, with no model, when no provider of the chain has a key", () => {
    const health = buildHealthStatus({
      llmProvider: "groq",
      keys: { groq: "unset", gemini: "" }
    });
    expect(health).toEqual({
      status: "ok",
      activeProvider: "offline",
      providerStatus: { groqConfigured: false, ollamaReachable: false, modelReady: false }
    });
  });

  it("uses the same CHAT_FALLBACK_ORDER and model overrides as /chat", () => {
    const groqOnly = buildHealthStatus({
      llmProvider: "groq",
      keys: { ...KEYS, groq: "unset" },
      env: { CHAT_FALLBACK_ORDER: "groq" }
    });
    expect(groqOnly.activeProvider).toBe("offline");

    const custom = buildHealthStatus({ llmProvider: "groq", keys: KEYS, env: { GROQ_MODEL: "custom/model" } });
    expect(custom.model).toBe("custom/model");
  });

  it("on the Ollama path reports Ollama only when it is reachable, never a Groq it would not use", () => {
    expect(buildHealthStatus({ llmProvider: "ollama", keys: KEYS, ollamaReachable: true, ollamaModel: "gemma4:12b-mlx" })).toEqual({
      status: "ok",
      activeProvider: "ollama",
      model: "gemma4:12b-mlx",
      providerStatus: { groqConfigured: true, ollamaReachable: true, modelReady: true }
    });
    expect(buildHealthStatus({ llmProvider: "ollama", keys: KEYS, ollamaReachable: false })).toEqual({
      status: "ok",
      activeProvider: "offline",
      providerStatus: { groqConfigured: true, ollamaReachable: false, modelReady: false }
    });
  });

  it("never includes an API key", () => {
    const json = JSON.stringify(buildHealthStatus({ llmProvider: "groq", keys: KEYS }));
    for (const key of Object.values(KEYS)) expect(json).not.toContain(key);
  });
});
