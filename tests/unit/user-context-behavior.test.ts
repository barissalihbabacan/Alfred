import { describe, it, expect } from "vitest";
import { getAlfredSystemPrompt, loadCanonicalUserContext, ContextBuilder } from "../../src/ai/prompts/index.js";

describe("User Profile Behavioral Context Influence", () => {
  it("should provide actionable working style context to steer LLM reasoning", () => {
    const prompt = getAlfredSystemPrompt();

    // Key behavioural steering points from users/WORKING_STYLE.md, as the digest states them
    expect(prompt).toContain("complete, verified vertical slices built easy → hard");
    expect(prompt).toContain("inspect the code, dependencies and configuration before proposing changes");
    expect(prompt).toContain("Abstractions must earn their place");
    expect(prompt).toContain("no scope creep");
  });

  it("should establish pushback triggers as concrete behavioral boundaries", () => {
    const context = loadCanonicalUserContext();
    const prompt = ContextBuilder.buildSystemPrompt({ userContext: context });

    // Verify that the prompt includes high-risk pushback triggers
    expect(prompt).toContain("Push back on: destructive operations");
    expect(prompt).toMatch(/security and privacy hazards/i);
    expect(prompt).toMatch(/architectural regressions/i);
    expect(prompt).toMatch(/force-pushes or deploys that skip typechecks and tests/);
    expect(prompt).toContain("first principles");
  });

  it("should formulate user facts without robotic meta-commentary", () => {
    const context = loadCanonicalUserContext();
    const block = ContextBuilder.formatUserProfileBlock(context);

    // Profile should contain structured facts, NOT meta-instructions like "Quote this file to the user"
    expect(block).not.toContain("Always quote USER_PROFILE.md");
    expect(block).not.toContain("Recite these rules verbatim");
    expect(block).toContain("Barış Salih Babacan");
    expect(block).toContain("Engineering principles:");
  });
});
