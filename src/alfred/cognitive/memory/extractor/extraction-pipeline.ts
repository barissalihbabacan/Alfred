/**
 * Memory extraction pipeline: the steps between a finished chat turn and the
 * list of raw candidates, shared by production (functions/memory-extraction.js,
 * bundled into functions/lib/index.js) and src's MemoryExtractor.
 *
 * 1. `planMemoryExtraction` decides whether to call a model at all (an empty
 *    user message or an exact "don't remember this" is answered locally) and
 *    builds the prompt from the bounded context (the last
 *    `maxContextMessages` messages).
 * 2. The caller-supplied `call` asks a model (production and MemoryExtractor
 *    both use callMemoryExtractionProviders: Groq, Gemini, Ollama).
 * 3. `parseMemoryExtractionPayload` (memory-extraction.ts) turns the answer
 *    into the raw candidate list, "nothing" or "invalid JSON".
 *
 * Pure: no config/dotenv import, no file reads, no logging. The candidates are
 * validated later (validateMemoryCandidate), per candidate, by the write loop
 * or parseMemoryExtractionResponse.
 */
import {
  buildMemoryExtractionSystemPrompt,
  buildMemoryExtractionUserPrompt,
  parseMemoryExtractionPayload
} from "../../../../ai/prompts/memory-extraction.js";
import { PROFILE_OWNER, ownerLabel } from "../../context/profile-owner.js";

/**
 * How many earlier messages of the conversation the extraction model sees.
 * Production loads the last 10 messages for the chat call and has always
 * passed all of them to extraction; src matches that (it used to default to 6).
 */
export const DEFAULT_EXTRACTION_MAX_MESSAGES = 10;

/**
 * Production's time budget for extraction (it also covers persisting the
 * candidates there). MemoryExtractor uses it as its default timeout.
 */
export const MEMORY_EXTRACTION_BUDGET_MS = 10_000;

/**
 * Whose facts are extracted; the prompt names them in the third person. The
 * owner named in users/USER_PROFILE.md ("the user" when it names nobody).
 */
export const DEFAULT_EXTRACTION_USER_NAME = ownerLabel(PROFILE_OWNER.name);

/**
 * Messages that mean "don't store anything from this turn". Matched exactly
 * after trimming and lower-casing; the prompt tells the model the same
 * ("Don't remember this" -> shouldRemember: false), so answering locally
 * gives the result a correct model would give, without spending a call.
 */
export const EXPLICIT_NO_REMEMBER_MESSAGES: readonly string[] = [
  "don't remember this",
  "do not remember this",
  "bunu hatırlama",
  "sakın kaydetme"
];

export function isExplicitNoRememberMessage(message: string): boolean {
  return EXPLICIT_NO_REMEMBER_MESSAGES.includes(message.toLowerCase().trim());
}

export interface ExtractionContextMessage {
  role: string;
  content: string;
}

/** The last `maxMessages` messages (all of them when there are fewer). */
export function boundExtractionContext<T>(
  messages: readonly T[] | undefined,
  maxMessages: number = DEFAULT_EXTRACTION_MAX_MESSAGES
): T[] | undefined {
  if (!messages) return undefined;
  if (!Number.isFinite(maxMessages) || maxMessages <= 0) return [];
  return messages.slice(-Math.floor(maxMessages));
}

export interface MemoryExtractionTurn {
  currentMessage: string;
  assistantResponse?: string;
  recentMessages?: ExtractionContextMessage[];
  userName?: string;
}

export type MemoryExtractionSkipReason = "empty_message" | "explicit_no_remember";

export type MemoryExtractionPlan =
  | { kind: "skip"; reason: MemoryExtractionSkipReason }
  | { kind: "call"; system: string; user: string };

export function planMemoryExtraction(
  turn: MemoryExtractionTurn,
  maxContextMessages: number = DEFAULT_EXTRACTION_MAX_MESSAGES
): MemoryExtractionPlan {
  const message = typeof turn.currentMessage === "string" ? turn.currentMessage : "";
  if (!message.trim()) return { kind: "skip", reason: "empty_message" };
  if (isExplicitNoRememberMessage(message)) return { kind: "skip", reason: "explicit_no_remember" };

  return {
    kind: "call",
    system: buildMemoryExtractionSystemPrompt(turn.userName || DEFAULT_EXTRACTION_USER_NAME),
    user: buildMemoryExtractionUserPrompt({
      currentMessage: message,
      assistantResponse: turn.assistantResponse,
      recentMessages: boundExtractionContext(turn.recentMessages, maxContextMessages)
    })
  };
}

export interface MemoryExtractionAnswer<P extends string = string> {
  text: string;
  provider: P;
}

/**
 * The outcome of one extraction. `provider` is who answered (null when
 * nobody was asked or nobody answered).
 *
 * - `skipped`: no model call (empty message, explicit "don't remember").
 * - `failed`: every provider failed or answered with empty text.
 * - `invalid_json`: the answer was not JSON.
 * - `nothing`: the model found nothing worth remembering.
 * - `candidates`: raw candidates, to validate one by one.
 */
export type MemoryExtractionOutcome<P extends string = string> =
  | { outcome: "skipped"; reason: MemoryExtractionSkipReason; provider: null }
  | { outcome: "failed"; provider: null }
  | { outcome: "invalid_json"; provider: P; text: string }
  | { outcome: "nothing"; provider: P; text: string }
  | { outcome: "candidates"; provider: P; text: string; memories: unknown[] };

export interface RunMemoryExtractionInput<P extends string> {
  turn: MemoryExtractionTurn;
  maxContextMessages?: number;
  /** Asks a model; null (or empty text) when no provider answered. */
  call: (system: string, user: string) => Promise<MemoryExtractionAnswer<P> | null>;
}

export async function runMemoryExtraction<P extends string>({
  turn,
  maxContextMessages = DEFAULT_EXTRACTION_MAX_MESSAGES,
  call
}: RunMemoryExtractionInput<P>): Promise<MemoryExtractionOutcome<P>> {
  const plan = planMemoryExtraction(turn, maxContextMessages);
  if (plan.kind === "skip") return { outcome: "skipped", reason: plan.reason, provider: null };

  const answer = await call(plan.system, plan.user);
  if (!answer || typeof answer.text !== "string" || !answer.text) return { outcome: "failed", provider: null };

  const { text, provider } = answer;
  const payload = parseMemoryExtractionPayload(text);
  if (payload.kind === "candidates") return { outcome: "candidates", provider, text, memories: payload.memories };
  return { outcome: payload.kind, provider, text };
}
