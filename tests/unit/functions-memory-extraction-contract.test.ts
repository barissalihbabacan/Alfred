import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildMemoryExtractionPrompt,
  buildMemoryExtractionSystemPrompt,
  getMemoryExtractionCandidates,
  parseMemoryExtractionResponse,
  validateMemoryCandidate,
  MEMORY_MIN_CONFIDENCE,
  type ValidatedMemoryCandidate
} from "../../src/ai/prompts/memory-extraction.js";
import { generateDeterministicTitle } from "../../src/data/firestore/conversation-title.js";
import { generateDeterministicTitle as repositoryTitle } from "../../src/data/firestore/conversation-repository.interface.js";
import { DEFAULT_EXTRACTION_MIN_CONFIDENCE } from "../../src/core/config/memory.config.js";

/**
 * Production contract for the memory-extraction prompt, candidate validation
 * and conversation titles, which functions/index.js now imports from src/
 * (bundled via esbuild). The `legacy*` functions below are verbatim copies of
 * the code functions/index.js carried inline before the migration; the
 * differential tests prove the shared modules make the same decision for
 * every input, so the migration is a no-op in production.
 */

// ---------------------------------------------------------------------------
// Verbatim pre-migration production code (functions/index.js)
// ---------------------------------------------------------------------------

function legacySystemPrompt(userName: string): string {
  const systemInstructions = `You are Alfred's autonomous memory extraction subsystem.
Your task is to analyze conversational exchanges and identify durable, long-term information worth remembering across future conversations.

CRITICAL RULES:
1. DURABILITY: Only extract information that will remain useful in future, separate conversations.
   - GOOD: User preferences, stable facts about ${userName}, technical choices, architectural decisions, constraints, workflows, project facts.
   - BAD (NEVER REMEMBER): Greetings ("hello"), chit-chat, transient moods, daily updates, casual questions, temporary debugging logs, conversation closures.
2. NO SELF-MEMORIES: Assistant (Alfred) statements MUST NOT be converted into facts about ${userName}. Only information asserted, confirmed, or instructed by the user counts as a user memory.
3. FACT VS SPECULATION: Never manufacture certainty.
4. USER ATTRIBUTION: Clearly state the subject in third person (use "${userName}" rather than "the user").
5. EXPLICIT INSTRUCTIONS:
   - "Remember that X" -> High-priority candidate (action: "create", confidence >= 0.95).
   - "Don't remember this" or "Do not save this" -> Do NOT extract any memory (shouldRemember: false).
   - "Forget that X" or "I no longer prefer X" -> Create retraction candidate (action: "forget", confidence >= 0.95).
6. TEMPORAL & SUPERSESSION:
   - If user states they switched or migrated, specify action: "supersede" and set targetMemoryHint to describe the older fact being replaced.
7. PRIVACY: NEVER extract passwords, API keys, private keys, bearer tokens, or secrets.
8. RETURN ONLY A STRICT JSON OBJECT:
{
  "shouldRemember": boolean,
  "memories": [
    {
      "content": string,
      "memoryType": "user_preference" | "user_fact" | "project_fact" | "architectural_decision" | "technical_preference" | "constraint" | "relationship" | "workflow" | "general",
      "confidence": number,
      "action": "create" | "forget" | "supersede",
      "targetMemoryHint": string,
      "reasoning": string
    }
  ]
}
If there is nothing worth remembering, return {"shouldRemember": false, "memories": []}.`;
  return systemInstructions;
}

/** Production's gate: `if (!parsed || !parsed.shouldRemember || !Array.isArray(parsed.memories))` */
function legacyGate(parsed: unknown): unknown[] | null {
  const p = parsed as { shouldRemember?: unknown; memories?: unknown } | null;
  if (!p || !p.shouldRemember || !Array.isArray(p.memories)) return null;
  return p.memories;
}

/**
 * What production did with one candidate, up to (not including) the privacy
 * check and the persistence branches, expressed as the branch it took.
 */
type LegacyDecision =
  | { kind: "skip" }
  | { kind: "process"; content: string; branch: "forget" | "create" | "supersede" | "store-no-dedup"; memoryType: unknown };

function legacyDecide(rawCandidate: unknown): LegacyDecision {
  const candidate = rawCandidate as Record<string, unknown>;
  if (!candidate.content || typeof candidate.content !== "string") return { kind: "skip" };
  const content = candidate.content.trim();
  if (content.length < 5) return { kind: "skip" };
  // Production compared the raw JSON value with `<`; the cast keeps that coercion.
  if (((candidate.confidence || 0) as number) < 0.70) return { kind: "skip" };

  const action = candidate.action || "create";
  const branch =
    action === "forget" ? "forget"
      : action === "create" ? "create"
        : action === "supersede" ? "supersede"
          : "store-no-dedup";
  return { kind: "process", content, branch, memoryType: candidate.memoryType || "general" };
}

function legacyGenerateDeterministicTitle(message: string): string {
  const clean = message
    .replace(/^[\s#*>`"']+|[\s*>`"']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) {
    return "New Conversation";
  }

  const words = clean.split(" ").slice(0, 6).join(" ");
  const truncated = words.length > 40 ? words.slice(0, 37) + "..." : words;
  return truncated.charAt(0).toUpperCase() + truncated.slice(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sharedDecide(candidate: unknown): LegacyDecision {
  const v: ValidatedMemoryCandidate | null = validateMemoryCandidate(candidate);
  if (!v) return { kind: "skip" };
  const branch = v.action === "unrecognized" ? "store-no-dedup" : v.action;
  return { kind: "process", content: v.content, branch, memoryType: v.memoryType };
}

type Outcome = { ok: LegacyDecision } | { threw: string };

function outcome(fn: () => LegacyDecision): Outcome {
  try {
    return { ok: fn() };
  } catch (err: unknown) {
    return { threw: err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err) };
  }
}

/** Deterministic PRNG (mulberry32) so the fuzz cases are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONTENT_VALUES: unknown[] = [
  undefined, null, "", " ", "abcd", " abcd ", "abcde", "  abcde  ", "\n\tabcde\n", "Barış prefers pnpm.",
  "x".repeat(1001), "şifre", "şifreler", 0, 1, 12345, true, false, [], ["Barış likes tea"], {}, { text: "hi" }
];
const CONFIDENCE_VALUES: unknown[] = [
  undefined, null, 0, 0.1, 0.69, 0.6999999, 0.7, 0.70000001, 0.75, 0.8, 0.95, 1, 1.5, -1,
  "", "0.9", "0.5", "0.70", "high", "1e0", " 0.8 ", true, false, [], [0.9], [0.1], [0.8, 0.9], {}, { valueOf: 1 }
];
const ACTION_VALUES: unknown[] = [
  undefined, null, "", "create", "forget", "supersede", "CREATE", "Forget", "update", "delete", " create",
  0, 1, true, false, [], ["forget"], {}
];
const MEMORY_TYPE_VALUES: unknown[] = [
  undefined, null, "", "user_preference", "project_fact", "general", "bogus_type", "USER_FACT", 0, 7, true, false, [], ["user_fact"], {}
];

function* candidateMatrix(): Generator<unknown> {
  for (const content of CONTENT_VALUES) {
    for (const confidence of CONFIDENCE_VALUES) {
      for (const action of ACTION_VALUES) {
        // memoryType does not influence decisions, so cycle it rather than
        // multiplying the matrix again.
        const memoryType = MEMORY_TYPE_VALUES[(CONTENT_VALUES.indexOf(content) + ACTION_VALUES.indexOf(action)) % MEMORY_TYPE_VALUES.length];
        const c: Record<string, unknown> = {};
        if (content !== undefined) c.content = content;
        if (confidence !== undefined) c.confidence = confidence;
        if (action !== undefined) c.action = action;
        if (memoryType !== undefined) c.memoryType = memoryType;
        yield c;
      }
    }
  }
}

const NON_OBJECT_CANDIDATES: unknown[] = [
  null, undefined, 0, 1, "", "Barış prefers pnpm.", true, false, [], [1, 2], ["content"]
];

function pick<T>(r: () => number, xs: T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}

// ---------------------------------------------------------------------------

describe("memory extraction system prompt (production contract)", () => {
  it("is byte-identical to the prompt production carried inline", () => {
    for (const name of ["Barış", "Bruce Wayne", "", "O'Brien \"Jr\"", "${userName}", "çğıöşü İ"]) {
      expect(buildMemoryExtractionSystemPrompt(name)).toBe(legacySystemPrompt(name));
    }
  });

  it("buildMemoryExtractionPrompt sends it as the system message, defaulting the name to Barış", () => {
    const [sys] = buildMemoryExtractionPrompt({ currentMessage: "hi", userId: "u" });
    expect(sys!.content).toBe(legacySystemPrompt("Barış"));
    const [sysNamed] = buildMemoryExtractionPrompt({ currentMessage: "hi", userId: "u", userName: "Bruce" });
    expect(sysNamed!.content).toBe(legacySystemPrompt("Bruce"));
  });
});

describe("getMemoryExtractionCandidates (production gate)", () => {
  const payloads: unknown[] = [
    null, undefined, 0, 1, "", "x", true, false, [], [1], {},
    { shouldRemember: true }, { shouldRemember: true, memories: [] }, { shouldRemember: true, memories: [{ content: "abcde" }] },
    { shouldRemember: false, memories: [{ content: "abcde" }] }, { shouldRemember: 0, memories: [] },
    { shouldRemember: "yes", memories: [] }, { shouldRemember: "", memories: [] }, { shouldRemember: 1, memories: [null] },
    { shouldRemember: true, memories: {} }, { shouldRemember: true, memories: "abc" }, { shouldRemember: true, memories: null },
    { shouldRemember: [], memories: [] }, { shouldRemember: {}, memories: [] }, { memories: [] }
  ];

  it("agrees with production on every payload shape", () => {
    for (const p of payloads) {
      expect(getMemoryExtractionCandidates(p), JSON.stringify(p) ?? String(p)).toEqual(legacyGate(p));
    }
  });

  it("returns production's own array (same identity), so iteration is unchanged", () => {
    const memories = [{ content: "abcde" }];
    expect(getMemoryExtractionCandidates({ shouldRemember: true, memories })).toBe(memories);
  });
});

describe("validateMemoryCandidate (differential against production's inline loop)", () => {
  it("makes the same decision for every combination in the value matrix", () => {
    let n = 0;
    let processed = 0;
    for (const c of candidateMatrix()) {
      const expected = outcome(() => legacyDecide(c));
      const actual = outcome(() => sharedDecide(c));
      expect(actual, JSON.stringify(c)).toEqual(expected);
      n++;
      if ("ok" in expected && expected.ok.kind === "process") processed++;
    }
    expect(n).toBe(CONTENT_VALUES.length * CONFIDENCE_VALUES.length * ACTION_VALUES.length);
    // Sanity: the matrix exercises both outcomes heavily.
    expect(processed).toBeGreaterThan(500);
    expect(n - processed).toBeGreaterThan(500);
  });

  it("makes the same decision (including throwing) for non-object candidates", () => {
    for (const c of NON_OBJECT_CANDIDATES) {
      expect(outcome(() => sharedDecide(c)), String(c)).toEqual(outcome(() => legacyDecide(c)));
    }
    // Production throws on a null/undefined entry (reading .content).
    expect(() => validateMemoryCandidate(null)).toThrow(TypeError);
    expect(() => validateMemoryCandidate(undefined)).toThrow(TypeError);
  });

  it("makes the same decision for 5000 random candidates parsed from JSON", () => {
    const r = rng(20260923);
    const jsonable = (xs: unknown[]) => xs.filter((x) => x !== undefined);
    for (let i = 0; i < 5000; i++) {
      const obj: Record<string, unknown> = {};
      if (r() < 0.9) obj.content = pick(r, jsonable(CONTENT_VALUES));
      if (r() < 0.8) obj.confidence = r() < 0.5 ? Math.round(r() * 1000) / 1000 : pick(r, jsonable(CONFIDENCE_VALUES));
      if (r() < 0.7) obj.action = pick(r, jsonable(ACTION_VALUES));
      if (r() < 0.7) obj.memoryType = pick(r, jsonable(MEMORY_TYPE_VALUES));
      if (r() < 0.3) obj.targetMemoryHint = "old fact";
      // Round-trip through JSON, as production only ever sees JSON.parse output.
      const c: unknown = JSON.parse(JSON.stringify(obj));
      expect(outcome(() => sharedDecide(c)), JSON.stringify(c)).toEqual(outcome(() => legacyDecide(c)));
    }
  });

  it("pins the production thresholds and coercions", () => {
    expect(MEMORY_MIN_CONFIDENCE).toBe(0.7);
    expect(validateMemoryCandidate({ content: "abcde", confidence: 0.7 })).not.toBeNull();
    expect(validateMemoryCandidate({ content: "abcde", confidence: 0.69 })).toBeNull();
    expect(validateMemoryCandidate({ content: "abcde" })).toBeNull(); // missing confidence -> 0
    expect(validateMemoryCandidate({ content: "abcd", confidence: 1 })).toBeNull(); // < 5 chars
    expect(validateMemoryCandidate({ content: "  abcd  ", confidence: 1 })).toBeNull(); // trimmed first
    expect(validateMemoryCandidate({ content: "x".repeat(5000), confidence: 1 })).not.toBeNull(); // no max length
    expect(validateMemoryCandidate({ content: "abcde", confidence: "0.9" })?.confidence).toBe(0.9);
    expect(validateMemoryCandidate({ content: "abcde", confidence: "high" })?.confidence).toBeNaN();
    expect(validateMemoryCandidate({ content: "abcde", confidence: [] })).toBeNull();
    expect(validateMemoryCandidate({ content: "abcde", confidence: 1, action: "update" })?.action).toBe("unrecognized");
    expect(validateMemoryCandidate({ content: "abcde", confidence: 1, action: "" })?.action).toBe("create");
    expect(validateMemoryCandidate({ content: "abcde", confidence: 1, memoryType: 7 })?.memoryType).toBe(7);
    expect(validateMemoryCandidate({ content: "abcde", confidence: 1, memoryType: "" })?.memoryType).toBe("general");
  });
});

describe("parseMemoryExtractionResponse (src, now on production rules)", () => {
  const parse = (memories: unknown[]) =>
    parseMemoryExtractionResponse(JSON.stringify({ shouldRemember: true, memories }));

  it("defaults to production's 0.70 threshold, and so does the src config", () => {
    expect(DEFAULT_EXTRACTION_MIN_CONFIDENCE).toBe(0.7);
    expect(parse([{ content: "Barış uses pnpm.", confidence: 0.7 }]).candidates).toHaveLength(1);
    expect(parse([{ content: "Barış uses pnpm.", confidence: 0.69 }]).candidates).toHaveLength(0);
  });

  it("rejects a candidate without confidence (was: defaulted to 0.8)", () => {
    expect(parse([{ content: "Barış uses pnpm." }]).candidates).toHaveLength(0);
  });

  it("accepts content over 1000 characters (was: rejected)", () => {
    const long = "Barış ".repeat(300).trim();
    expect(parse([{ content: long, confidence: 0.9 }]).candidates[0]!.content).toBe(long);
  });

  it("accepts a numeric-string confidence and keeps it unrounded (was: 0.8 default / rounded)", () => {
    const [c] = parse([{ content: "Barış uses pnpm.", confidence: "0.9" }]).candidates;
    expect(c!.confidence).toBe(0.9);
    expect(parse([{ content: "Barış uses pnpm.", confidence: 0.87654 }]).candidates[0]!.confidence).toBe(0.87654);
  });

  it("narrows what src types cannot hold: unknown memoryType -> general, unrecognized action -> create", () => {
    const [c] = parse([{ content: "Barış uses pnpm.", confidence: 0.9, memoryType: "bogus", action: "update" }]).candidates;
    expect(c!.memoryType).toBe("general");
    expect(c!.action).toBe("create");
  });

  it("keeps the candidates before a null entry and drops the rest, as production persists them", () => {
    const res = parse([
      { content: "First durable fact.", confidence: 0.9 },
      null,
      { content: "Never reached in production.", confidence: 0.9 }
    ]);
    expect(res.candidates.map((c) => c.content)).toEqual(["First durable fact."]);
  });

  it("accepts exactly the candidates production would process, in order", () => {
    const r = rng(7);
    for (let round = 0; round < 200; round++) {
      const memories: unknown[] = [];
      const len = Math.floor(r() * 6);
      for (let i = 0; i < len; i++) {
        memories.push({
          content: pick(r, CONTENT_VALUES.filter((x) => x !== undefined)),
          confidence: r() < 0.5 ? Math.round(r() * 100) / 100 : pick(r, CONFIDENCE_VALUES.filter((x) => x !== undefined)),
          action: pick(r, ["create", "forget", "supersede", ""])
        });
      }
      const json: unknown[] = JSON.parse(JSON.stringify(memories));
      const expected = json
        .map((c) => legacyDecide(c))
        .flatMap((d) => (d.kind === "process" ? [d.content] : []));
      expect(parse(json).candidates.map((c) => c.content)).toEqual(expected);
    }
  });
});

describe("generateDeterministicTitle (production contract)", () => {
  const samples = [
    "", " ", "\n\t", "#", "### ", "> quoted", "**bold** text", "`code`", "\"quoted\"", "'single'",
    "hello", "hello world", "  leading and trailing  ", "one two three four five six seven eight",
    "Supercalifragilisticexpialidocious antidisestablishmentarianism words",
    "a".repeat(39), "a".repeat(40), "a".repeat(41), "a ".repeat(30),
    "ışık yakında gelecek mi acaba bilmiyorum", "istanbul'da hava nasıl?", "çok güzel", "Ülke", "ǆemal",
    "# Heading with *stars*", "trailing stars***", "** ** **", ">>> nested", "multi\n\nline\nmessage here",
    "emoji 🎉 party time now friends everyone", "123 numbers first", "what time is it in London?",
    "x y non-breaking", "tabs\tbetween\twords\there", "'''", "`#`"
  ];

  it("is the function the conversation repositories use", () => {
    expect(repositoryTitle).toBe(generateDeterministicTitle);
  });

  it("pins known outputs", () => {
    expect(generateDeterministicTitle("")).toBe("New Conversation");
    expect(generateDeterministicTitle("### **")).toBe("New Conversation");
    expect(generateDeterministicTitle("hello world")).toBe("Hello world");
    expect(generateDeterministicTitle("one two three four five six seven")).toBe("One two three four five six");
    expect(generateDeterministicTitle("a".repeat(41))).toBe("a".repeat(37).replace(/^a/, "A") + "...");
    expect(generateDeterministicTitle("ışık yakında")).toBe("Işık yakında");
  });

  it("matches production's copy on fixed and random inputs", () => {
    for (const s of samples) expect(generateDeterministicTitle(s), JSON.stringify(s)).toBe(legacyGenerateDeterministicTitle(s));
    const r = rng(42);
    const alphabet = ["a", "B", "ç", "İ", "ı", " ", "  ", "\n", "\t", "#", "*", ">", "`", "\"", "'", "-", ".", "?", "🎉", "word", "longerword"];
    for (let i = 0; i < 3000; i++) {
      let s = "";
      const len = Math.floor(r() * 40);
      for (let j = 0; j < len; j++) s += pick(r, alphabet);
      expect(generateDeterministicTitle(s), JSON.stringify(s)).toBe(legacyGenerateDeterministicTitle(s));
    }
  });
});

describe("functions/index.js uses the shared modules", () => {
  const source = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");

  it("imports them instead of carrying copies", () => {
    expect(source).toContain('from "../src/data/firestore/conversation-title.js"');
    expect(source).toMatch(/buildMemoryExtractionSystemPrompt,[\s\S]*validateMemoryCandidate[\s\S]*from "\.\.\/src\/ai\/prompts\/memory-extraction\.js"/);
    expect(source).not.toMatch(/function\s+generateDeterministicTitle\s*\(/);
    expect(source).not.toContain("You are Alfred's autonomous memory extraction subsystem.");
    expect(source).not.toMatch(/confidence \|\| 0\) < 0\.70/);
  });

  it("still runs the shared PrivacyFilter on the validated content before acting on it", () => {
    const validateAt = source.indexOf("validateMemoryCandidate(candidate)");
    const privacyAt = source.indexOf("PrivacyFilter.check(content)");
    const actionAt = source.indexOf("const action = validated.action;");
    expect(validateAt).toBeGreaterThan(-1);
    expect(privacyAt).toBeGreaterThan(validateAt);
    expect(actionAt).toBeGreaterThan(privacyAt);
  });
});
