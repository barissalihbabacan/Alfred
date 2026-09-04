import { describe, it, expect, beforeEach } from "vitest";
import { ProviderRegistry } from "../../src/ai/providers/registry.js";
import { AIProvider, ChatMessage, ChatCompletionResponse } from "../../src/ai/providers/types.js";
import { AIProviderError } from "../../src/core/errors/index.js";
import { getAIProvider } from "../../src/ai/providers/factory.js";

class MockCustomProvider implements AIProvider {
  public readonly id = "mock-provider";
  public readonly name = "Mock Custom Provider";

  public isConfigured(): boolean {
    return true;
  }

  public async chat(messages: ChatMessage[]): Promise<ChatCompletionResponse> {
    return {
      id: "mock-1",
      content: `Echo: ${messages[0]?.content}`,
      model: "mock-model",
      role: "assistant"
    };
  }

  public getSupportedModels() {
    return { chat: ["mock-model"] };
  }
}

describe("ProviderRegistry and Factory Unit Tests", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it("should register and retrieve a provider by ID", () => {
    const mock = new MockCustomProvider();
    registry.register(mock);

    expect(registry.has("mock-provider")).toBe(true);
    expect(registry.get("mock-provider")).toBe(mock);
    expect(registry.list()).toHaveLength(1);
  });

  it("should throw AIProviderError when requesting an unregistered provider", () => {
    expect(() => registry.get("non-existent-provider")).toThrow(AIProviderError);
  });

  it("should retrieve default Groq provider via getAIProvider factory", () => {
    const provider = getAIProvider("groq");
    expect(provider).toBeDefined();
    expect(provider.id).toBe("groq");
    expect(provider.name).toBe("Groq Cloud");
  });

  it("should retrieve Ollama provider via getAIProvider factory", () => {
    const provider = getAIProvider("ollama");
    expect(provider).toBeDefined();
    expect(provider.id).toBe("ollama");
    expect(provider.name).toBe("Ollama Local");
  });

  it("9. ALFRED_LLM_PROVIDER=ollama selects OllamaProvider", () => {
    const orig = process.env.ALFRED_LLM_PROVIDER;
    try {
      process.env.ALFRED_LLM_PROVIDER = "ollama";
      const provider = getAIProvider();
      expect(provider.id).toBe("ollama");
    } finally {
      process.env.ALFRED_LLM_PROVIDER = orig;
    }
  });

  it("10. ALFRED_LLM_PROVIDER=groq still selects GroqProvider", () => {
    const orig = process.env.ALFRED_LLM_PROVIDER;
    try {
      process.env.ALFRED_LLM_PROVIDER = "groq";
      const provider = getAIProvider();
      expect(provider.id).toBe("groq");
    } finally {
      process.env.ALFRED_LLM_PROVIDER = orig;
    }
  });
});

