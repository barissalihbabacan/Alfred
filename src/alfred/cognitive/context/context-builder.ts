import { CanonicalUserContext } from "./user-profile.types.js";
import { defaultUserProfileLoader } from "./user-profile-loader.js";

export interface ContextBuilderOptions {
  personaPrompt?: string;
  userContext?: CanonicalUserContext;
  includeUserProfile?: boolean;
}

/**
 * ContextBuilder
 *
 * Synthesizes Alfred's operational working context by combining:
 * 1. Alfred Canonical Persona (`docs/persona/ALFRED_PERSONA.md`)
 * 2. Canonical User Profile (`users/`)
 * 3. (Future) Dynamic Memories & History (Firestore)
 * 4. (Future) Retrieved Semantic Chunks (Vector DB)
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
   * Assembles the complete system prompt with persona and canonical user profile.
   */
  public static buildSystemPrompt(options?: ContextBuilderOptions): string {
    const persona = options?.personaPrompt ?? "";
    const includeProfile = options?.includeUserProfile !== false;

    if (!includeProfile) {
      return persona;
    }

    const userContext = options?.userContext || defaultUserProfileLoader.loadContextSync();
    const profileBlock = ContextBuilder.formatUserProfileBlock(userContext);

    return persona ? `${persona}\n\n${profileBlock}` : profileBlock;
  }
}

/**
 * Convenience helper to generate the contextual system prompt.
 */
export function getContextualSystemPrompt(options?: ContextBuilderOptions): string {
  return ContextBuilder.buildSystemPrompt(options);
}
