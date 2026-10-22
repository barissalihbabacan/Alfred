import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  loadCanonicalUserContext,
  UserProfileLoader,
  ContextBuilder,
  getAlfredSystemPrompt,
  ALFRED_CANONICAL_SYSTEM_PROMPT,
  USER_PROFILE_SOURCES
} from "../../src/ai/prompts/index.js";

describe("Canonical User Profile Layer", () => {
  it("1. should successfully load user profile files from users/ directory", () => {
    const context = loadCanonicalUserContext();

    expect(context).toBeDefined();
    expect(context.source).toBe("git");
    expect(context.sources.userProfile).toBe(fs.readFileSync(path.resolve(process.cwd(), "users/USER_PROFILE.md"), "utf8"));
    expect(context.sources.userProfile).toContain("Barış Salih Babacan");
    expect(context.sources.userProfile).toContain("Systems Architect");
    expect(context.sources.preferences).toContain("British English");
    expect(context.sources.workingStyle).toContain("vertical slices");
  });

  it("2. should not crash when users directory or optional files are missing (graceful fallback)", () => {
    // Non-existent directory
    const loader = new UserProfileLoader("/tmp/non-existent-alfred-users-path");
    const fallbackContext = loader.loadContextSync();

    expect(fallbackContext).toBeDefined();
    expect(fallbackContext.source).toBe("fallback");
    // Falls back to the copy of users/*.md embedded at build time.
    expect(fallbackContext.sources).toEqual(USER_PROFILE_SOURCES);
    // Same files as committed, so the prompt gets the reviewed digest.
    expect(ContextBuilder.formatUserProfileBlock(fallbackContext)).toContain("easy → hard");
  });

  it("2b. takes each readable file from disk and only the missing ones from the embedded copy", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alfred-users-"));
    try {
      fs.writeFileSync(path.join(dir, "USER_PROFILE.md"), "## Identity\n- **Name**: Test Person\n");
      const context = new UserProfileLoader(dir).loadContextSync();
      expect(context.source).toBe("fallback");
      expect(context.sources.userProfile).toBe("## Identity\n- **Name**: Test Person\n");
      expect(context.sources.preferences).toBe(USER_PROFILE_SOURCES.preferences);
      expect(context.sources.workingStyle).toBe(USER_PROFILE_SOURCES.workingStyle);
      expect(ContextBuilder.formatUserProfileBlock(context)).toContain("USER PROFILE:\nIdentity:\n- Name: Test Person\n");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("3. should include canonical user context in LLM system prompt when expected", () => {
    const contextualPrompt = getAlfredSystemPrompt();

    expect(contextualPrompt).toContain("=== CANONICAL USER PROFILE (GIT AUTHORITATIVE) ===");
    expect(contextualPrompt).toContain("- Barış Salih Babacan: Turkish native, fluent professional English.");
    expect(contextualPrompt).toContain("vertical slices");
    expect(contextualPrompt).toContain("- Push back on:");
  });

  it("4. should keep Alfred canonical assistant instructions intact alongside the profile", () => {
    const prompt = getAlfredSystemPrompt();

    // Assistant anchors must remain present
    expect(prompt).toContain("You are Alfred, Barış's personal AI assistant and software engineering partner.");
    expect(prompt).toContain("an engineering peer, never a customer-service chatbot");
    expect(prompt).toContain("slang, emojis");
    expect(prompt).toContain("calmly and firmly push back");
  });

  it("5. should not allow user profile to replace or override the Alfred persona", () => {
    // Both sections must coexist with the persona preceding the profile
    const prompt = getAlfredSystemPrompt();
    const personaIndex = prompt.indexOf("You are Alfred, Barış's personal AI assistant");
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
    const serialized = JSON.stringify(context) + ContextBuilder.formatUserProfileBlock(context);

    // Verify absence of sensitive patterns
    expect(serialized).not.toMatch(/gsk_[a-zA-Z0-9_-]{20,}/);
    expect(serialized).not.toMatch(/AIza[0-9A-Za-z-_]{35}/);
    expect(serialized).not.toContain("GROQ_API_KEY");
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("100.64.0.53");
    expect(serialized).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });

  it("8. should be strictly read-only and have no runtime mutation/write methods", () => {
    const loader = new UserProfileLoader();

    // Verify only read methods exist
    expect(typeof loader.loadContext).toBe("function");
    expect(typeof loader.loadContextSync).toBe("function");
    expect(typeof loader.clearCache).toBe("function");

    // Must NOT have mutating methods
    const untyped = loader as unknown as Record<string, unknown>;
    expect(untyped.saveContext).toBeUndefined();
    expect(untyped.writeProfile).toBeUndefined();
    expect(untyped.updateUser).toBeUndefined();
    expect(untyped.deleteProfile).toBeUndefined();

    // Verify files on disk have not been modified by read operations
    const profilePath = path.resolve(process.cwd(), "users/USER_PROFILE.md");
    const statsBefore = fs.statSync(profilePath);
    loader.loadContextSync();
    const statsAfter = fs.statSync(profilePath);
    expect(statsBefore.mtimeMs).toBe(statsAfter.mtimeMs);
  });
});
