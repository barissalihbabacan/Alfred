import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import {
  loadCanonicalUserContext,
  UserProfileLoader,
  ContextBuilder,
  getAlfredSystemPrompt,
  ALFRED_CANONICAL_SYSTEM_PROMPT
} from "../../src/ai/prompts/index.js";

describe("Canonical User Profile Layer", () => {
  it("1. should successfully load user profile files from users/ directory", () => {
    const context = loadCanonicalUserContext();

    expect(context).toBeDefined();
    expect(context.profile.name).toBe("Barış");
    expect(context.profile.fullName).toBe("Barış Salih Babacan");
    expect(context.profile.role).toContain("Systems Architect");
    expect(context.profile.coreCompetencies.length).toBeGreaterThan(0);
    expect(context.preferences.defaultLanguageRegister).toContain("British");
    expect(context.workingStyle.incrementalDevelopment).toContain("vertical slices");
  });

  it("2. should not crash when users directory or optional files are missing (graceful fallback)", () => {
    // Non-existent directory
    const loader = new UserProfileLoader("/tmp/non-existent-alfred-users-path");
    const fallbackContext = loader.loadContextSync();

    expect(fallbackContext).toBeDefined();
    expect(fallbackContext.source).toBe("fallback");
    expect(fallbackContext.profile.name).toBe("Barış");
    expect(fallbackContext.preferences.formsOfAddress.english).toBe("sir");
    expect(fallbackContext.workingStyle.progressionModel).toContain("Easy → Hard");
  });

  it("3. should include canonical user context in LLM system prompt when expected", () => {
    const contextualPrompt = getAlfredSystemPrompt();

    expect(contextualPrompt).toContain("=== CANONICAL USER PROFILE (GIT AUTHORITATIVE) ===");
    expect(contextualPrompt).toContain("Barış (Barış Salih Babacan)");
    expect(contextualPrompt).toContain("Incremental Development");
    expect(contextualPrompt).toContain("PUSHBACK & RISK MANAGEMENT PROTOCOL");
  });

  it("4. should keep Alfred canonical persona fully intact alongside the profile", () => {
    const prompt = getAlfredSystemPrompt();

    // Persona anchors must remain present
    expect(prompt).toContain("B.U.T.L.E.R. Alfred");
    expect(prompt).toContain("British gentleman");
    expect(prompt).toContain("British English");
    expect(prompt).toContain("NEVER use colloquial slang");
    expect(prompt).toContain("calmly and firmly push back");
  });

  it("5. should not allow user profile to replace or override the Alfred persona", () => {
    // Both sections must coexist with the persona preceding the profile
    const prompt = getAlfredSystemPrompt();
    const personaIndex = prompt.indexOf("You are B.U.T.L.E.R. Alfred");
    const profileIndex = prompt.indexOf("=== CANONICAL USER PROFILE");

    expect(personaIndex).toBeGreaterThanOrEqual(0);
    expect(profileIndex).toBeGreaterThanOrEqual(0);
    expect(personaIndex).toBeLessThan(profileIndex);

    // Can also generate prompt without profile if requested
    const personaOnly = getAlfredSystemPrompt({ includeUserProfile: false });
    expect(personaOnly).not.toContain("=== CANONICAL USER PROFILE");
    expect(personaOnly).toBe(ALFRED_CANONICAL_SYSTEM_PROMPT);
  });

  it("6. should clearly demarcate canonical profile from conversation history and runtime state", () => {
    const context = loadCanonicalUserContext();
    const formattedBlock = ContextBuilder.formatUserProfileBlock(context);

    // Explicit boundary markers
    expect(formattedBlock.startsWith("=== CANONICAL USER PROFILE (GIT AUTHORITATIVE) ===")).toBe(true);
    expect(formattedBlock.endsWith("==================================================")).toBe(true);

    // Does not contain any conversation messages or dynamic turn attributes
    expect(formattedBlock).not.toContain("CURRENT CONVERSATION");
    expect(formattedBlock).not.toContain("message_id");
    expect(formattedBlock).not.toContain("turn_index");
  });

  it("7. should contain zero secrets, API keys, credentials, or private addresses", () => {
    const context = loadCanonicalUserContext();
    const serialized = JSON.stringify(context);

    // Verify absence of sensitive patterns
    expect(serialized).not.toMatch(/gsk_[a-zA-Z0-9_-]{20,}/);
    expect(serialized).not.toMatch(/AIza[0-9A-Za-z-_]{35}/);
    expect(serialized).not.toContain("GROQ_API_KEY");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("100.64.0.53");
    expect(serialized).not.toContain("secret");
  });

  it("8. should be strictly read-only and have no runtime mutation/write methods", () => {
    const loader = new UserProfileLoader();

    // Verify only read methods exist
    expect(typeof loader.loadContext).toBe("function");
    expect(typeof loader.loadContextSync).toBe("function");
    expect(typeof loader.clearCache).toBe("function");

    // Must NOT have mutating methods
    expect((loader as any).saveContext).toBeUndefined();
    expect((loader as any).writeProfile).toBeUndefined();
    expect((loader as any).updateUser).toBeUndefined();
    expect((loader as any).deleteProfile).toBeUndefined();

    // Verify files on disk have not been modified by read operations
    const profilePath = path.resolve(process.cwd(), "users/USER_PROFILE.md");
    const statsBefore = fs.statSync(profilePath);
    loader.loadContextSync();
    const statsAfter = fs.statSync(profilePath);
    expect(statsBefore.mtimeMs).toBe(statsAfter.mtimeMs);
  });
});
