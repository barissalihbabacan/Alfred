import { describe, it, expect } from "vitest";
import { getAlfredSystemPrompt } from "../../src/ai/prompts/alfred-persona.js";

describe("Alfred Persona System Prompt", () => {
  it("should supply canonical persona prompt with Butler and British traits", () => {
    const prompt = getAlfredSystemPrompt();
    expect(prompt).toBeDefined();
    expect(prompt).toContain("B.U.T.L.E.R. Alfred");
    expect(prompt).toContain("British gentleman");
    expect(prompt).toContain("British English");
  });

  it("should contain explicit pushback and risk awareness rules", () => {
    const prompt = getAlfredSystemPrompt();
    expect(prompt).toContain("calmly and firmly push back");
    expect(prompt).toContain("deleting a production database");
  });

  it("should declare capability boundaries and forbid slang/emojis", () => {
    const prompt = getAlfredSystemPrompt();
    expect(prompt).toContain("NEVER use colloquial slang");
    expect(prompt).toContain("NEVER use emojis");
    expect(prompt).toContain("Google Calendar");
    expect(prompt).toContain("Web Speech API");
  });

  it("should carry production's persona: Turkish replies, long-term memory and the live tool list", () => {
    const prompt = getAlfredSystemPrompt();
    expect(prompt).toContain("MULTILINGUAL ADAPTABILITY");
    expect(prompt).toContain('"Efendim" / "Barış Bey"');
    expect(prompt).toContain("Long-Term Semantic Memory (Firestore + Gemini embeddings)");
    expect(prompt).toContain("FORMATTING:");
    // Production offers only get_current_time; SSH is not connected, and the
    // persona says so instead of describing placeholder tools.
    expect(prompt).toContain("get_current_time");
    for (const tool of ["ssh_connect", "ssh_list_directory", "ssh_execute"]) {
      expect(prompt).not.toContain(tool);
    }
    expect(prompt).toContain("server access is not connected to you yet");
  });
});
