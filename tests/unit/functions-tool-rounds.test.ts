import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveTimezone } from "../../src/ai/tools/time/timezone-resolver.js";
import {
  MAX_CITIES_PER_CALL,
  getCurrentTimeForCity,
  runGetCurrentTimeTool
} from "../../src/ai/tools/time/current-time.js";

// 24 Sep 2026: "Saat kaç? İstanbul ve New York'ta" came back empty. The model
// asked for one city per round; the second round had no tools, the model
// called the tool anyway, and Groq returned tool_use_failed inside the 200
// stream, which the parser ignored. These tests pin the fix.

const NOW = new Date("2026-09-24T11:43:00Z");

describe("runGetCurrentTimeTool", () => {
  it("answers every city of one call, in order", () => {
    const out = runGetCurrentTimeTool({ cities: ["İstanbul", "New York"] }, NOW);
    expect("results" in out).toBe(true);
    if (!("results" in out)) return;
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toEqual(getCurrentTimeForCity("İstanbul", NOW));
    expect(out.results[1]).toEqual(getCurrentTimeForCity("New York", NOW));
    expect(out.note).toBeUndefined();
  });

  it("keeps an unknown city as an error entry without failing the others", () => {
    const out = runGetCurrentTimeTool({ cities: ["London", "Atlantis"] }, NOW);
    if (!("results" in out)) throw new Error("expected results");
    expect(out.results[0]).toEqual(getCurrentTimeForCity("London", NOW));
    expect(out.results[1]).toEqual({ city: "Atlantis", error: "Unable to identify a valid timezone for city 'Atlantis'." });
  });

  it(`looks up at most ${MAX_CITIES_PER_CALL} cities and says so`, () => {
    const many = ["London", "Paris", "Tokyo", "Istanbul", "Berlin", "Madrid", "Rome", "Oslo"];
    const out = runGetCurrentTimeTool({ cities: many }, NOW);
    if (!("results" in out)) throw new Error("expected results");
    expect(out.results).toHaveLength(MAX_CITIES_PER_CALL);
    expect(out.note).toMatch(/first 6 cities/);
  });

  it("returns exactly the old result for the legacy { city } form", () => {
    expect(runGetCurrentTimeTool({ city: "Tokyo" }, NOW)).toEqual(getCurrentTimeForCity("Tokyo", NOW));
    expect(runGetCurrentTimeTool({ city: "Nowhere" }, NOW)).toEqual(getCurrentTimeForCity("Nowhere", NOW));
    expect(runGetCurrentTimeTool(undefined, NOW)).toEqual(getCurrentTimeForCity(undefined, NOW));
  });

  it("falls back to city when cities is empty or not an array", () => {
    expect(runGetCurrentTimeTool({ cities: [], city: "Tokyo" }, NOW)).toEqual(getCurrentTimeForCity("Tokyo", NOW));
    expect(runGetCurrentTimeTool({ cities: "Tokyo" }, NOW)).toEqual(getCurrentTimeForCity(undefined, NOW));
  });
});

// The Groq tool loop moved to src/ai/providers/chat-fallback/chat-turn.ts
// (shared by every fallback provider; behaviour tested end to end in
// tests/unit/chat-fallback-turn.test.ts). These pins follow it there.
describe("production tool rounds", () => {
  const source = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");
  const turn = readFileSync(new URL("../../src/ai/providers/chat-fallback/chat-turn.ts", import.meta.url), "utf8");
  const stream = readFileSync(new URL("../../src/ai/providers/chat-fallback/openai-stream.ts", import.meta.url), "utf8");

  it("keeps tools available on every round except the last", () => {
    expect(turn).toContain("const tools = deps.tools.length > 0 && toolTurn < deps.maxTurns ? deps.tools : undefined;");
    expect(source).toContain("const MAX_TURNS = 3;");
    expect(source).toContain("if (activeTools && activeTools.length > 0 && toolTurn < MAX_TURNS) {\n            requestBody.tools = activeTools;");
    expect(source).not.toContain("activeTools = undefined;");
  });

  it("dispatches get_current_time through the shared multi-city runner", () => {
    expect(source).toContain("return runGetCurrentTimeTool(fnArgs);");
    expect(source).toContain("runTool,");
  });

  it("treats an error object inside the stream as a failed turn", () => {
    expect(stream).toMatch(/if \(chunk\.error\) \{\n\s*error = /);
    const block = turn.slice(turn.indexOf("if (result.error) {"), turn.indexOf("throw streamErr;") + 16);
    expect(block.length).toBeGreaterThan(0);
    expect(block.length).toBeLessThan(1200);
    expect(block).toContain('"llm_stream_error"');
    expect(block).toContain('code: "stream_error"');
  });

  it("never reports an empty answer as success", () => {
    expect(source).toMatch(/if \(!cleanContent\) \{[\s\S]{0,300}emptyErr\.code = "empty_response";\n\s*throw emptyErr;\n\s*\}\n\s*logLlmRequest\("ok"\);\n\s*sendEvent\(\{ type: "done" \}\);/);
  });
});

describe("Turkish city names the model used on 24 Sep", () => {
  it.each([
    ["Sidney", "Australia/Sydney"],
    ["Sidney'de", "Australia/Sydney"],
    ["Budapeşte", "Europe/Budapest"],
    ["Bükreş", "Europe/Bucharest"],
    ["Sofya", "Europe/Sofia"],
    ["Belgrad", "Europe/Belgrade"],
    ["Riyad", "Asia/Riyadh"],
    ["Seul", "Asia/Seoul"],
    ["Singapur", "Asia/Singapore"],
    ["Meksiko", "America/Mexico_City"]
  ])("%s -> %s", (city, zone) => {
    expect(resolveTimezone(city)?.timezone).toBe(zone);
  });
});
