import { AIProvider, ProviderId } from "./types.js";
import { AIProviderError } from "../../core/errors/index.js";

/**
 * Registry holding available AI providers.
 */
export class ProviderRegistry {
  private providers = new Map<ProviderId, AIProvider>();

  /**
   * Registers a provider instance.
   */
  public register(provider: AIProvider): void {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  /**
   * Retrieves a provider by identifier.
   */
  public get(id: ProviderId): AIProvider {
    const provider = this.providers.get(id.toLowerCase());
    if (!provider) {
      throw new AIProviderError(
        id,
        `AI provider '${id}' is not registered. Available providers: ${Array.from(this.providers.keys()).join(", ") || "none"}`,
        404
      );
    }
    return provider;
  }

  /**
   * Checks whether a provider is registered.
   */
  public has(id: ProviderId): boolean {
    return this.providers.has(id.toLowerCase());
  }

  /**
   * Lists all registered providers.
   */
  public list(): AIProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Clears the registry (mainly for testing).
   */
  public clear(): void {
    this.providers.clear();
  }
}

export const providerRegistry = new ProviderRegistry();
