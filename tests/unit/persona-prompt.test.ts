import { describe, it, expect } from "vitest";
import { getAlfredSystemPrompt } from "../../src/ai/prompts/alfred-persona.js";

describe("Alfred Persona System Prompt", () => {
  it("should supply the canonical assistant prompt: Alfred, an engineering peer rather than a chatbot, without butler role-play", () => {
    const prompt = getAlfredSystemPrompt();
    expect(prompt).toBeDefined();
    expect(prompt).toContain("You are Alfred, Barış's personal AI assistant and software engineering partner.");
    expect(prompt).toContain("an engineering peer, never a customer-service chatbot");
    expect(prompt).not.toMatch(/butler|British gentleman|Received Pronunciation|Efendim|"sir"/);
  });

  it("should contain explicit pushback and risk awareness rules", () => {
    const prompt = getAlfredSystemPrompt();
    expect(prompt).toContain("calmly and firmly push back");
    expect(prompt).toContain("deleting a production database");
  });

  it("should declare capability boundaries and forbid slang/emojis", () => {
    const prompt = getAlfredSystemPrompt();
    expect(prompt).toContain("slang, emojis");
    expect(prompt).toContain("Google Calendar");
    expect(prompt).toContain("Web Speech API");
  });

  it("should carry production's instructions: Turkish replies, long-term memory and the live tool list", () => {
    const prompt = getAlfredSystemPrompt();
    expect(prompt).toContain("Always answer in the language of his latest message");
    expect(prompt).toContain("Long-Term Semantic Memory (Firestore + Gemini embeddings)");
    expect(prompt).toContain("FORMATTING:");
    expect(prompt).toContain("get_current_time");
    for (const tool of ["ssh_connect", "ssh_list_directory", "ssh_execute"]) {
      expect(prompt).not.toContain(tool);
    }
    expect(prompt).toContain("say plainly that it is not connected yet");
  });
});
