import { describe, it, expect } from "vitest";
import { ContextBuilder } from "../../src/alfred/cognitive/context/context-builder.js";
import { RetrievedMemory } from "../../src/alfred/cognitive/memory/types.js";

// The block format itself is shared with production and pinned in
// tests/unit/functions-system-prompt.test.ts (formatRetrievedMemoriesBlock).
describe("ContextBuilder — Memory Integration", () => {
  const sampleMemories: RetrievedMemory[] = [
    {
      memoryId: "mem_1",
      content: "Barış prefers TypeScript for application development.",
      memoryType: "user_preference",
      score: 0.89,
      createdAt: new Date().toISOString()
    },
    {
      memoryId: "mem_2",
      content: "The Alfred project uses Ollama with Gemma 4 12B MLX.",
      memoryType: "project_fact",
      score: 0.81,
      createdAt: new Date().toISOString()
    }
  ];

  it("formats memories with explicit section boundaries and category tags", () => {
    const formatted = ContextBuilder.formatMemoriesBlock(sampleMemories);

    expect(formatted).toContain("=== RETRIEVED LONG-TERM MEMORIES (SEMANTIC CONTEXT) ===");
    expect(formatted).toContain("- [user_preference] Barış prefers TypeScript for application development.");
    expect(formatted).toContain("- [project_fact] The Alfred project uses Ollama with Gemma 4 12B MLX.");
    expect(formatted.endsWith("\n" + "=".repeat(50))).toBe(true);
  });

  it("returns empty string when memories array is empty or undefined", () => {
    expect(ContextBuilder.formatMemoriesBlock([])).toBe("");
    expect(ContextBuilder.formatMemoriesBlock(undefined as unknown as RetrievedMemory[])).toBe("");
  });

  it("injects memories into system prompt when present in ContextBuilderOptions", () => {
    const promptWithMemories = ContextBuilder.buildSystemPrompt({
      personaPrompt: "You are Alfred.",
      includeUserProfile: false,
      includeGovernor: false,
      relevantMemories: sampleMemories
    });

    expect(promptWithMemories).toContain("You are Alfred.");
    expect(promptWithMemories).toContain("=== RETRIEVED LONG-TERM MEMORIES (SEMANTIC CONTEXT) ===");
    expect(promptWithMemories).toContain("Barış prefers TypeScript");
  });

  it("omits memories block from system prompt when no memories are passed", () => {
    const promptWithoutMemories = ContextBuilder.buildSystemPrompt({
      personaPrompt: "You are Alfred.",
      includeUserProfile: false,
      includeGovernor: false,
      relevantMemories: []
    });

    expect(promptWithoutMemories).not.toContain("=== RETRIEVED LONG-TERM MEMORIES");
  });

  it("buildChatMessages places memories in system prompt alongside recent history and user message", () => {
    const messages = ContextBuilder.buildChatMessages({
      personaPrompt: "You are Alfred.",
      includeUserProfile: false,
      includeGovernor: false,
      relevantMemories: sampleMemories,
      history: [
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" }
      ],
      currentMessage: "What language do I like?"
    });

    expect(messages).toHaveLength(4); // system, user(prev), assistant(prev), user(current)

    // System message has memories
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toContain("=== RETRIEVED LONG-TERM MEMORIES (SEMANTIC CONTEXT) ===");
    expect(messages[0]!.content).toContain("TypeScript");

    // History and current message preserved
    expect(messages[1]).toEqual({ role: "user", content: "Previous question" });
    expect(messages[2]).toEqual({ role: "assistant", content: "Previous answer" });
    expect(messages[3]).toEqual({ role: "user", content: "What language do I like?" });
  });

  it("operates normally with conversation history when memory retrieval is empty or unavailable", () => {
    const messages = ContextBuilder.buildChatMessages({
      personaPrompt: "You are Alfred.",
      includeUserProfile: false,
      includeGovernor: false,
      relevantMemories: [],
      history: [{ role: "user", content: "Hi" }],
      currentMessage: "Hello"
    });

    expect(messages).toHaveLength(3);
    expect(messages[0]!.content).not.toContain("=== RETRIEVED LONG-TERM MEMORIES");
    expect(messages[1]).toEqual({ role: "user", content: "Hi" });
    expect(messages[2]).toEqual({ role: "user", content: "Hello" });
  });
});
