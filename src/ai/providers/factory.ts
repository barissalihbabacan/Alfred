import { AIProvider, ProviderId } from "./types.js";
import { providerRegistry } from "./registry.js";
import { GroqProvider } from "./groq/index.js";
import { OllamaProvider } from "./ollama/index.js";
import { getAIConfig } from "../../core/config/index.js";

/**
 * Ensures built-in providers are registered with the registry.
 */
function ensureDefaultsRegistered(): void {
  if (!providerRegistry.has("groq")) {
    providerRegistry.register(new GroqProvider());
  }
  if (!providerRegistry.has("ollama")) {
    providerRegistry.register(new OllamaProvider());
  }
}

/**
 * Returns an AI provider instance based on requested ID or configuration.
 * Defaults to the active provider configured in environment (default: 'ollama').
 */
export function getAIProvider(providerId?: ProviderId): AIProvider {
  ensureDefaultsRegistered();
  const targetId = providerId || getAIConfig().activeProvider;
  return providerRegistry.get(targetId);
}
