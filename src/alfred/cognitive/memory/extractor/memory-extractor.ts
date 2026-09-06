import { AIProvider } from "../../../../ai/providers/types.js";
import { getAIProvider } from "../../../../ai/providers/factory.js";
import { getMemoryConfig, MemoryExtractionConfig } from "../../../../core/config/index.js";
import {
  IMemoryExtractor,
  MemoryExtractionInput,
  MemoryExtractionResult
} from "./types.js";
import {
  buildMemoryExtractionPrompt,
  parseMemoryExtractionResponse
} from "../../../../ai/prompts/memory-extraction.js";

export interface MemoryExtractorOptions {
  provider?: AIProvider;
  config?: Partial<MemoryExtractionConfig>;
}

export class MemoryExtractor implements IMemoryExtractor {
  private provider: AIProvider;
  private config: MemoryExtractionConfig;

  constructor(options?: MemoryExtractorOptions) {
    this.config = {
      ...getMemoryConfig().extraction,
      ...options?.config
    };
    this.provider = options?.provider || getAIProvider();
  }

  public async extract(input: MemoryExtractionInput): Promise<MemoryExtractionResult> {
    if (!this.config.enabled) {
      return { shouldRemember: false, candidates: [] };
    }

    if (!input.currentMessage || !input.currentMessage.trim()) {
      return { shouldRemember: false, candidates: [] };
    }

    // Fast deterministic check for explicit negative signals
    const lowerMessage = input.currentMessage.toLowerCase().trim();
    if (
      lowerMessage === "don't remember this" ||
      lowerMessage === "do not remember this" ||
      lowerMessage === "bunu hatırlama" ||
      lowerMessage === "sakın kaydetme"
    ) {
      return { shouldRemember: false, candidates: [] };
    }

    // Bounded context messages
    const maxMessages = this.config.maxContextMessages;
    const boundedRecent = input.recentMessages
      ? input.recentMessages.slice(-maxMessages)
      : undefined;

    const messages = buildMemoryExtractionPrompt({
      ...input,
      recentMessages: boundedRecent
    });

    const timeoutMs = this.config.timeoutMs;
    const startTime = Date.now();

    try {
      if (!this.provider || !this.provider.isConfigured()) {
        return { shouldRemember: false, candidates: [] };
      }

      const extractionPromise = this.provider.chat(messages, {
        temperature: 0.1,
        maxTokens: 1000,
        model: this.config.model
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Memory extraction timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      const response = await Promise.race([extractionPromise, timeoutPromise]);
      const durationMs = Date.now() - startTime;

      const result = parseMemoryExtractionResponse(response.content, this.config.minConfidence);

      if (result.shouldRemember && result.candidates.length > 0) {
        console.log(
          `[MemoryExtraction] Extracted ${result.candidates.length} candidate(s) in ${durationMs}ms:`,
          result.candidates.map((c) => `[${c.action.toUpperCase()}] "${c.content}" (${c.memoryType}, conf: ${c.confidence})`).join("; ")
        );
      }

      return result;
    } catch (err: any) {
      console.warn(`[MemoryExtraction] Extraction failed gracefully (${Date.now() - startTime}ms):`, err?.message || err);
      return { shouldRemember: false, candidates: [] };
    }
  }
}
