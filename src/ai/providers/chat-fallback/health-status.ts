/**
 * The public `/health` answer of the `api` function.
 *
 * Pure and dependency-free: bundled into functions/index.js (see CLAUDE.md
 * "Functions bundle"). It resolves the chat providers exactly as `/chat` does
 * (`resolveChatProviders`: same keys, same `CHAT_FALLBACK_ORDER`, a key of
 * "unset" / "none" / empty counts as missing), so the engine the UI shows
 * before the first turn is the one that would answer it.
 */

import { availableChatProviders, isUsableApiKey, resolveChatProviders, type ChatProviderEnv, type ChatProviderId } from "./chat-providers.js";

export type HealthProvider = ChatProviderId | "ollama" | "offline";

export interface HealthStatus {
  status: "ok";
  /** The provider the next turn starts on; "offline" when none can answer. */
  activeProvider: HealthProvider;
  /** That provider's model; omitted when offline. */
  model?: string;
  /**
   * The providers the web model selector may offer (usable key). Omitted on
   * the Ollama path, which ignores the selection.
   */
  availableProviders?: ChatProviderId[];
  providerStatus: {
    groqConfigured: boolean;
    ollamaReachable: boolean;
    modelReady: boolean;
  };
}

export interface HealthStatusInput {
  /** `ALFRED_LLM_PROVIDER`, trimmed and lower-cased; anything but "groq" is the Ollama path. */
  llmProvider: string;
  keys: Partial<Record<ChatProviderId, string | null | undefined>>;
  env?: ChatProviderEnv;
  /** Only probed on the Ollama path, which has no fallback. */
  ollamaReachable?: boolean;
  ollamaModel?: string;
}

export function buildHealthStatus(input: HealthStatusInput): HealthStatus {
  const groqConfigured = isUsableApiKey(input.keys.groq);

  if (input.llmProvider !== "groq") {
    const reachable = input.ollamaReachable === true;
    return {
      status: "ok",
      activeProvider: reachable ? "ollama" : "offline",
      ...(reachable && input.ollamaModel ? { model: input.ollamaModel } : {}),
      providerStatus: { groqConfigured, ollamaReachable: reachable, modelReady: reachable }
    };
  }

  const first = resolveChatProviders(input.keys, input.env ?? {}).providers[0];
  return {
    status: "ok",
    activeProvider: first ? first.id : "offline",
    ...(first ? { model: first.model } : {}),
    availableProviders: availableChatProviders(input.keys),
    providerStatus: { groqConfigured, ollamaReachable: false, modelReady: Boolean(first) }
  };
}
