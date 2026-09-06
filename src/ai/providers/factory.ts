import { AIProvider, ProviderId } from "./types.js";
import { providerRegistry } from "./registry.js";
import { GroqProvider } from "./groq/index.js";
import { OllamaProvider } from "./ollama/index.js";
import { getAIConfig } from "../../core/config/index.js";

/**
 * Ensures a specific provider is registered with the registry on demand.
 * When Groq is the active provider, Ollama is NOT initialized or registered.
 */
function ensureProviderRegistered(id: string): void {
  if (!providerRegistry.has(id)) {
    if (id === "groq") {
      providerRegistry.register(new GroqProvider());
    } else if (id === "ollama") {
      providerRegistry.register(new OllamaProvider());
    }
  }
}

/**
 * Returns an AI provider instance based on requested ID or configuration.
 * Defaults to the active provider configured in environment (default: 'groq').
 */
export function getAIProvider(providerId?: ProviderId): AIProvider {
  const targetId = providerId || getAIConfig().activeProvider;
  ensureProviderRegistered(targetId);
  return providerRegistry.get(targetId);
}
