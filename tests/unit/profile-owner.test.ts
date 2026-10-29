import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PROFILE_OWNER,
  UNNAMED_OWNER_LABEL,
  ownerLabel,
  parseProfileOwner
} from "../../src/alfred/cognitive/context/profile-owner.js";
import {
  ALFRED_SYSTEM_PROMPT,
  buildAlfredSystemPrompt
} from "../../src/ai/prompts/alfred-system-prompt.js";
import { buildMemoryExtractionPrompt } from "../../src/ai/prompts/memory-extraction.js";
import { DEFAULT_EXTRACTION_USER_NAME } from "../../src/alfred/cognitive/memory/extractor/extraction-pipeline.js";
import { GOOGLE_CALENDAR_TOOL_DEFINITION } from "../../src/ai/tools/google/calendar.js";
import { GOOGLE_TASKS_TOOL_DEFINITION } from "../../src/ai/tools/google/tasks.js";
import { GMAIL_TOOL_DEFINITION } from "../../src/ai/tools/google/gmail.js";
import { READ_URL_TOOL_DEFINITION } from "../../src/ai/tools/web/read-url.js";
import { DEFAULT_ANSWERS, TEMPLATE_MAPPINGS, renderTemplate } from "../../scripts/init-profile.js";

// The prompts name the installation's owner from users/USER_PROFILE.md
// instead of a hard-coded name.

const ALL_TOOLS = {
  readUrlAvailable: true,
  githubAvailable: true,
  googleCalendarAvailable: true,
  googleTasksAvailable: true,
  gmailAvailable: true,
  webSearchAvailable: true
};
const FORMER_OWNER = /bar[ıi][şs]/i;

/** users/USER_PROFILE.md as `profile:init --name <name> --full-name <fullName>` writes it. */
function renderedUserProfile(name: string, fullName: string): string {
  const mapping = TEMPLATE_MAPPINGS.find((m) => m.destFile.endsWith("USER_PROFILE.md"));
  if (!mapping) throw new Error("USER_PROFILE.md mapping missing");
  return renderTemplate(readFileSync(mapping.templateFile, "utf8"), {
    ...DEFAULT_ANSWERS,
    USER_NAME: name,
    USER_FULL_NAME: fullName
  });
}

describe("parseProfileOwner", () => {
  it("reads the name line init-profile writes", () => {
    expect(parseProfileOwner("- **Name**: Alex (Full name: Alex Doe)\n")).toEqual({ name: "Alex", fullName: "Alex Doe" });
    expect(parseProfileOwner(renderedUserProfile("Ayşe", "Ayşe Yılmaz"))).toEqual({ name: "Ayşe", fullName: "Ayşe Yılmaz" });
  });

  it("uses the short name as full name when none is given, and '' when nobody is named", () => {
    expect(parseProfileOwner("- **Name**: Ada\n")).toEqual({ name: "Ada", fullName: "Ada" });
    expect(parseProfileOwner("# Profile\n- **Role**: Engineer\n")).toEqual({ name: "", fullName: "" });
    expect(ownerLabel("")).toBe(UNNAMED_OWNER_LABEL);
    expect(ownerLabel("  Ada ")).toBe("Ada");
  });

  it("takes the owner of this installation from the committed example profile", () => {
    expect(PROFILE_OWNER).toEqual({ name: "Alex", fullName: "Alex Doe" });
  });
});

describe("the prompts use the configured owner name", () => {
  it("the production prompt built from the committed example names Alex and never the former owner", () => {
    expect(ALFRED_SYSTEM_PROMPT).toContain("You are Alfred, Alex's personal AI assistant");
    expect(ALFRED_SYSTEM_PROMPT).toContain("to Alex.");
    const withAllTools = buildAlfredSystemPrompt(ALL_TOOLS);
    expect(withAllTools).toContain("access to Alex's Gmail account");
    expect(withAllTools).not.toMatch(FORMER_OWNER);
  });

  it("changing the profile name changes every mention in the prompt", () => {
    const { name } = parseProfileOwner(renderedUserProfile("Ayşe", "Ayşe Yılmaz"));
    const prompt = buildAlfredSystemPrompt({ ...ALL_TOOLS, ownerName: name });
    expect(prompt).toContain("You are Alfred, Ayşe's personal AI assistant");
    expect(prompt).toContain("Your replies appear in Ayşe's chat window");
    expect(prompt).toContain("Whenever Ayşe asks the time somewhere");
    expect(prompt).toContain("If Ayşe proposes something reckless");
    expect(prompt).toContain("access to Ayşe's primary Google Calendar");
    // Only the name differs from the default prompt.
    expect(prompt.replaceAll("Ayşe", "Alex")).toBe(buildAlfredSystemPrompt(ALL_TOOLS));
  });

  it("an unnamed owner is 'the user'", () => {
    const prompt = buildAlfredSystemPrompt({ ownerName: "" });
    expect(prompt).toContain("You are Alfred, the user's personal AI assistant");
  });

  it("the memory extraction prompt attributes facts to the configured owner", () => {
    expect(DEFAULT_EXTRACTION_USER_NAME).toBe("Alex");
    const [system] = buildMemoryExtractionPrompt({ currentMessage: "I use Vim.", userId: "u" });
    expect(system!.content).toContain('use "Alex" rather than "the user"');
    expect(system!.content).not.toMatch(FORMER_OWNER);
    const [named] = buildMemoryExtractionPrompt({ currentMessage: "I use Vim.", userId: "u", userName: "Ayşe" });
    expect(named!.content).toContain('use "Ayşe" rather than "the user"');
  });

  it("tool descriptions name no one", () => {
    for (const tool of [GOOGLE_CALENDAR_TOOL_DEFINITION, GOOGLE_TASKS_TOOL_DEFINITION, GMAIL_TOOL_DEFINITION, READ_URL_TOOL_DEFINITION]) {
      expect(JSON.stringify(tool)).not.toMatch(FORMER_OWNER);
    }
  });

  it("refers to the user without gendered pronouns", () => {
    // The owner can be anyone: "they/their" or the name, never he/she forms.
    // No exceptions today (the prompt's Turkish examples contain no "her").
    const gendered = /\b(he|him|his|himself|she|her|hers|herself)\b/gi;
    for (const sshAvailable of [false, true]) {
      const prompt = buildAlfredSystemPrompt({ ...ALL_TOOLS, sshAvailable, memories: [{ content: "Alex uses Vim." }] });
      expect(prompt.match(gendered), `sshAvailable=${sshAvailable}`).toBeNull();
    }
    const [system] = buildMemoryExtractionPrompt({ currentMessage: "I use Vim.", userId: "u" });
    expect(system!.content.match(gendered)).toBeNull();
  });
});

