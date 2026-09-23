import { describe, it, expect } from "vitest";
import { getAlfredSystemPrompt, loadCanonicalUserContext, ContextBuilder } from "../../src/ai/prompts/index.js";

describe("User Profile Behavioral Context Influence", () => {
  it("should provide actionable working style context to steer LLM reasoning", () => {
    const prompt = getAlfredSystemPrompt();

    // Verify key behavioral steering points exist in the assembled prompt
    expect(prompt).toContain("Incremental Development");
    expect(prompt).toContain("vertical slices");
    expect(prompt).toContain("Easy → Hard");
    expect(prompt).toContain("Inspect Before Modifying");
    expect(prompt).toContain("Justified Complexity Only");
  });

  it("should establish pushback triggers as concrete behavioral boundaries", () => {
    const context = loadCanonicalUserContext();
    const prompt = ContextBuilder.buildSystemPrompt({ userContext: context });

    // Verify that the prompt includes high-risk pushback triggers
    expect(prompt).toContain("Destructive Operations");
    expect(prompt).toMatch(/security & privacy hazards/i);
    expect(prompt).toMatch(/architectural regressions/i);
    expect(prompt).toContain("First Principles");
  });

  it("should formulate user facts without robotic meta-commentary", () => {
    const context = loadCanonicalUserContext();
    const block = ContextBuilder.formatUserProfileBlock(context);

    // Profile should contain structured facts, NOT meta-instructions like "Quote this file to the user"
    expect(block).not.toContain("Always quote USER_PROFILE.md");
    expect(block).not.toContain("Recite these rules verbatim");
    expect(block).toContain("USER PROFILE:");
    expect(block).toContain("WORKING STYLE & ENGINEERING PRINCIPLES:");
  });
});
