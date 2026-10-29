import { describe, it, expect } from "vitest";
import {
  CHAT_MODEL_OPTIONS,
  findSelectableModelOption,
  isModelOptionAvailable,
  parseAvailableProviders
} from "../../apps/web/lib/providers.js";
import { ALLOWED_CHAT_MODELS, CHAT_PROVIDER_ORDER } from "../../src/ai/providers/chat-fallback/chat-providers.js";

const option = (id: string) => {
  const found = CHAT_MODEL_OPTIONS.find((o) => o.id === id);
  if (!found) throw new Error(`no option ${id}`);
  return found;
};

describe("Web model selector availability (apps/web/lib/providers.ts)", () => {
  it("reads /health availableProviders, dropping unknown ids", () => {
    expect(parseAvailableProviders(["evren"])).toEqual(["evren"]);
    expect(parseAvailableProviders(["gemini", "ollama", 3, "groq"])).toEqual(["groq", "gemini"]);
    expect(parseAvailableProviders([])).toEqual([]);
  });

  it("treats a missing field (Ollama path, older server) as unknown", () => {
    expect(parseAvailableProviders(undefined)).toBeNull();
    expect(parseAvailableProviders("evren")).toBeNull();
  });

  it("disables the options of providers without a key; unknown availability disables nothing", () => {
    const evrenOnly = parseAvailableProviders(["evren"]);
    expect(isModelOptionAvailable(option("evren:qwen3.8-flash-next"), evrenOnly)).toBe(true);
    expect(isModelOptionAvailable(option("groq:openai/gpt-oss-120b"), evrenOnly)).toBe(false);
    expect(isModelOptionAvailable(option("gemini:gemini-3.8-flash"), evrenOnly)).toBe(false);
    for (const o of CHAT_MODEL_OPTIONS) expect(isModelOptionAvailable(o, null)).toBe(true);
  });

  it("drops a stored selection whose provider has no key, so /chat uses the default chain", () => {
    expect(findSelectableModelOption("groq:openai/gpt-oss-120b", ["evren"])).toBeUndefined();
    expect(findSelectableModelOption("evren:glm-5.3", ["evren"])?.model).toBe("glm-5.3");
    expect(findSelectableModelOption("groq:openai/gpt-oss-120b", null)?.provider).toBe("groq");
    expect(findSelectableModelOption("removed:model", null)).toBeUndefined();
    expect(findSelectableModelOption(null, ["evren"])).toBeUndefined();
  });

  it("offers only models the server allow-lists for their provider", () => {
    for (const o of CHAT_MODEL_OPTIONS) {
      expect(CHAT_PROVIDER_ORDER).toContain(o.provider);
      expect(ALLOWED_CHAT_MODELS[o.provider].has(o.model), o.id).toBe(true);
    }
  });
});
