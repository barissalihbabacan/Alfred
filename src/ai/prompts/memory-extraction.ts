import { ChatMessage } from "../providers/types.js";
import { MemoryExtractionInput, MemoryExtractionResult, ExtractedMemoryCandidate, MemoryExtractionAction } from "../../alfred/cognitive/memory/extractor/types.js";
import { MemoryType } from "../../data/firestore/memory.types.js";
import { PrivacyFilter } from "../../alfred/cognitive/memory/privacy-filter.js";

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

const VALID_ACTIONS = new Set<MemoryExtractionAction>(["create", "forget", "supersede"]);

/**
 * Builds isolated messages for the Memory Extraction LLM invocation.
 * Strictly decoupled from Alfred's conversational persona.
 */
export function buildMemoryExtractionPrompt(input: MemoryExtractionInput): ChatMessage[] {
  const userName = input.userName || "Barış";

  const systemInstructions = `You are Alfred's autonomous memory extraction subsystem.
Your task is to analyze conversational exchanges and identify durable, long-term information worth remembering across future conversations.

CRITICAL RULES:
1. DURABILITY: Only extract information that will remain useful in future, separate conversations.
   - GOOD: User preferences, stable facts about ${userName}, technical choices, architectural decisions, constraints, workflows, project facts.
   - BAD (NEVER REMEMBER): Greetings ("hello"), chit-chat, transient moods, daily updates, casual questions ("what time is it?"), temporary debugging logs, conversation closures.
2. NO SELF-MEMORIES: Assistant (Alfred) statements MUST NOT be converted into facts about ${userName}. Only information asserted, confirmed, or instructed by the user counts as a user memory.
3. FACT VS SPECULATION: Never manufacture certainty.
   - If user says: "I'm thinking about learning Rust", memory is: "${userName} is considering learning Rust", NOT "${userName} prefers Rust".
4. USER ATTRIBUTION: Clearly state the subject in third person (use "${userName}" rather than "the user").
5. EXPLICIT INSTRUCTIONS:
   - "Remember that X" -> High-priority candidate (action: "create", confidence >= 0.95).
   - "Don't remember this" or "Do not save this" -> Do NOT extract any memory (shouldRemember: false).
   - "Forget that X" or "I no longer prefer X" -> Create retraction candidate (action: "forget", confidence >= 0.95).
6. TEMPORAL & SUPERSESSION:
   - If user states they switched or migrated (e.g. "I switched from X to Y" or "We now use Z instead of W"), specify action: "supersede" and set targetMemoryHint to describe the older fact being replaced.
7. PRIVACY: NEVER extract passwords, API keys, private keys, bearer tokens, or secrets.
8. RETURN ONLY A STRICT JSON OBJECT:
{
  "shouldRemember": boolean,
  "memories": [
    {
      "content": string,
      "memoryType": "user_preference" | "user_fact" | "project_fact" | "architectural_decision" | "technical_preference" | "constraint" | "relationship" | "workflow" | "general",
      "confidence": number (0.0 to 1.0),
      "action": "create" | "forget" | "supersede",
      "targetMemoryHint": string (optional),
      "reasoning": string (optional)
    }
  ]
}
If there is nothing worth remembering, return {"shouldRemember": false, "memories": []}.`;

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

  const userPrompt = `${contextSegments.join("\n")}\n\nAnalyze the above exchange. Output JSON only.`;

  return [
    { role: "system", content: systemInstructions },
    { role: "user", content: userPrompt }
  ];
}

/**
 * Parses and strictly validates JSON output from the memory extraction model.
 */
export function parseMemoryExtractionResponse(
  rawText: string,
  minConfidence: number = 0.75
): MemoryExtractionResult {
  if (!rawText || !rawText.trim()) {
    return { shouldRemember: false, candidates: [], rawResponse: rawText };
  }

  // Strip possible thinking tags, e.g. <think>...</think>
  let clean = rawText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();

  // Extract JSON payload from markdown code blocks or search for first { and last }
  const jsonBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    clean = jsonBlockMatch[1].trim();
  } else {
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(clean);
  } catch {
    console.warn("[MemoryExtraction] Failed to parse LLM extraction JSON:", clean.slice(0, 200));
    return { shouldRemember: false, candidates: [], rawResponse: rawText };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { shouldRemember: false, candidates: [], rawResponse: rawText };
  }

  if (!parsed.shouldRemember || !Array.isArray(parsed.memories)) {
    return { shouldRemember: false, candidates: [], rawResponse: rawText };
  }

  const validCandidates: ExtractedMemoryCandidate[] = [];

  for (const item of parsed.memories) {
    if (typeof item !== "object" || item === null) continue;

    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content || content.length < 5 || content.length > 1000) continue;

    // Confidence check
    const conf = typeof item.confidence === "number" ? item.confidence : 0.8;
    if (conf < minConfidence) {
      continue;
    }

    // Memory type validation
    let mType: MemoryType = "general";
    if (typeof item.memoryType === "string" && VALID_MEMORY_TYPES.has(item.memoryType as MemoryType)) {
      mType = item.memoryType as MemoryType;
    }

    // Action validation
    let action: MemoryExtractionAction = "create";
    if (typeof item.action === "string" && VALID_ACTIONS.has(item.action as MemoryExtractionAction)) {
      action = item.action as MemoryExtractionAction;
    }

    validCandidates.push({
      content,
      memoryType: mType,
      confidence: Math.round(conf * 100) / 100,
      action,
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
