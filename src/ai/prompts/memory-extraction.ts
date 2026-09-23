import { ChatMessage } from "../providers/types.js";
import { MemoryExtractionInput, MemoryExtractionResult, ExtractedMemoryCandidate, MemoryExtractionAction } from "../../alfred/cognitive/memory/extractor/types.js";
import { MemoryType } from "../../data/firestore/memory.types.js";

const VALID_MEMORY_TYPES = new Set<MemoryType>([
  "user_preference",
  "user_fact",
  "project_fact",
  "architectural_decision",
  "technical_preference",
  "constraint",
  "relationship",
  "workflow",
  "general"
]);

/**
 * Builds the user-turn text for the memory extraction call: optional recent
 * context, then the current exchange. Shared with functions/index.js (bundled
 * via esbuild), so the production prompt and this library emit identical text.
 */
export function buildMemoryExtractionUserPrompt(input: {
  currentMessage: string;
  assistantResponse?: string;
  recentMessages?: Array<{ role: string; content: string }>;
}): string {
  const contextSegments: string[] = [];

  if (input.recentMessages && input.recentMessages.length > 0) {
    contextSegments.push("=== RECENT CONVERSATION CONTEXT ===");
    for (const msg of input.recentMessages) {
      contextSegments.push(`${msg.role.toUpperCase()}: ${msg.content}`);
    }
  }

  contextSegments.push("=== CURRENT EXCHANGE ===");
  contextSegments.push(`USER: ${input.currentMessage}`);
  if (input.assistantResponse) {
    contextSegments.push(`ASSISTANT: ${input.assistantResponse}`);
  }

  return `${contextSegments.join("\n")}\n\nAnalyze the above exchange. Output JSON only.`;
}

/**
 * Reduces raw extraction-model output to the JSON text to parse: strips
 * <think>...</think> reasoning traces (including an unterminated one), then
 * takes the body of a ```json fenced block if present, otherwise the span from
 * the first "{" to the last "}". Returns the trimmed text unchanged when
 * neither is found. Shared with functions/index.js (bundled via esbuild).
 */
export function extractJsonPayload(rawText: string): string {
  // Strip possible thinking tags, e.g. <think>...</think>
  let clean = rawText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();

  // Extract JSON payload from markdown code blocks or search for first { and last }
  const jsonBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    clean = jsonBlockMatch[1].trim();
  } else {
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  return clean;
}

/**
 * System prompt for the isolated memory extraction call. This is the exact
 * text production (functions/index.js, bundled via esbuild) sends; it is
 * strictly decoupled from Alfred's conversational persona.
 */
export function buildMemoryExtractionSystemPrompt(userName: string): string {
  return `You are Alfred's autonomous memory extraction subsystem.
Your task is to analyze conversational exchanges and identify durable, long-term information worth remembering across future conversations.

CRITICAL RULES:
1. DURABILITY: Only extract information that will remain useful in future, separate conversations.
   - GOOD: User preferences, stable facts about ${userName}, technical choices, architectural decisions, constraints, workflows, project facts.
   - BAD (NEVER REMEMBER): Greetings ("hello"), chit-chat, transient moods, daily updates, casual questions, temporary debugging logs, conversation closures.
2. NO SELF-MEMORIES: Assistant (Alfred) statements MUST NOT be converted into facts about ${userName}. Only information asserted, confirmed, or instructed by the user counts as a user memory.
3. FACT VS SPECULATION: Never manufacture certainty.
4. USER ATTRIBUTION: Clearly state the subject in third person (use "${userName}" rather than "the user").
5. EXPLICIT INSTRUCTIONS:
   - "Remember that X" -> High-priority candidate (action: "create", confidence >= 0.95).
   - "Don't remember this" or "Do not save this" -> Do NOT extract any memory (shouldRemember: false).
   - "Forget that X" or "I no longer prefer X" -> Create retraction candidate (action: "forget", confidence >= 0.95).
6. TEMPORAL & SUPERSESSION:
   - If user states they switched or migrated, specify action: "supersede" and set targetMemoryHint to describe the older fact being replaced.
7. PRIVACY: NEVER extract passwords, API keys, private keys, bearer tokens, or secrets.
8. RETURN ONLY A STRICT JSON OBJECT:
{
  "shouldRemember": boolean,
  "memories": [
    {
      "content": string,
      "memoryType": "user_preference" | "user_fact" | "project_fact" | "architectural_decision" | "technical_preference" | "constraint" | "relationship" | "workflow" | "general",
      "confidence": number,
      "action": "create" | "forget" | "supersede",
      "targetMemoryHint": string,
      "reasoning": string
    }
  ]
}
If there is nothing worth remembering, return {"shouldRemember": false, "memories": []}.`;
}

/**
 * Builds isolated messages for the Memory Extraction LLM invocation.
 * Strictly decoupled from Alfred's conversational persona.
 */
export function buildMemoryExtractionPrompt(input: MemoryExtractionInput): ChatMessage[] {
  const systemInstructions = buildMemoryExtractionSystemPrompt(input.userName || "Barış");

  const userPrompt = buildMemoryExtractionUserPrompt(input);

  return [
    { role: "system", content: systemInstructions },
    { role: "user", content: userPrompt }
  ];
}

/**
 * Production candidate thresholds (functions/index.js extractAndPersistMemories).
 * A candidate is dropped when `(confidence || 0) < MEMORY_MIN_CONFIDENCE` or
 * its trimmed content is shorter than MEMORY_MIN_CONTENT_LENGTH characters.
 */
export const MEMORY_MIN_CONFIDENCE = 0.7;
export const MEMORY_MIN_CONTENT_LENGTH = 5;

/**
 * What production does with a validated candidate:
 * - "create": store unless an active memory scores >= 0.85 (duplicate).
 * - "supersede": store and mark the first active memory scoring >= 0.5 as superseded.
 * - "forget": retract the best active match scoring >= 0.5.
 * - "unrecognized": any other truthy `action` value. Production stores it
 *   with neither the duplicate check nor supersession, because it compares
 *   the raw value against "create" / "supersede".
 */
export type ValidatedMemoryCandidateAction = MemoryExtractionAction | "unrecognized";

export interface ValidatedMemoryCandidate {
  /** `candidate.content.trim()` */
  content: string;
  action: ValidatedMemoryCandidateAction;
  /**
   * `candidate.memoryType || "general"`, unvalidated: production writes this
   * value to Firestore as-is, whatever JSON type the model returned.
   */
  memoryType: unknown;
  /** `Number(candidate.confidence || 0)`; can be NaN (production accepts NaN). */
  confidence: number;
}

/**
 * Production's gate on a parsed extraction payload: returns the `memories`
 * array to walk, or null for "nothing worth remembering" (falsy payload,
 * falsy `shouldRemember`, or `memories` not an array). Shared with
 * functions/index.js (bundled via esbuild).
 */
export function getMemoryExtractionCandidates(parsed: unknown): unknown[] | null {
  if (!parsed) return null;
  const payload = parsed as { shouldRemember?: unknown; memories?: unknown };
  if (!payload.shouldRemember || !Array.isArray(payload.memories)) return null;
  return payload.memories;
}

function normalizeAction(raw: unknown): ValidatedMemoryCandidateAction {
  const action = raw || "create";
  if (action === "create" || action === "forget" || action === "supersede") return action;
  return "unrecognized";
}

/**
 * Production's per-candidate validation, reproduced decision for decision.
 * Shared with functions/index.js (bundled via esbuild). Returns null for a
 * candidate production silently skips (no tally, no log): content missing or
 * not a string, trimmed content shorter than 5 characters, or
 * `(confidence || 0) < minConfidence` under JavaScript's `<` coercion (a
 * string "0.9" passes; a missing value, 0 or `[]` fails; `{}` or "high"
 * coerce to NaN and pass).
 *
 * The secret check (PrivacyFilter) is deliberately not part of this: callers
 * run it on the returned content, as production does.
 *
 * Like production, a null or undefined candidate throws a TypeError (reading
 * `.content`), which aborts the rest of the extraction in production.
 */
export function validateMemoryCandidate(
  candidate: unknown,
  minConfidence: number = MEMORY_MIN_CONFIDENCE
): ValidatedMemoryCandidate | null {
  // Property access on null/undefined throws here exactly as production's
  // `candidate.content` does; primitives and arrays yield undefined.
  const item = candidate as Record<string, unknown>;
  const rawContent = item.content;
  if (!rawContent || typeof rawContent !== "string") return null;
  const content = rawContent.trim();
  if (content.length < MEMORY_MIN_CONTENT_LENGTH) return null;
  // Number() applies the same ToPrimitive/ToNumber coercion that `<` does.
  const confidence = Number(item.confidence || 0);
  if (confidence < minConfidence) return null;

  return {
    content,
    action: normalizeAction(item.action),
    memoryType: item.memoryType || "general",
    confidence
  };
}

/**
 * Parses and validates JSON output from the memory extraction model with
 * production's rules (getMemoryExtractionCandidates + validateMemoryCandidate).
 *
 * Where src/ types cannot carry production's value, it is narrowed:
 * - a memoryType outside MemoryType becomes "general" (production stores it raw);
 * - an "unrecognized" action becomes "create", so MemoryService still runs
 *   its duplicate check (production skips it).
 * A candidate that makes production throw (a null/undefined entry) ends the
 * list there: production has already persisted the earlier candidates and
 * never reaches the later ones.
 */
export function parseMemoryExtractionResponse(
  rawText: string,
  minConfidence: number = MEMORY_MIN_CONFIDENCE
): MemoryExtractionResult {
  if (!rawText || !rawText.trim()) {
    return { shouldRemember: false, candidates: [], rawResponse: rawText };
  }

  const clean = extractJsonPayload(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    console.warn("[MemoryExtraction] Failed to parse LLM extraction JSON:", clean.slice(0, 200));
    return { shouldRemember: false, candidates: [], rawResponse: rawText };
  }

  const memories = getMemoryExtractionCandidates(parsed);
  if (!memories) {
    return { shouldRemember: false, candidates: [], rawResponse: rawText };
  }

  const validCandidates: ExtractedMemoryCandidate[] = [];

  for (const entry of memories) {
    let validated: ValidatedMemoryCandidate | null;
    try {
      validated = validateMemoryCandidate(entry, minConfidence);
    } catch {
      break;
    }
    if (!validated) continue;

    const item = entry as Record<string, unknown>;
    const memoryType =
      typeof validated.memoryType === "string" && VALID_MEMORY_TYPES.has(validated.memoryType as MemoryType)
        ? (validated.memoryType as MemoryType)
        : "general";

    validCandidates.push({
      content: validated.content,
      memoryType,
      confidence: validated.confidence,
      action: validated.action === "unrecognized" ? "create" : validated.action,
      targetMemoryHint: typeof item.targetMemoryHint === "string" ? item.targetMemoryHint.trim() : undefined,
      reasoning: typeof item.reasoning === "string" ? item.reasoning.trim() : undefined
    });
  }

  return {
    shouldRemember: validCandidates.length > 0,
    candidates: validCandidates,
    rawResponse: rawText
  };
}
