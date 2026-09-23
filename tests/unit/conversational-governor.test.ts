import { describe, it, expect } from "vitest";
import { getAlfredSystemPrompt } from "../../src/ai/prompts/alfred-persona.js";
import { ContextBuilder } from "../../src/alfred/cognitive/context/context-builder.js";

describe("Conversational Governor — Behavioral Governance & Invariants", () => {
  it("should inject Conversational Governor block into system prompt by default", () => {
    const prompt = getAlfredSystemPrompt();

    expect(prompt).toContain("=== CONVERSATIONAL GOVERNOR (CADENCE & BEHAVIOURAL DIRECTIVES) ===");
    expect(prompt).toContain("ESTABLISHED WORKING RELATIONSHIP & PEER REGISTER");
    expect(prompt).toContain("SOCIAL INTENT COMES FIRST");
    expect(prompt).toContain("JUDGEMENT BEFORE ANALYSIS");
    expect(prompt).toContain("INTENT-DRIVEN RESPONSE LENGTH");
    expect(prompt).toContain("CONTEXT-AWARE TECHNICAL REASONING");
    expect(prompt).toContain("PUSHBACK & DESTRUCTIVE OPERATIONS");
    expect(prompt).toContain("STRICT ANTI-PATTERNS (WHAT NEVER TO DO)");
    expect(prompt).toContain("HUMOUR & DEMEANOR");
    expect(prompt).toContain("CAPABILITY & TOOL HONESTY");
    expect(prompt).toContain("ZERO META-NARRATIVE");
  });

  it("should explicitly forbid corporate chatbot boilerplate in governor instructions", () => {
    const prompt = getAlfredSystemPrompt();

    expect(prompt).toContain('NO "How may I assist you today?"');
    expect(prompt).toContain('NO "I stand ready to assist"');
    expect(prompt).toContain('NO "Should you wish..."');
    expect(prompt).toContain('NO "How else may I be of service?"');
  });

  it("should enforce intent-driven length and brevity in governor instructions", () => {
    const prompt = getAlfredSystemPrompt();

    expect(prompt).toContain("1–3 natural sentences");
    expect(prompt).toContain("No architecture lecture unless explicitly requested");
    expect(prompt).toContain("Distinguish verified facts, working hypotheses, and unknowns");
    expect(prompt).toContain("Never generate an unsolicited agenda");
  });

  it("should allow disabling governor when explicitly requested", () => {
    const promptWithoutGovernor = ContextBuilder.buildSystemPrompt({ includeGovernor: false });

    expect(promptWithoutGovernor).not.toContain("=== CONVERSATIONAL GOVERNOR");
  });
});

