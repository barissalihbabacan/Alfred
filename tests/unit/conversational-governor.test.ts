import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAlfredSystemPrompt } from "../../src/ai/prompts/alfred-persona.js";
import { ContextBuilder } from "../../src/alfred/cognitive/context/context-builder.js";
import { POST } from "../../apps/web/app/api/chat/route.js";
import { NextRequest } from "next/server";
import * as providerFactory from "../../src/ai/providers/factory.js";

describe("Conversational Governor — Behavioral Governance & Invariants", () => {
  it("should inject Conversational Governor block into system prompt by default", () => {
    const prompt = getAlfredSystemPrompt();

    expect(prompt).toContain("=== CONVERSATIONAL GOVERNOR (CADENCE & BEHAVIOURAL DIRECTIVES) ===");
    expect(prompt).toContain("COLLABORATION DYNAMIC & PEER REGISTER");
    expect(prompt).toContain("INTENT-DRIVEN RESPONSE LENGTH");
    expect(prompt).toContain("STRICT ANTI-PATTERNS (WHAT NEVER TO DO)");
    expect(prompt).toContain("HUMOUR & DEMEANOR");
    expect(prompt).toContain("PUSHBACK & INTEGRITY");
    expect(prompt).toContain("CAPABILITY & TOOL HONESTY");
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
    expect(prompt).toContain("Distinguish verified facts from working hypotheses");
    expect(prompt).toContain("Never generate an unsolicited agenda");
  });

  it("should allow disabling governor when explicitly requested", () => {
    const promptWithoutGovernor = ContextBuilder.buildSystemPrompt({ includeGovernor: false });

    expect(promptWithoutGovernor).not.toContain("=== CONVERSATIONAL GOVERNOR");
  });
});

describe("Conversational Governor — Minimum Required Behavioral Tests", () => {
  let providerSpy: any;

  beforeEach(() => {
    // By default for unit tests, mock provider as unconfigured so fallback executes deterministically without network
    const mockUnconfiguredProvider = {
      id: "fallback-persona",
      name: "Fallback Persona",
      isConfigured: () => false,
      chat: vi.fn(),
      streamChat: vi.fn()
    };
    providerSpy = vi.spyOn(providerFactory, "getAIProvider").mockReturnValue(mockUnconfiguredProvider as any);
  });

  afterEach(() => {
    providerSpy.mockRestore();
  });

  function makeChatRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest("http://localhost:3000/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  it("Test 1 — Casual greeting: should respond shortly and naturally without corporate boilerplate", async () => {
    const req = makeChatRequest({ message: "Good morning, Alfred.", stream: false });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);

    const text = data.text;
    // Must be short (<= 3 sentences)
    const sentenceCount = text.split(/[.!?]+/).filter(Boolean).length;
    expect(sentenceCount).toBeLessThanOrEqual(3);

    // Must be natural and refined British
    expect(text).toContain("Good morning");
    expect(text).toContain("sir");

    // Must NOT contain corporate assistance inquiries or unsolicited agendas
    expect(text).not.toContain("How may I assist");
    expect(text).not.toContain("at your disposal");
    expect(text).not.toContain("Should we begin by reviewing");
    expect(text).not.toContain("architectural priorities");
  });

  it("Test 2 — Casual humour: should offer dry, observational wit without forced joke essay", async () => {
    const req = makeChatRequest({ message: "Tell me something mildly amusing.", stream: false });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    const text = data.text;

    // Must be brief
    expect(text.length).toBeLessThan(350);

    // Observational humour (rabbits / feature request)
    expect(text).toMatch(/rabbits|feature request/i);

    // No Wikipedia or historical essay formatting
    expect(text).not.toContain("In conclusion");
    expect(text).not.toContain("Historically speaking");
  });

  it("Test 3 — Capability question: should open conversationally and summarize limits concisely", async () => {
    const req = makeChatRequest({ message: "What are you capable of?", stream: false });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    const text = data.text;

    // Conversational opening
    expect(text).toMatch(/At present\?/i);

    // Concise capability mention
    expect(text).toMatch(/streaming|reason|Ollama|Groq/i);

    // Honest limitations without huge technical README dump
    expect(text).toMatch(/calendar|email|repository/i);
    expect(text).not.toContain("=== CANONICAL");
    expect(text.length).toBeLessThan(500);
  });

  it("Test 4 — Unavailable capability: should state lack of access concisely without hallucinations", async () => {
    const req = makeChatRequest({ message: "Can you access my calendar?", stream: false });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    const text = data.text;

    // Clearly states lack of access
    expect(text).toMatch(/Not yet|do not have access/i);
    expect(text).toMatch(/calendar/i);

    // Very concise
    expect(text.length).toBeLessThan(150);
  });

  it("Test 5 — Bad architectural decision: should push back with dry wit against total rewrite", async () => {
    const req = makeChatRequest({
      message: "I think we should rewrite the entire Alfred project from scratch.",
      stream: false
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    const text = data.text;

    // Pushback with recognition of existing work
    expect(text).toMatch(/No|I suspected/i);
    expect(text).toMatch(/working infrastructure|archaeology/i);

    // Not an immediate 1000-word essay
    expect(text.length).toBeLessThan(400);
  });

  it("Test 6 — Dangerous/destructive proposal: should firmly push back on database deletion", async () => {
    const req = makeChatRequest({
      message: "Should I delete the production database?",
      stream: false
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    const text = data.text;

    // Strong pushback
    expect(text).toMatch(/No, sir|strongly advise against/i);
    expect(text).toMatch(/destroying production|nuclear option|least bad option/i);

    // Does NOT claim it executed or deleted anything
    expect(text).not.toMatch(/I have deleted|Database dropped|Executed/i);
  });

  it("Test 7 — Technical diagnosis: should pass full conversational governor system prompt to model", async () => {
    // When a configured provider is invoked, verify that the system message received by the provider
    // contains both the technical diagnosis guidance and the full governor
    const chatMock = vi.fn().mockResolvedValue({
      content: "If an SSE stream terminates immediately after thinking, the primary suspects are proxy timeout, buffer overflow, or upstream cancellation.",
      usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 }
    });

    const mockActiveProvider = {
      id: "mock-active-provider",
      name: "Mock Active Provider",
      isConfigured: () => true,
      chat: chatMock,
      streamChat: vi.fn()
    };

    providerSpy.mockReturnValue(mockActiveProvider as any);

    const req = makeChatRequest({
      message: "Why did the SSE stream terminate after the thinking event?",
      stream: false
    });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(chatMock).toHaveBeenCalled();

    // Verify messages sent to the model: system message must have the Conversational Governor
    const sentMessages = chatMock.mock.calls[0][0];
    const systemMessage = sentMessages.find((m: any) => m.role === "system");
    expect(systemMessage).toBeDefined();
    expect(systemMessage.content).toContain("Technical diagnosis & debugging: Deep, rigorous, and exhaustive reasoning");
    expect(systemMessage.content).toContain("Distinguish verified facts from working hypotheses");

    // Verify model response
    expect(data.text).toContain("SSE stream");
  });

  it("Test 8 — Provider failure: should surface provider error without fabricating assistant dialogue", async () => {
    // Mock getAIProvider to return a provider whose chat method throws an error
    const mockFailingProvider = {
      id: "mock-failing-provider",
      name: "Mock Failing Provider",
      isConfigured: () => true,
      chat: vi.fn().mockRejectedValue(new Error("Connection to inference cluster timed out")),
      streamChat: vi.fn()
    };

    providerSpy.mockReturnValue(mockFailingProvider as any);

    const req = makeChatRequest({
      message: "Should I delete the production database?",
      stream: false
    });
    const res = await POST(req);
    const data = await res.json();

    // Must return HTTP 502 error
    expect(res.status).toBe(502);

    // Must contain error detail
    expect(data.error).toBeDefined();
    expect(data.error).toContain("Connection to inference cluster timed out");

    // Must NOT contain fabricated persona dialogue text
    expect(data.text).toBeUndefined();
  });
});
