import { AIProvider, ProviderId } from "./types.js";
import { providerRegistry } from "./registry.js";
import { GroqProvider } from "./groq/index.js";
import { getAIConfig } from "../../core/config/index.js";

let defaultInitialized = false;

/**
 * Ensures built-in providers are registered with the registry.
 */
function ensureDefaultsRegistered(): void {
  if (defaultInitialized) return;
  if (!providerRegistry.has("groq")) {
    providerRegistry.register(new GroqProvider());
  }
  defaultInitialized = true;
}

/**
 * Returns an AI provider instance based on requested ID or configuration.
 * Defaults to the active provider configured in environment (default: 'groq').
 */
export function getAIProvider(providerId?: ProviderId): AIProvider {
  ensureDefaultsRegistered();
  const targetId = providerId || getAIConfig().activeProvider;
  return providerRegistry.get(targetId);
}
