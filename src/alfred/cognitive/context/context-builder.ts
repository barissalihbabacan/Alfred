import { CanonicalUserContext } from "./user-profile.types.js";
import { defaultUserProfileLoader } from "./user-profile-loader.js";
import { CONVERSATION_CONFIG } from "../../../data/firestore/conversation-repository.interface.js";
import { RetrievedMemory } from "../memory/types.js";
import {
  CONVERSATIONAL_GOVERNOR_BLOCK,
  formatRetrievedMemoriesBlock
} from "../../../ai/prompts/alfred-system-prompt.js";
import { renderUserProfileBlock } from "./user-profile-renderer.js";

export interface ContextMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ContextBuilderOptions {
  personaPrompt?: string;
  userContext?: CanonicalUserContext;
  includeUserProfile?: boolean;
  includeGovernor?: boolean;
  relevantMemories?: RetrievedMemory[];
}

export interface BuildChatMessagesOptions extends ContextBuilderOptions {
  history?: ContextMessage[];
  currentMessage: string;
  maxHistoryMessages?: number;
}

/**
 * ContextBuilder
 *
 * Synthesizes Alfred's operational working context by combining:
 * 1. Alfred Canonical Persona (`docs/persona/ALFRED_PERSONA.md`)
 * 2. Canonical User Profile (`users/`)
 * 3. Conversational Governor (cadence, intent-driven length, pushback, anti-patterns)
 * 4. Retrieved long-term memories (semantic retrieval)
 *
 * Enforces explicit section boundaries so that the LLM distinguishes
 * static baseline identity from dynamic conversation turns.
 */
export class ContextBuilder {
  /**
   * Renders the canonical user profile (users/*.md) into its prompt block.
   * Delegates to the pure renderUserProfileBlock(), the same renderer
   * production uses on the build-time copy of the files.
   */
  public static formatUserProfileBlock(ctx: CanonicalUserContext): string {
    return renderUserProfileBlock(ctx.sources);
  }

  /**
   * Formats the Conversational Governor directives to control tone, cadence,
   * length, humour, pushback, and anti-patterns. The text is shared with
   * production (src/ai/prompts/alfred-system-prompt.ts).
   */
  public static formatGovernorBlock(): string {
    return CONVERSATIONAL_GOVERNOR_BLOCK;
  }

  /**
   * Formats retrieved long-term memories. Delegates to
   * formatRetrievedMemoriesBlock(), the block production sends, so src/ and
   * functions/index.js use one format. Returns "" when there are none.
   */
  public static formatMemoriesBlock(memories: RetrievedMemory[]): string {
    return formatRetrievedMemoriesBlock(memories);
  }

  /**
   * Assembles the complete system prompt with persona, canonical user profile,
   * conversational governor, and relevant long-term memories.
   */
  public static buildSystemPrompt(options?: ContextBuilderOptions): string {
    const persona = options?.personaPrompt ?? "";
    const includeProfile = options?.includeUserProfile !== false;
    const includeGovernor = options?.includeGovernor !== undefined ? options.includeGovernor : includeProfile;

    const sections: string[] = [];

    if (persona) {
      sections.push(persona);
    }

    if (includeProfile) {
      const userContext = options?.userContext || defaultUserProfileLoader.loadContextSync();
      sections.push(ContextBuilder.formatUserProfileBlock(userContext));
    }

    if (includeGovernor) {
      sections.push(ContextBuilder.formatGovernorBlock());
    }

    const memBlock = ContextBuilder.formatMemoriesBlock(options?.relevantMemories ?? []);
    if (memBlock) {
      sections.push(memBlock);
    }

    return sections.join("\n\n");
  }

  /**
   * Assembles the complete list of messages sent to the AI provider:
   * [System Prompt (Persona + Profile + Governor), ...Bounded Recent History, Current User Message]
   */
  public static buildChatMessages(options: BuildChatMessagesOptions): ContextMessage[] {
    const systemPrompt = ContextBuilder.buildSystemPrompt(options);
    const maxHistory = options.maxHistoryMessages ?? CONVERSATION_CONFIG.MAX_CONTEXT_MESSAGES;

    const messages: ContextMessage[] = [
      { role: "system", content: systemPrompt }
    ];

    if (Array.isArray(options.history) && options.history.length > 0) {
      // Take at most the last N messages
      const boundedHistory = options.history.slice(-maxHistory);
      for (const item of boundedHistory) {
        if (
          (item.role === "user" || item.role === "assistant") &&
          typeof item.content === "string" &&
          item.content.trim()
        ) {
          messages.push({
            role: item.role,
            content: item.content
          });
        }
      }
    }

    messages.push({
      role: "user",
      content: options.currentMessage
    });

    return messages;
  }
}

/**
 * Convenience helper to generate the contextual system prompt.
 */
export function getContextualSystemPrompt(options?: ContextBuilderOptions): string {
  return ContextBuilder.buildSystemPrompt(options);
}

