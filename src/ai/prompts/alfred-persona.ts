/**
 * Canonical System Prompt for B.U.T.L.E.R. Alfred
 *
 * Grounded in docs/persona/ALFRED_PERSONA.md. The persona text itself lives in
 * ./alfred-system-prompt.ts, which is also what production (functions/index.js)
 * sends, so src/ and the Cloud Functions share one persona.
 */

import {
  ALFRED_PERSONA_PROMPT,
  buildAlfredPersonaPrompt,
  type AlfredRuntime
} from "./alfred-system-prompt.js";
import { ContextBuilder } from "../../alfred/cognitive/context/context-builder.js";
import { CanonicalUserContext } from "../../alfred/cognitive/context/user-profile.types.js";

export const ALFRED_CANONICAL_SYSTEM_PROMPT = ALFRED_PERSONA_PROMPT;

/**
 * Returns the contextual Alfred system prompt combining the persona
 * with the canonical user profile loaded from Git (`users/`) and the
 * Conversational Governor.
 *
 * It uses the same persona, profile renderer and governor as production
 * (`buildAlfredSystemPrompt()` in ./alfred-system-prompt.ts). The only
 * difference is where users/*.md comes from: here UserProfileLoader reads the
 * files on disk; production uses the copy embedded at build time. With the
 * files unchanged and the same runtime, the two prompts are identical.
 */
export function getAlfredSystemPrompt(options?: {
  includeUserProfile?: boolean;
  includeGovernor?: boolean;
  userContext?: CanonicalUserContext;
  /** Provider/model stated in the persona; defaults to production's (Groq). */
  runtime?: AlfredRuntime;
}): string {
  const { runtime, ...rest } = options ?? {};
  return ContextBuilder.buildSystemPrompt({
    personaPrompt: runtime ? buildAlfredPersonaPrompt(runtime) : ALFRED_CANONICAL_SYSTEM_PROMPT,
    runtime,
    ...rest
  });
}
