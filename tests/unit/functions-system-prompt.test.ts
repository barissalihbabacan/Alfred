import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  ALFRED_PERSONA_PROMPT,
  ALFRED_SYSTEM_PROMPT,
  ALFRED_USER_PROFILE_BLOCK,
  CONVERSATIONAL_GOVERNOR_BLOCK,
  DEFAULT_ALFRED_RUNTIME,
  buildAlfredPersonaPrompt,
  buildAlfredSystemPrompt,
  describeReasoningRuntime,
  formatRetrievedMemoriesBlock,
  type PromptMemory
} from "../../src/ai/prompts/alfred-system-prompt.js";
import { ALFRED_CANONICAL_SYSTEM_PROMPT, getAlfredSystemPrompt } from "../../src/ai/prompts/alfred-persona.js";
import { ContextBuilder } from "../../src/alfred/cognitive/context/context-builder.js";
import { loadCanonicalUserContext } from "../../src/alfred/cognitive/context/user-profile-loader.js";
import { renderUserProfileBlock } from "../../src/alfred/cognitive/context/user-profile-renderer.js";
import type { RetrievedMemory } from "../../src/alfred/cognitive/memory/types.js";

/**
 * Production's system prompt (functions/index.js -> buildAlfredSystemPrompt).
 *
 * The fixture is the full prompt production sends for its default runtime
 * (Groq, openai/gpt-oss-120b) with no retrieved memories. It includes the
 * rendered users/*.md, so editing the persona, the governor OR users/*.md
 * changes it. Such a change is a deliberate change to Alfred's live
 * behaviour; after reviewing the diff, regenerate the fixture with
 *
 *   npx vitest run tests/unit/functions-system-prompt.test.ts -u
 *
 * (vitest rewrites the file from buildAlfredSystemPrompt(); CI never does).
 */
const FIXTURE = "./fixtures/functions-alfred-system-prompt.txt";
const GROQ = { provider: "groq", model: "openai/gpt-oss-120b" };
const OLLAMA = { provider: "ollama", model: "gemma4:12b-mlx" };

const functionsSource = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");
const readUsersFile = (name: string) => readFileSync(new URL(`../../users/${name}`, import.meta.url), "utf8");

describe("production system prompt fixture", () => {
  it("matches the committed fixture (regenerate with -u, see above)", async () => {
    await expect(buildAlfredSystemPrompt({ runtime: GROQ })).toMatchFileSnapshot(FIXTURE);
  });

  it("the fixture is the default prompt: persona, profile, governor joined by blank lines", () => {
    expect(DEFAULT_ALFRED_RUNTIME).toEqual(GROQ);
    expect(buildAlfredSystemPrompt({ runtime: GROQ })).toBe(ALFRED_SYSTEM_PROMPT);
    expect(ALFRED_SYSTEM_PROMPT).toBe(
      `${ALFRED_PERSONA_PROMPT}\n\n${ALFRED_USER_PROFILE_BLOCK}\n\n${CONVERSATIONAL_GOVERNOR_BLOCK}`
    );
    expect(buildAlfredSystemPrompt()).toBe(ALFRED_SYSTEM_PROMPT);
    expect(buildAlfredSystemPrompt({ memories: [] })).toBe(ALFRED_SYSTEM_PROMPT);
  });
});

describe("1. the user profile comes from users/*.md", () => {
  it("is users/*.md on disk rendered by the shared renderer", () => {
    const fromDisk = renderUserProfileBlock({
      userProfile: readUsersFile("USER_PROFILE.md"),
      preferences: readUsersFile("PREFERENCES.md"),
      workingStyle: readUsersFile("WORKING_STYLE.md")
    });
    expect(ALFRED_USER_PROFILE_BLOCK).toBe(fromDisk);
    expect(ALFRED_SYSTEM_PROMPT).toContain(`\n\n${fromDisk}\n\n`);
  });

  it("carries distinctive content from each file", () => {
    expect(ALFRED_SYSTEM_PROMPT).toContain("Role: Example Role, Example Title"); // USER_PROFILE.md
    expect(ALFRED_SYSTEM_PROMPT).toContain("Conclusion First (Inverted Pyramid)"); // PREFERENCES.md
    expect(ALFRED_SYSTEM_PROMPT).toContain("Extend, Don't Compete"); // WORKING_STYLE.md
  });

  it("the old hand-written summary is gone", () => {
    expect(ALFRED_SYSTEM_PROMPT).not.toContain("USER IDENTITY:");
    expect(ALFRED_SYSTEM_PROMPT).not.toContain("Core Stacks: Full-stack architecture, TypeScript & Node.js, distributed systems");
    expect(ALFRED_SYSTEM_PROMPT.split("=== CANONICAL USER PROFILE (GIT AUTHORITATIVE) ===")).toHaveLength(2);
  });

  it("src/ (UserProfileLoader + ContextBuilder) renders the same block and the same prompt", () => {
    const ctx = loadCanonicalUserContext();
    expect(ctx.source).toBe("git");
    expect(ContextBuilder.formatUserProfileBlock(ctx)).toBe(ALFRED_USER_PROFILE_BLOCK);
    expect(getAlfredSystemPrompt()).toBe(ALFRED_SYSTEM_PROMPT);
    expect(getAlfredSystemPrompt({ runtime: OLLAMA })).toBe(buildAlfredSystemPrompt({ runtime: OLLAMA }));
  });
});

describe("2. speech formatting", () => {
  it("the persona tells Alfred his replies are spoken and to avoid markdown unless asked", () => {
    expect(ALFRED_PERSONA_PROMPT).toContain("SPOKEN DELIVERY & FORMATTING:");
    expect(ALFRED_PERSONA_PROMPT).toContain("Your replies are read aloud by the browser's speech synthesis.");
    expect(ALFRED_PERSONA_PROMPT).toContain(
      "no markdown tables, code fences, headings, asterisks, or bulleted and numbered lists"
    );
    expect(ALFRED_PERSONA_PROMPT).toContain("Use natural punctuation (commas, full stops, em-dashes) to create pauses");
    expect(ALFRED_PERSONA_PROMPT).toContain("Use code blocks or markdown only when Barış explicitly asks for them (e.g. a code review");
  });

  it("matches the canonical rule in docs/persona/ALFRED_PERSONA.md", () => {
    const doc = readFileSync(new URL("../../docs/persona/ALFRED_PERSONA.md", import.meta.url), "utf8");
    expect(doc).toContain("**Speech-Ready Formatting**: Alfred's replies are read aloud by the browser's speech synthesis.");
    expect(doc).toContain("no markdown tables, code fences, headings, asterisks, or bulleted and numbered lists");
    expect(doc).toContain("Code blocks and markdown appear only when Barış explicitly asks for them");
  });
});

describe("3. capability line matches what production runs", () => {
  it("states the provider and model answering the turn", () => {
    expect(describeReasoningRuntime(GROQ)).toBe("Groq (openai/gpt-oss-120b)");
    expect(describeReasoningRuntime(OLLAMA)).toBe("Ollama (gemma4:12b-mlx) over the private network");
    expect(describeReasoningRuntime({ provider: " GROQ ", model: "llama-3.3-70b-versatile" })).toBe("Groq (llama-3.3-70b-versatile)");
    expect(describeReasoningRuntime({ provider: "other", model: "" })).toBe("other");
    expect(ALFRED_PERSONA_PROMPT).toContain("- Operational now: Real-time conversational reasoning via Groq (openai/gpt-oss-120b),");
    expect(buildAlfredPersonaPrompt(OLLAMA)).toContain("reasoning via Ollama (gemma4:12b-mlx) over the private network,");
    expect(buildAlfredSystemPrompt({ runtime: OLLAMA })).not.toContain("openai/gpt-oss-120b");
  });

  it("drops the stale claims (Ollama-first, Whisper, nomic-embed-text) and states speech and memory accurately", () => {
    expect(ALFRED_PERSONA_PROMPT).not.toContain("gemma4");
    expect(ALFRED_PERSONA_PROMPT).not.toContain("Whisper");
    expect(ALFRED_PERSONA_PROMPT).not.toContain("nomic-embed-text");
    expect(ALFRED_PERSONA_PROMPT).toContain("speech recognition and read-aloud speech synthesis in Barış's browser (Web Speech API)");
    expect(ALFRED_PERSONA_PROMPT).toContain("Long-Term Semantic Memory (Firestore + Gemini embeddings)");
    expect(functionsSource).toContain('const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";');
  });

  it("the tool list is exactly the tools functions/index.js offers the model", () => {
    const active = /let activeTools = \[([^\]]*)\]/.exec(functionsSource)?.[1] ?? "";
    expect(active.split(",").map((s) => s.trim()).filter(Boolean)).toEqual([
      "TIME_TOOL_DEFINITION",
      "SSH_TOOL_DEFINITION",
      "SSH_LIST_DIRECTORY_TOOL_DEFINITION",
      "SSH_EXECUTE_TOOL_DEFINITION"
    ]);
    for (const name of ["ssh_connect", "ssh_list_directory", "ssh_execute"]) {
      expect(functionsSource).toContain(`name: "${name}"`);
    }
    expect(ALFRED_PERSONA_PROMPT).toContain(
      "deterministic tool calling (get_current_time, ssh_connect, ssh_list_directory, ssh_execute)."
    );
  });

  it("the SSH allow-list is exactly ssh_execute's enum in functions/index.js", () => {
    const allowed = ["list_directory", "disk_usage", "current_directory", "identity", "system_info"];
    expect(functionsSource).toContain(`enum: ${JSON.stringify(allowed).replace(/,/g, ", ")}`);
    expect(ALFRED_PERSONA_PROMPT).toContain(
      "You may execute `ssh_execute` exclusively for five controlled commands: `list_directory`, `disk_usage`, `current_directory`, `identity`, and `system_info`."
    );
  });

  it("keeps the unchanged persona rules (Turkish replies, forms of address, SSH host, sandbox)", () => {
    expect(ALFRED_PERSONA_PROMPT).toContain(
      "When Barış addresses you in Turkish (Türkçe), you MUST respond fluently and naturally in Turkish"
    );
    expect(ALFRED_PERSONA_PROMPT).toContain('"sir" (in English) or "Efendim" / "Barış Bey" (in Turkish)');
    expect(ALFRED_PERSONA_PROMPT).toContain('invoke the `ssh_connect` tool with host: "home-server"');
    expect(ALFRED_PERSONA_PROMPT).toContain("Your access is strictly confined to the `Belgeler/` sandbox");
    expect(ALFRED_PERSONA_PROMPT).toContain("Google Calendar, Gmail, and external web search are not yet connected.");
  });
});

describe("4. one retrieved-memories block for src/ and production", () => {
  const memories: PromptMemory[] = [
    { memoryType: "user_preference", content: "Barış prefers TypeScript." },
    { memoryType: "general", content: "  untrimmed content\nover two lines  " },
    { memoryType: undefined, content: "untyped memory" },
    { memoryType: "project_fact", content: "   " }
  ];
  const expected = [
    "=== RETRIEVED LONG-TERM MEMORIES (SEMANTIC CONTEXT) ===",
    "The following long-term memories were retrieved as potentially relevant to the user's input:",
    "- [user_preference] Barış prefers TypeScript.",
    "- [general] untrimmed content over two lines",
    "- untyped memory",
    "Integrate these facts naturally into your response if relevant. Do not recite this context explicitly unless asked.",
    "=".repeat(50)
  ].join("\n");

  it("uses production's wording, trims and collapses content, keeps the stored type casing, skips empties", () => {
    expect(formatRetrievedMemoriesBlock(memories)).toBe(expected);
    expect(formatRetrievedMemoriesBlock([])).toBe("");
    expect(formatRetrievedMemoriesBlock(undefined)).toBe("");
    expect(formatRetrievedMemoriesBlock([{ memoryType: "general", content: " \n " }])).toBe("");
  });

  it("buildAlfredSystemPrompt appends it after the governor", () => {
    expect(buildAlfredSystemPrompt({ runtime: GROQ, memories })).toBe(`${ALFRED_SYSTEM_PROMPT}\n\n${expected}`);
  });

  it("ContextBuilder emits the same block", () => {
    const retrieved = memories.map((m, i): RetrievedMemory => ({
      memoryId: `m${i}`,
      content: m.content,
      memoryType: m.memoryType as RetrievedMemory["memoryType"],
      score: 0.9,
      createdAt: "2026-09-24T00:00:00.000Z"
    }));
    expect(ContextBuilder.formatMemoriesBlock(retrieved)).toBe(expected);
    expect(ContextBuilder.buildSystemPrompt({
      personaPrompt: ALFRED_CANONICAL_SYSTEM_PROMPT,
      relevantMemories: retrieved
    })).toBe(buildAlfredSystemPrompt({ memories }));
  });
});

describe("functions/index.js uses the shared builder", () => {
  it("imports buildAlfredSystemPrompt and sends its output with the live runtime and memories", () => {
    expect(functionsSource).toContain('import { buildAlfredSystemPrompt } from "../src/ai/prompts/alfred-system-prompt.js";');
    expect(functionsSource).toContain('const currentModel = activeProvider === "groq" ? groqModel : ollamaModel;');
    expect(functionsSource).toMatch(
      /const systemPromptWithMemories = buildAlfredSystemPrompt\(\{\s*runtime: \{ provider: activeProvider, model: currentModel \},\s*memories: retrievedMemories\s*\}\);/
    );
    expect(functionsSource).toContain('{ role: "system", content: systemPromptWithMemories }');
  });

  it("carries no prompt text or profile file reads of its own", () => {
    expect(functionsSource).not.toContain("const ALFRED_SYSTEM_PROMPT");
    expect(functionsSource).not.toContain("=== RETRIEVED LONG-TERM MEMORIES");
    expect(functionsSource).not.toContain("=== CANONICAL USER PROFILE");
    expect(functionsSource).not.toMatch(/readFileSync|USER_PROFILE\.md/);
  });
});
