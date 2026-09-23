import { CanonicalUserContext } from "./user-profile.types.js";
import { defaultUserProfileLoader } from "./user-profile-loader.js";
import { CONVERSATION_CONFIG } from "../../../data/firestore/conversation-repository.interface.js";
import { RetrievedMemory } from "../memory/types.js";
import { CONVERSATIONAL_GOVERNOR_BLOCK } from "../../../ai/prompts/alfred-system-prompt.js";

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
 * 4. (Future) Dynamic Memories & History (Firestore)
 * 5. (Future) Retrieved Semantic Chunks (Vector DB)
 *
 * Enforces explicit section boundaries so that the LLM distinguishes
 * static baseline identity from dynamic conversation turns.
 */
export class ContextBuilder {
  /**
   * Formats the canonical user profile into a dense, structured markdown block.
   * Free of executable instructions or prompt injection vectors.
   */
  public static formatUserProfileBlock(ctx: CanonicalUserContext): string {
    const { profile, preferences, workingStyle } = ctx;

    return `=== CANONICAL USER PROFILE (GIT AUTHORITATIVE) ===
USER IDENTITY:
- Name: ${profile.name} (${profile.fullName})
- Role: ${profile.role}
- Proficiency: ${profile.technicalProficiency}
- Core Stacks: ${profile.coreCompetencies.join(", ")}
- Philosophy: ${profile.broadPhilosophy}

INTERACTION & COMMUNICATION PREFERENCES:
- Language Register: ${preferences.defaultLanguageRegister}
- Multilingual: ${preferences.multilingualSupport.join(", ")}
- Form of Address: Address as "${preferences.formsOfAddress.english}" in English or "${preferences.formsOfAddress.turkish}" in Turkish (${preferences.formsOfAddress.frequency}).
- Tone Rules: ${preferences.forbiddenMannerisms.join("; ")}
- Response Structure: ${preferences.responseStructure}

WORKING STYLE & ENGINEERING PRINCIPLES:
- Incremental Development: ${workingStyle.incrementalDevelopment}
- Progression Model: ${workingStyle.progressionModel}
- Investigation Protocol: ${workingStyle.investigationProtocol}
- Complexity Policy: ${workingStyle.complexityPolicy}

PUSHBACK & RISK MANAGEMENT PROTOCOL:
- Pushback Triggers: ${preferences.pushbackTriggers.join("; ")}
- Peer Dynamic: ${workingStyle.collaborationContract}
- Pushback Manner: Calm, objective, First Principles-based, with viable engineering alternatives.
==================================================`;
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
   * Formats retrieved long-term memories into an explicit, structured markdown block.
   */
  public static formatMemoriesBlock(memories: RetrievedMemory[]): string {
    if (!memories || memories.length === 0) {
      return "";
    }

    const items = memories.map((m) => {
      const typeTag = m.memoryType ? `[${m.memoryType.toUpperCase()}] ` : "";
      return `- ${typeTag}${m.content.trim()}`;
    });

    return `=== RELEVANT LONG-TERM MEMORIES (SEMANTIC RETRIEVAL) ===
The following memories are retrieved from long-term memory based on semantic relevance to the current conversation. They represent verified facts, decisions, and user preferences:
${items.join("\n")}
========================================================`;
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

    if (options?.relevantMemories && options.relevantMemories.length > 0) {
      const memBlock = ContextBuilder.formatMemoriesBlock(options.relevantMemories);
      if (memBlock) {
        sections.push(memBlock);
      }
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

