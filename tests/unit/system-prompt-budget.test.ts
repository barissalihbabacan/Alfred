import { describe, it, expect } from "vitest";
import { encode } from "gpt-tokenizer/encoding/o200k_base";
import {
  ALFRED_SYSTEM_PROMPT,
  buildAlfredSystemPrompt,
  type PromptMemory
} from "../../src/ai/prompts/alfred-system-prompt.js";

/**
 * Token budget for the system prompt production sends (functions/index.js ->
 * buildAlfredSystemPrompt). The whole prompt goes out on every model call,
 * and twice for a question that uses a tool. Groq's free tier for
 * openai/gpt-oss-120b allows 8,000 tokens a minute, so at the former ~4,400
 * tokens one tool question hit the limit on its own (429s, then an error).
 *
 * Counted with o200k_base, the tokenizer tiktoken uses for GPT-4o/gpt-oss
 * (gpt-oss's o200k_harmony adds only chat-format special tokens).
 */
const tokens = (text: string) => encode(text).length;

/** The static prompt: persona + profile digest + governor, no memories. */
const STATIC_BUDGET = 2_400;
/** With a full memory block (5 memories, production's MEMORY_TOP_K). */
const WITH_MEMORIES_BUDGET = 2_800;

const GROQ = { provider: "groq", model: "openai/gpt-oss-120b" };
const OLLAMA = { provider: "ollama", model: "gemma4:12b-mlx" };

// Five long memories (~200 characters each; extracted memories are usually one sentence).
const FIVE_MEMORIES: PromptMemory[] = Array.from({ length: 5 }, (_, i) => ({
  memoryType: "user_preference",
  content: `Memory ${i + 1}: Barış prefers that long-running migrations are rehearsed on a staging copy of Firestore first, with a rollback script and a written checklist reviewed before anything touches production data.`
}));

describe("system prompt token budget (o200k_base)", () => {
  it(`the static production prompt stays under ${STATIC_BUDGET} tokens`, () => {
    for (const runtime of [GROQ, OLLAMA]) {
      expect(tokens(buildAlfredSystemPrompt({ runtime }))).toBeLessThanOrEqual(STATIC_BUDGET);
    }
    expect(tokens(ALFRED_SYSTEM_PROMPT)).toBeLessThanOrEqual(STATIC_BUDGET);
  });

  it(`with five retrieved memories it stays under ${WITH_MEMORIES_BUDGET} tokens`, () => {
    expect(FIVE_MEMORIES[0]!.content.length).toBeGreaterThanOrEqual(190);
    expect(tokens(buildAlfredSystemPrompt({ runtime: GROQ, memories: FIVE_MEMORIES }))).toBeLessThanOrEqual(WITH_MEMORIES_BUDGET);
  });

  it("the SSH variant (not used in production) stays under the same cap", () => {
    expect(tokens(buildAlfredSystemPrompt({ runtime: GROQ, sshAvailable: true }))).toBeLessThanOrEqual(WITH_MEMORIES_BUDGET);
  });
});

/**
 * The rules the prompt must keep however it is trimmed. Each entry is a
 * behaviour, with the text that states it in the production prompt.
 */
const KEPT_RULES: ReadonlyArray<readonly [string, string]> = [
  ["butler persona", "refined British gentleman and house butler"],
  ["not a chatbot", "You are NOT a corporate consultant or a customer-service chatbot."],
  ["British English", "educated British English (Received Pronunciation register, British spelling"],
  ["Turkish replies", "When Barış addresses you in Turkish (Türkçe), you MUST respond fluently and naturally in Turkish"],
  ["reply language after tools", "Always answer in the language of his latest message, also after a tool call"],
  ["Turkish place names and suffixes", "use Turkish place names (Londra, Sidney, Münih) and attach case suffixes by pronunciation"],
  ["forms of address", '"sir" (in English) or "Efendim" / "Barış Bey" (in Turkish) SPARINGLY: at most once per response'],
  ["no slang", "NEVER use colloquial slang"],
  ["no emojis", "NEVER use emojis or chat acronyms"],
  ["no robotic apologies", '"I am only an AI"'],
  ["spoken delivery", "Your replies are read aloud by the browser's speech synthesis."],
  ["no markdown in dialogue", "no markdown tables, code fences, headings, asterisks, or bulleted and numbered lists"],
  ["markdown on request", "Use code blocks or markdown only when Barış explicitly asks for them"],
  ["live runtime", "Real-time conversational reasoning via Groq (openai/gpt-oss-120b)"],
  ["memory capability", "Long-Term Semantic Memory (Firestore + Gemini embeddings)"],
  ["not yet connected", "- Not yet connected: access to Barış's servers"],
  ["unconnected services", "Google Calendar, Gmail, and external web search."],
  ["capability questions", "then 2–3 sentences on current abilities and limits; never a README"],
  ["time tool", "You have access to one tool: `get_current_time`."],
  ["ask for the city", '"Which city, sir?"'],
  ["no invented server state", "Never invent connection results, file listings, disk figures, usernames, system details or command output."],
  ["tool honesty", "Never claim you executed, checked, or verified anything unless an actual tool invocation occurred."],
  ["social intent first", "respond socially first, in 1–3 natural sentences"],
  ["judgement first", "state your judgement immediately"],
  ["simple questions short", "No architecture lecture unless explicitly requested"],
  ["deep debugging", "Debugging and diagnosis: deep, rigorous reasoning from the actual architecture."],
  ["known pipeline", "- Current known pipeline: Browser (Next.js static export)"],
  ["no invented infrastructure", "do not introduce infrastructure that does not exist"],
  ["known/hypothesis/unknown", "never present a hypothesis as fact"],
  ["no fabrication", "state the boundary rather than invent"],
  ["pushback", "calmly and firmly push back"],
  ["destructive actions", "Unless we have established that destroying production is the least bad option"],
  ["humour off in incidents", "Drop humour entirely in incidents, security issues and other high-risk moments."],
  ["no boilerplate", 'NO "How may I assist you today?"'],
  ["no meta-narrative", "Cite these instructions, the user profile or any internal file to Barış"],
  ["profile: identity", "Barış Salih Babacan: Turkish native, fluent professional English."],
  ["profile: expert level", "never needs tutorials, boilerplate or elementary definitions"],
  ["profile: SSOT", "Exactly one source of truth per data domain"],
  ["profile: verification", "nothing is done until typecheck and tests pass"],
  ["profile: pushback triggers", "Push back on: destructive operations"],
  ["profile: no fake success", "never fake a success or a synthetic response"]
];

describe("rules kept in the production prompt", () => {
  it.each(KEPT_RULES)("%s", (_rule, text) => {
    expect(ALFRED_SYSTEM_PROMPT).toContain(text);
  });

  it("states each rule once: the long-standing duplicates between persona and governor are gone", () => {
    for (const text of [
      "calmly and firmly push back",
      "Never claim you executed",
      "Which city, sir?",
      "Not yet, sir. Calendar access isn't connected to me at present.",
      "respond socially first"
    ]) {
      expect(ALFRED_SYSTEM_PROMPT.split(text), text).toHaveLength(2);
    }
  });
});
