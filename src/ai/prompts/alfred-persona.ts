/**
 * Canonical System Prompt for B.U.T.L.E.R. Alfred
 *
 * Grounded in docs/persona/ALFRED_PERSONA.md. The persona text itself lives in
 * ./alfred-system-prompt.ts, which is also what production (functions/index.js)
 * sends, so src/ and the Cloud Functions share one persona.
 */

import { ALFRED_PERSONA_PROMPT } from "./alfred-system-prompt.js";
import { ContextBuilder } from "../../alfred/cognitive/context/context-builder.js";
import { CanonicalUserContext } from "../../alfred/cognitive/context/user-profile.types.js";

export const ALFRED_CANONICAL_SYSTEM_PROMPT = ALFRED_PERSONA_PROMPT;

/**
 * Returns the contextual Alfred system prompt combining the persona
 * with the canonical user profile loaded from Git (`users/`) and the
 * Conversational Governor.
 *
 * Note: this renders the profile from users/*.md at runtime, so it is NOT
 * byte-identical to production. Production (functions/index.js) sends
 * `buildAlfredSystemPrompt()` from ./alfred-system-prompt.ts, which carries a
 * hand-written profile summary instead.
 */
export function getAlfredSystemPrompt(options?: {
  includeUserProfile?: boolean;
  includeGovernor?: boolean;
  userContext?: CanonicalUserContext;
}): string {
  return ContextBuilder.buildSystemPrompt({
    personaPrompt: ALFRED_CANONICAL_SYSTEM_PROMPT,
    ...options
  });
}

