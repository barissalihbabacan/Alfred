import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ALFRED_PERSONA_PROMPT,
  ALFRED_SYSTEM_PROMPT,
  ALFRED_USER_PROFILE_SUMMARY,
  CONVERSATIONAL_GOVERNOR_BLOCK,
  buildAlfredSystemPrompt,
  type SystemPromptMemory
} from "../../src/ai/prompts/alfred-system-prompt.js";
import { ALFRED_CANONICAL_SYSTEM_PROMPT, getAlfredSystemPrompt } from "../../src/ai/prompts/alfred-persona.js";
import { ContextBuilder } from "../../src/alfred/cognitive/context/context-builder.js";

/**
 * Production's system prompt used to be an inline `ALFRED_SYSTEM_PROMPT`
 * template literal in functions/index.js. The fixture below is that string,
 * evaluated, copied verbatim from functions/index.js before the move to
 * src/ai/prompts/alfred-system-prompt.ts. `legacySystemPromptWithMemories` is
 * a verbatim copy of the code that appended retrieved memories to it.
 *
 * If one of these tests fails, the prompt production sends to the model has
 * changed. Update the fixture only as a deliberate production change.
 */
const LEGACY_ALFRED_SYSTEM_PROMPT = readFileSync(
  new URL("./fixtures/functions-alfred-system-prompt.txt", import.meta.url),
  "utf8"
);

function legacySystemPromptWithMemories(retrievedMemories: SystemPromptMemory[]): string {
  let systemPromptWithMemories = LEGACY_ALFRED_SYSTEM_PROMPT;
  if (retrievedMemories.length > 0) {
    const memoryLines = retrievedMemories.map((m) => `- [${m.memoryType}] ${m.content}`).join("\n");
    systemPromptWithMemories += `\n\n=== RETRIEVED LONG-TERM MEMORIES (SEMANTIC CONTEXT) ===\nThe following long-term memories were retrieved as potentially relevant to the user's input:\n${memoryLines}\nIntegrate these facts naturally into your response if relevant. Do not recite this context explicitly unless asked.\n==================================================`;
  }
  return systemPromptWithMemories;
}

describe("production system prompt (functions/index.js -> src/ai/prompts/alfred-system-prompt.ts)", () => {
  it("the fixture is the real old prompt, not an empty or truncated file", () => {
    expect(LEGACY_ALFRED_SYSTEM_PROMPT.length).toBe(13435);
    expect(LEGACY_ALFRED_SYSTEM_PROMPT.startsWith("You are B.U.T.L.E.R. Alfred")).toBe(true);
    expect(LEGACY_ALFRED_SYSTEM_PROMPT.endsWith("The user model informs your behaviour invisibly.\n" + "=".repeat(66))).toBe(true);
  });

  it("ALFRED_SYSTEM_PROMPT is byte-identical to the old inline prompt", () => {
    expect(ALFRED_SYSTEM_PROMPT).toBe(LEGACY_ALFRED_SYSTEM_PROMPT);
    expect(Buffer.from(ALFRED_SYSTEM_PROMPT, "utf8").equals(Buffer.from(LEGACY_ALFRED_SYSTEM_PROMPT, "utf8"))).toBe(true);
  });

  it("is composed of persona, profile summary and governor joined by blank lines", () => {
    expect(ALFRED_SYSTEM_PROMPT).toBe(
      `${ALFRED_PERSONA_PROMPT}\n\n${ALFRED_USER_PROFILE_SUMMARY}\n\n${CONVERSATIONAL_GOVERNOR_BLOCK}`
    );
  });

  it("without memories, returns exactly the old prompt", () => {
    expect(buildAlfredSystemPrompt()).toBe(legacySystemPromptWithMemories([]));
    expect(buildAlfredSystemPrompt([])).toBe(LEGACY_ALFRED_SYSTEM_PROMPT);
  });

  it("with memories, appends them exactly as the old inline code did", () => {
    const memories: SystemPromptMemory[] = [
      { memoryType: "user_preference", content: "Barış prefers TypeScript." },
      { memoryType: "general", content: "  untrimmed content stays untrimmed  " },
      { memoryType: "project_fact", content: "Line one\nline two with `backticks` and ${braces}" }
    ];
    expect(buildAlfredSystemPrompt(memories)).toBe(legacySystemPromptWithMemories(memories));
    expect(buildAlfredSystemPrompt(memories.slice(0, 1))).toBe(legacySystemPromptWithMemories(memories.slice(0, 1)));
  });

  it("functions/index.js no longer carries its own copy and sends the shared builder's output", () => {
    const source = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");
    expect(source).not.toContain("const ALFRED_SYSTEM_PROMPT");
    expect(source).not.toContain("=== RETRIEVED LONG-TERM MEMORIES");
    expect(source).toContain('import { buildAlfredSystemPrompt } from "../src/ai/prompts/alfred-system-prompt.js";');
    expect(source).toContain("const systemPromptWithMemories = buildAlfredSystemPrompt(retrievedMemories);");
    expect(source).toContain('{ role: "system", content: systemPromptWithMemories }');
  });
});

describe("src/ prompt composition shares production's persona and governor", () => {
  it("the canonical persona is production's persona", () => {
    expect(ALFRED_CANONICAL_SYSTEM_PROMPT).toBe(ALFRED_PERSONA_PROMPT);
    expect(getAlfredSystemPrompt({ includeUserProfile: false })).toBe(ALFRED_PERSONA_PROMPT);
  });

  it("ContextBuilder's governor block is production's governor block", () => {
    expect(ContextBuilder.formatGovernorBlock()).toBe(CONVERSATIONAL_GOVERNOR_BLOCK);
  });

  it("src/ still renders the profile from users/*.md, so the full prompt differs from production only there", () => {
    const srcPrompt = getAlfredSystemPrompt();
    expect(srcPrompt.startsWith(`${ALFRED_PERSONA_PROMPT}\n\n=== CANONICAL USER PROFILE (GIT AUTHORITATIVE) ===`)).toBe(true);
    expect(srcPrompt.endsWith(`\n\n${CONVERSATIONAL_GOVERNOR_BLOCK}`)).toBe(true);
  });
});
