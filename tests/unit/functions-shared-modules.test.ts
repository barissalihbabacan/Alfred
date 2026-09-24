import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { cosineSimilarity } from "../../src/data/vector/cosine-similarity.js";
import {
  buildMemoryExtractionUserPrompt,
  extractJsonPayload
} from "../../src/ai/prompts/memory-extraction.js";

/**
 * These src/ modules are bundled into the production Cloud Functions
 * (functions/index.js -> functions/lib/index.js via functions/build.js).
 * The expectations below pin the behaviour production had while these were
 * still hand-copied in functions/index.js, so a change here is a deliberate
 * production change, not a side effect of a library refactor.
 */
describe("src/ modules shared with functions/", () => {
  describe("cosineSimilarity (production contract)", () => {
    it("returns 0 for vectors of different lengths instead of comparing a prefix", () => {
      expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
      expect(cosineSimilarity([1, 0], [1, 0, 5])).toBe(0);
    });

    it("returns 0 for missing, non-array or empty inputs", () => {
      expect(cosineSimilarity(undefined as unknown as number[], [1])).toBe(0);
      expect(cosineSimilarity([1], null as unknown as number[])).toBe(0);
      expect(cosineSimilarity({ length: 1, 0: 1 } as unknown as number[], [1])).toBe(0);
      expect(cosineSimilarity([], [])).toBe(0);
    });

    it("returns 0 when either vector has zero magnitude", () => {
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
      expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
    });

    it("never leaves [-1, 1] for (near-)parallel vectors", () => {
      const v = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
      expect(cosineSimilarity(v, v)).toBeLessThanOrEqual(1);
      expect(cosineSimilarity(v, v.map((x) => -x))).toBeGreaterThanOrEqual(-1);
      expect(cosineSimilarity([3, 4], [6, 8])).toBeCloseTo(1, 12);
    });
  });

  describe("buildMemoryExtractionUserPrompt", () => {
    it("emits exactly the text production sends to the extraction model", () => {
      const prompt = buildMemoryExtractionUserPrompt({
        currentMessage: "Remember that I use pnpm.",
        assistantResponse: "Noted, sir.",
        recentMessages: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "Good evening, sir." }
        ]
      });
      expect(prompt).toBe(
        [
          "=== RECENT CONVERSATION CONTEXT ===",
          "USER: hi",
          "ASSISTANT: Good evening, sir.",
          "=== CURRENT EXCHANGE ===",
          "USER: Remember that I use pnpm.",
          "ASSISTANT: Noted, sir."
        ].join("\n") + "\n\nAnalyze the above exchange. Output JSON only."
      );
    });

    it("omits the context header when there is no history and the assistant line when there is no response", () => {
      expect(buildMemoryExtractionUserPrompt({ currentMessage: "x", recentMessages: [] })).toBe(
        "=== CURRENT EXCHANGE ===\nUSER: x\n\nAnalyze the above exchange. Output JSON only."
      );
      expect(buildMemoryExtractionUserPrompt({ currentMessage: "x", assistantResponse: "" })).toBe(
        "=== CURRENT EXCHANGE ===\nUSER: x\n\nAnalyze the above exchange. Output JSON only."
      );
    });
  });

  describe("extractJsonPayload", () => {
    it("strips closed and unterminated <think> blocks", () => {
      expect(extractJsonPayload('<think>hmm {"no":1}</think> {"a":1}')).toBe('{"a":1}');
      expect(extractJsonPayload('{"a":1}<THINK>trailing {"b":2}')).toBe('{"a":1}');
    });

    it("prefers a fenced block over brace scanning", () => {
      expect(extractJsonPayload('noise {x} ```json\n{"a":1}\n``` more }')).toBe('{"a":1}');
      expect(extractJsonPayload('```\n{"a":2}\n```')).toBe('{"a":2}');
    });

    it("falls back to the first-{ .. last-} span", () => {
      expect(extractJsonPayload('Here you go: {"a":{"b":1}} thanks')).toBe('{"a":{"b":1}}');
    });

    it("returns the trimmed text unchanged when no JSON shape is found", () => {
      expect(extractJsonPayload("  nothing here  ")).toBe("nothing here");
      expect(extractJsonPayload("} backwards {")).toBe("} backwards {");
    });
  });

  it("functions/index.js imports these from src/ instead of carrying copies", () => {
    const index = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");
    const extraction = readFileSync(new URL("../../functions/memory-extraction.js", import.meta.url), "utf8");
    const source = `${index}\n${extraction}`;
    expect(index).toContain('from "../src/data/vector/cosine-similarity.js"');
    // The prompt builders reach production through the shared extraction pipeline.
    expect(extraction).toContain('from "../src/alfred/cognitive/memory/extractor/extraction-pipeline.js"');
    expect(source).not.toMatch(/function\s+cosineSimilarity\s*\(/);
    expect(source).not.toContain("=== RECENT CONVERSATION CONTEXT ===");
  });
});
