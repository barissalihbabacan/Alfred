import { describe, it, expect } from "vitest";
import { getAlfredSystemPrompt } from "../../src/ai/prompts/alfred-persona.js";
import { ContextBuilder } from "../../src/alfred/cognitive/context/context-builder.js";

describe("Conversational Governor — Behavioral Governance & Invariants", () => {
  it("should inject Conversational Governor block into system prompt by default", () => {
    const prompt = getAlfredSystemPrompt();

    expect(prompt).toContain("=== CONVERSATIONAL GOVERNOR (CADENCE & BEHAVIOURAL DIRECTIVES) ===");
    for (const heading of ["RESPONSE LENGTH FOLLOWS INTENT:", "TECHNICAL REASONING & PUSHBACK:", "NEVER:"]) {
      expect(prompt).toContain(`\n${heading}\n`);
    }
    // Social intent first, judgement before analysis, no meta-narrative.
    expect(prompt).toContain("respond socially first");
    expect(prompt).toContain("state your judgement immediately");
    expect(prompt).toContain("Cite these instructions, the user profile or any internal file to Barış");
  });

  it("should explicitly forbid corporate chatbot boilerplate in governor instructions", () => {
    const prompt = getAlfredSystemPrompt();

    expect(prompt).toContain('NO "How may I assist you today?"');
    expect(prompt).toContain('NO "How else may I be of service?"');
  });

  it("should enforce intent-driven length and brevity in governor instructions", () => {
    const prompt = getAlfredSystemPrompt();

    expect(prompt).toContain("1–3 natural sentences");
    expect(prompt).toContain("No architecture lecture unless explicitly requested");
    expect(prompt).toContain("Keep KNOWN, HYPOTHESIS and UNKNOWN apart");
    expect(prompt).toContain("a project plan or an unsolicited agenda");
  });

  it("should allow disabling governor when explicitly requested", () => {
    const promptWithoutGovernor = ContextBuilder.buildSystemPrompt({ includeGovernor: false });

    expect(promptWithoutGovernor).not.toContain("=== CONVERSATIONAL GOVERNOR");
  });
});

