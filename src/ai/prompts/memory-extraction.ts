import { ChatMessage } from "../providers/types.js";
import { MemoryExtractionInput, MemoryExtractionResult, ExtractedMemoryCandidate, MemoryExtractionAction } from "../../alfred/cognitive/memory/extractor/types.js";
import { MemoryType } from "../../data/firestore/memory.types.js";
import { PROFILE_OWNER, ownerLabel } from "../../alfred/cognitive/context/profile-owner.js";

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
   - If user states they switched or migrated, specify action: "supersede" and state the new fact in content; it replaces the closest older memory on the same subject.
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
  const systemInstructions = buildMemoryExtractionSystemPrompt(input.userName || ownerLabel(PROFILE_OWNER.name));

  const userPrompt = buildMemoryExtractionUserPrompt(input);

  return [
    { role: "system", content: systemInstructions },
    { role: "user", content: userPrompt }
  ];
}

/**
 * Production candidate thresholds (functions/index.js extractAndPersistMemories).
 * A candidate is dropped when its confidence is below MEMORY_MIN_CONFIDENCE or
 * its trimmed content is shorter than MEMORY_MIN_CONTENT_LENGTH characters.
 */
export const MEMORY_MIN_CONFIDENCE = 0.7;
export const MEMORY_MIN_CONTENT_LENGTH = 5;

/** The actions the extraction prompt allows. */
export const MEMORY_EXTRACTION_ACTIONS: readonly MemoryExtractionAction[] = ["create", "forget", "supersede"];

/** The memory types the extraction prompt allows (every MemoryType). */
export const MEMORY_EXTRACTION_TYPES: readonly MemoryType[] = [...VALID_MEMORY_TYPES];

/**
 * A candidate that passed validation. What production does with it:
 * - "create": store unless an active memory scores >= 0.85 (duplicate).
 * - "supersede": store and mark the first active memory scoring >= 0.5 as superseded.
 * - "forget": retract the best active match scoring >= 0.5.
 */
export interface ValidatedMemoryCandidate {
  /** `candidate.content.trim()` */
  content: string;
  /** One of the prompt's actions; anything else becomes "create". */
  action: MemoryExtractionAction;
  /** One of the prompt's memory types; anything else becomes "general". */
  memoryType: MemoryType;
  /** A finite number in [0, 1], at least the threshold. */
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

/**
 * "create" | "forget" | "supersede", matched case-insensitively after
 * trimming. Anything else (missing, empty, "update", "merge", a non-string)
 * is treated as "create", so the duplicate check still applies to it.
 */
export function normalizeMemoryAction(raw: unknown): MemoryExtractionAction {
  if (typeof raw !== "string") return "create";
  const action = raw.trim().toLowerCase();
  return MEMORY_EXTRACTION_ACTIONS.find((a) => a === action) ?? "create";
}

/**
 * One of the prompt's memory types, matched case-insensitively after
 * trimming; anything else (missing, unknown, a non-string) is "general".
 */
export function normalizeMemoryType(raw: unknown): MemoryType {
  if (typeof raw !== "string") return "general";
  const memoryType = raw.trim().toLowerCase();
  return MEMORY_EXTRACTION_TYPES.find((t) => t === memoryType) ?? "general";
}

const DECIMAL_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * The candidate's confidence as a number in [0, 1], or null when it has no
 * usable one. A finite number, or a string holding a plain decimal number
 * ("0.9", " 0.8 ", "1e0"), is accepted if it lies in [0, 1]. Everything else
 * is rejected: missing, null, booleans, arrays, objects, words ("high"),
 * empty or hex strings, NaN, Infinity, and values outside [0, 1] (1.5, -0.1).
 */
export function parseMemoryConfidence(raw: unknown): number | null {
  let value: number;
  if (typeof raw === "number") {
    value = raw;
  } else if (typeof raw === "string" && DECIMAL_NUMBER.test(raw.trim())) {
    value = Number(raw.trim());
  } else {
    return null;
  }
  if (!Number.isFinite(value) || value < 0 || value > 1) return null;
  return value;
}

/**
 * Production's per-candidate validation. Shared with functions/index.js
 * (bundled via esbuild). Returns null for a candidate to skip: not a plain
 * object (null, a primitive, an array), content missing or not a string,
 * trimmed content shorter than 5 characters, or a confidence that
 * parseMemoryConfidence rejects or that is below `minConfidence`. It never
 * throws, so one bad entry cannot abort the rest of the list.
 *
 * The secret check (PrivacyFilter) is deliberately not part of this: callers
 * run it on the returned content, as production does.
 */
export function validateMemoryCandidate(
  candidate: unknown,
  minConfidence: number = MEMORY_MIN_CONFIDENCE
): ValidatedMemoryCandidate | null {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const item = candidate as Record<string, unknown>;
  const rawContent = item.content;
  if (!rawContent || typeof rawContent !== "string") return null;
  const content = rawContent.trim();
  if (content.length < MEMORY_MIN_CONTENT_LENGTH) return null;
  const confidence = parseMemoryConfidence(item.confidence);
  if (confidence === null || confidence < minConfidence) return null;

  return {
    content,
    action: normalizeMemoryAction(item.action),
    memoryType: normalizeMemoryType(item.memoryType),
    confidence
  };
}


export type MemoryExtractionPayload =
  | { kind: "invalid_json" }
  | { kind: "nothing" }
  | { kind: "candidates"; memories: unknown[] };

/**
 * Production's parse of the extraction model's answer: extractJsonPayload,
 * JSON.parse, then getMemoryExtractionCandidates (a falsy payload, a falsy
 * `shouldRemember` or a non-array `memories` is "nothing"). Shared with
 * functions/memory-extraction.js through extraction-pipeline.ts.
 */
export function parseMemoryExtractionPayload(rawText: string): MemoryExtractionPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(rawText));
  } catch {
    return { kind: "invalid_json" };
  }
  const memories = getMemoryExtractionCandidates(parsed);
  return memories ? { kind: "candidates", memories } : { kind: "nothing" };
}

/**
 * The raw candidates that pass validateMemoryCandidate, in order, with the
 * model's `reasoning` kept for debugging.
 */
export function toExtractedMemoryCandidates(
  memories: readonly unknown[],
  minConfidence: number = MEMORY_MIN_CONFIDENCE
): ExtractedMemoryCandidate[] {
  const validCandidates: ExtractedMemoryCandidate[] = [];
  for (const entry of memories) {
    const validated = validateMemoryCandidate(entry, minConfidence);
    if (!validated) continue;

    const item = entry as Record<string, unknown>;
    validCandidates.push({
      ...validated,
      reasoning: typeof item.reasoning === "string" ? item.reasoning.trim() : undefined
    });
  }
  return validCandidates;
}

/**
 * Parses and validates JSON output from the memory extraction model with
 * production's rules (parseMemoryExtractionPayload + validateMemoryCandidate),
 * so src and production accept the same candidates, in the same order, with
 * the same action, memoryType and confidence. Never logs the model's output
 * (it holds what the user said).
 */
export function parseMemoryExtractionResponse(
  rawText: string,
  minConfidence: number = MEMORY_MIN_CONFIDENCE
): MemoryExtractionResult {
  if (!rawText || !rawText.trim()) {
    return { shouldRemember: false, candidates: [], rawResponse: rawText };
  }

  const payload = parseMemoryExtractionPayload(rawText);
  if (payload.kind !== "candidates") {
    if (payload.kind === "invalid_json") {
      console.warn(`[MemoryExtraction] Extraction response was not valid JSON (${rawText.length} chars).`);
    }
    return { shouldRemember: false, candidates: [], rawResponse: rawText };
  }

  const validCandidates = toExtractedMemoryCandidates(payload.memories, minConfidence);
  return {
    shouldRemember: validCandidates.length > 0,
    candidates: validCandidates,
    rawResponse: rawText
  };
}
