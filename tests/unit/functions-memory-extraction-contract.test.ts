import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildMemoryExtractionPrompt,
  buildMemoryExtractionSystemPrompt,
  getMemoryExtractionCandidates,
  parseMemoryExtractionResponse,
  validateMemoryCandidate,
  normalizeMemoryAction,
  normalizeMemoryType,
  parseMemoryConfidence,
  MEMORY_EXTRACTION_ACTIONS,
  MEMORY_EXTRACTION_TYPES,
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
 * the code functions/index.js carried inline before the migration.
 *
 * The candidate validation has since been fixed on purpose (null entries no
 * longer abort the turn; unknown actions are "create"; memoryType and
 * confidence are validated), and the prompt no longer asks for the unused
 * targetMemoryHint. The differential tests therefore prove two things: on
 * every input where the legacy loop was right (`legacyWasCorrect`) the shared
 * validator makes the identical decision, and on every input it matches the
 * fixed rules (`fixedDecide`: clean the three fields, then run the legacy loop).
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

const PROMPT_ACTIONS = ["create", "forget", "supersede"];
const PROMPT_TYPES = [
  "user_preference", "user_fact", "project_fact", "architectural_decision", "technical_preference",
  "constraint", "relationship", "workflow", "general"
];

/**
 * The inputs on which the legacy loop was already right, i.e. everything the
 * validation fixes leave alone: a plain object whose action is missing/falsy
 * or exactly one of the prompt's actions, whose memoryType is missing/falsy
 * or exactly one of the prompt's types, and whose confidence is missing/falsy
 * or a number / plain decimal string in [0, 1].
 */
function legacyWasCorrect(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  const c = candidate as Record<string, unknown>;
  const actionOk = !c.action || (typeof c.action === "string" && PROMPT_ACTIONS.includes(c.action));
  const typeOk = !c.memoryType || (typeof c.memoryType === "string" && PROMPT_TYPES.includes(c.memoryType));
  const conf = c.confidence;
  const confOk =
    conf === undefined || conf === null || conf === false || conf === "" ||
    (typeof conf === "number" && conf >= 0 && conf <= 1) ||
    (typeof conf === "string" && /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(conf.trim()) && Number(conf) >= 0 && Number(conf) <= 1);
  return actionOk && typeOk && confOk;
}

/**
 * The fixed rules, written as "clean the three fields, then run the legacy
 * loop": a non-object is skipped; action and memoryType are matched
 * case-insensitively after trimming (unknown -> dropped, so the legacy
 * defaults "create" / "general" apply); confidence must be a finite number
 * or decimal string in [0, 1] (anything else -> dropped, so the legacy
 * "missing confidence" rejection applies).
 */
function fixedDecide(candidate: unknown): LegacyDecision {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { kind: "skip" };
  const c = candidate as Record<string, unknown>;
  const cleaned: Record<string, unknown> = { content: c.content };
  const norm = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : undefined);
  const action = norm(c.action);
  if (action && PROMPT_ACTIONS.includes(action)) cleaned.action = action;
  const memoryType = norm(c.memoryType);
  if (memoryType && PROMPT_TYPES.includes(memoryType)) cleaned.memoryType = memoryType;
  const conf = c.confidence;
  const confNum =
    typeof conf === "number" ? conf
      : typeof conf === "string" && /^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(conf.trim()) ? Number(conf.trim())
        : NaN;
  if (Number.isFinite(confNum) && confNum >= 0 && confNum <= 1) cleaned.confidence = confNum;
  return legacyDecide(cleaned);
}

function sharedDecide(candidate: unknown): LegacyDecision {
  const v: ValidatedMemoryCandidate | null = validateMemoryCandidate(candidate);
  if (!v) return { kind: "skip" };
  return { kind: "process", content: v.content, branch: v.action, memoryType: v.memoryType };
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
  undefined, null, 0, 0.1, 0.69, 0.6999999, 0.7, 0.70000001, 0.75, 0.8, 0.95, 1, 1.5, -1, -0.1,
  NaN, Infinity, -Infinity, "", " ", "0.9", "0.5", "0.70", "high", "1e0", " 0.8 ", "0x1", "1.5", "NaN", "Infinity",
  true, false, [], [0.9], [0.1], [0.8, 0.9], {}, { valueOf: 1 }
];
const ACTION_VALUES: unknown[] = [
  undefined, null, "", "create", "forget", "supersede", "CREATE", "Forget", " supersede ", "update", "UPDATE ",
  "merge", "delete", " create", 0, 1, true, false, [], ["forget"], {}
];
const MEMORY_TYPE_VALUES: unknown[] = [
  undefined, null, "", "user_preference", "project_fact", "general", "workflow", "bogus_type", "USER_FACT",
  " constraint ", "preference", 0, 7, true, false, [], ["user_fact"], {}
];

function* candidateMatrix(): Generator<unknown> {
  for (const content of CONTENT_VALUES) {
    for (const confidence of CONFIDENCE_VALUES) {
      for (const action of ACTION_VALUES) {
        // memoryType never decides skip-or-process, so cycle it rather than
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
  null, undefined, 0, 1, "", "Barış prefers pnpm.", true, false, [], [1, 2], ["content"],
  [{ content: "Barış prefers pnpm.", confidence: 0.9 }]
];

function pick<T>(r: () => number, xs: T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}

const label = (c: unknown) => {
  try {
    return JSON.stringify(c) ?? String(c);
  } catch {
    return String(c);
  }
};

// ---------------------------------------------------------------------------

describe("memory extraction system prompt (production contract)", () => {
  it("is the prompt production carried inline, minus the unused targetMemoryHint", () => {
    const withoutHint = (p: string) =>
      p
        .replace(
          'specify action: "supersede" and set targetMemoryHint to describe the older fact being replaced.',
          'specify action: "supersede" and state the new fact in content; it replaces the closest older memory on the same subject.'
        )
        .replace('      "targetMemoryHint": string,\n', "");
    for (const name of ["Barış", "Bruce Wayne", "", "O'Brien \"Jr\"", "${userName}", "çğıöşü İ"]) {
      expect(buildMemoryExtractionSystemPrompt(name)).toBe(withoutHint(legacySystemPrompt(name)));
    }
    expect(buildMemoryExtractionSystemPrompt("Barış")).not.toContain("targetMemoryHint");
  });

  it("asks for exactly the actions and memory types the validator accepts", () => {
    const prompt = buildMemoryExtractionSystemPrompt("Barış");
    const union = (field: string) =>
      [...prompt.match(new RegExp(`"${field}": ((?:"[a-z_]+"(?: \\| )?)+)`))![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(union("action")).toEqual([...MEMORY_EXTRACTION_ACTIONS]);
    expect(union("memoryType")).toEqual([...MEMORY_EXTRACTION_TYPES]);
    expect([...MEMORY_EXTRACTION_ACTIONS].sort()).toEqual([...PROMPT_ACTIONS].sort());
    expect([...MEMORY_EXTRACTION_TYPES].sort()).toEqual([...PROMPT_TYPES].sort());
  });

  it("buildMemoryExtractionPrompt sends it as the system message, defaulting the name to the profile owner", () => {
    const [sys] = buildMemoryExtractionPrompt({ currentMessage: "hi", userId: "u" });
    // users/USER_PROFILE.md is the committed example ("Alex").
    expect(sys!.content).toBe(buildMemoryExtractionSystemPrompt("Alex"));
    const [sysNamed] = buildMemoryExtractionPrompt({ currentMessage: "hi", userId: "u", userName: "Bruce" });
    expect(sysNamed!.content).toBe(buildMemoryExtractionSystemPrompt("Bruce"));
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
      expect(getMemoryExtractionCandidates(p), label(p)).toEqual(legacyGate(p));
    }
  });

  it("returns production's own array (same identity), so iteration is unchanged", () => {
    const memories = [{ content: "abcde" }];
    expect(getMemoryExtractionCandidates({ shouldRemember: true, memories })).toBe(memories);
  });
});

describe("validateMemoryCandidate (differential against production's former inline loop)", () => {
  it("matches the legacy loop wherever it was right, and the fixed rules everywhere", () => {
    let n = 0;
    let unchanged = 0;
    let processed = 0;
    for (const c of candidateMatrix()) {
      const actual = outcome(() => sharedDecide(c));
      expect(actual, label(c)).toEqual({ ok: fixedDecide(c) });
      if (legacyWasCorrect(c)) {
        expect(actual, label(c)).toEqual(outcome(() => legacyDecide(c)));
        unchanged++;
      }
      if ("ok" in actual && actual.ok.kind === "process") processed++;
      n++;
    }
    expect(n).toBe(CONTENT_VALUES.length * CONFIDENCE_VALUES.length * ACTION_VALUES.length);
    // Sanity: the matrix exercises both outcomes and both classes heavily.
    expect(processed).toBeGreaterThan(500);
    expect(n - processed).toBeGreaterThan(500);
    expect(unchanged).toBeGreaterThan(1000);
    expect(n - unchanged).toBeGreaterThan(1000);
  });

  it("skips non-object candidates instead of throwing", () => {
    for (const c of NON_OBJECT_CANDIDATES) {
      expect(() => validateMemoryCandidate(c), label(c)).not.toThrow();
      expect(validateMemoryCandidate(c), label(c)).toBeNull();
    }
    // The legacy loop threw on these, aborting the rest of the turn.
    expect(() => legacyDecide(null)).toThrow(TypeError);
    expect(() => legacyDecide(undefined)).toThrow(TypeError);
  });

  it("matches on 5000 random candidates parsed from JSON", () => {
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
      const actual = outcome(() => sharedDecide(c));
      expect(actual, label(c)).toEqual({ ok: fixedDecide(c) });
      if (legacyWasCorrect(c)) expect(actual, label(c)).toEqual(outcome(() => legacyDecide(c)));
    }
  });

  it("pins the unchanged thresholds", () => {
    expect(MEMORY_MIN_CONFIDENCE).toBe(0.7);
    expect(validateMemoryCandidate({ content: "abcde", confidence: 0.7 })).not.toBeNull();
    expect(validateMemoryCandidate({ content: "abcde", confidence: 0.69 })).toBeNull();
    expect(validateMemoryCandidate({ content: "abcd", confidence: 1 })).toBeNull(); // < 5 chars
    expect(validateMemoryCandidate({ content: "  abcd  ", confidence: 1 })).toBeNull(); // trimmed first
    expect(validateMemoryCandidate({ content: "x".repeat(5000), confidence: 1 })).not.toBeNull(); // no max length
    expect(validateMemoryCandidate({ content: "abcde", confidence: 1, action: "" })?.action).toBe("create");
    expect(validateMemoryCandidate({ content: "abcde", confidence: 1, memoryType: "" })?.memoryType).toBe("general");
  });

  describe("fix 2: only the prompt's actions, case-insensitive; anything else is create", () => {
    const action = (a: unknown) => validateMemoryCandidate({ content: "abcde", confidence: 1, action: a })?.action;

    it.each([
      ["create", "create"], ["forget", "forget"], ["supersede", "supersede"],
      ["CREATE", "create"], ["Forget", "forget"], [" SuperSede\n", "supersede"], [" create", "create"]
    ])("%j -> %s", (input, expected) => {
      expect(action(input)).toBe(expected);
    });

    it.each([["update"], ["UPDATE "], ["merge"], ["delete"], ["retract"], [""], [true], [1], [["forget"]], [{}], [null]])(
      "%j -> create (was: stored without the duplicate check when truthy)",
      (input) => {
        expect(action(input)).toBe("create");
      }
    );

    it("exports the allowed actions", () => {
      expect(normalizeMemoryAction("  FORGET ")).toBe("forget");
      expect(normalizeMemoryAction("update")).toBe("create");
    });
  });

  describe("fix 3: memoryType restricted to the prompt's types; unknown is general", () => {
    const memoryType = (t: unknown) => validateMemoryCandidate({ content: "abcde", confidence: 1, memoryType: t })?.memoryType;

    it.each(PROMPT_TYPES.map((t) => [t]))("%s is kept", (t) => {
      expect(memoryType(t)).toBe(t);
    });

    it.each([["USER_FACT", "user_fact"], [" constraint ", "constraint"]])("%j -> %s", (input, expected) => {
      expect(memoryType(input)).toBe(expected);
    });

    it.each([["bogus_type"], ["preference"], ["memory"], [7], [true], [["user_fact"]], [{}], [null], [undefined]])(
      "%j -> general (was: written to Firestore as-is when truthy)",
      (input) => {
        expect(memoryType(input)).toBe("general");
        expect(normalizeMemoryType(input)).toBe("general");
      }
    );
  });

  describe("fix 4: confidence must be a finite number in [0, 1] (numeric strings allowed)", () => {
    const conf = (c: unknown) => {
      const obj: Record<string, unknown> = { content: "abcde" };
      if (c !== undefined) obj.confidence = c;
      return validateMemoryCandidate(obj);
    };

    it.each([
      [0.7, 0.7], [0.9, 0.9], [1, 1], ["0.9", 0.9], [" 0.8 ", 0.8], ["1", 1], ["1e0", 1], [".75", 0.75]
    ])("%j is accepted as %d", (input, expected) => {
      expect(conf(input)?.confidence).toBe(expected);
      expect(parseMemoryConfidence(input)).toBe(expected);
    });

    it.each([
      ["high"], [NaN], [Infinity], [-Infinity], [1.5], ["1.5"], [-0.1], ["-0.1"], [undefined], [null], [""], [" "],
      ["0x1"], ["NaN"], ["Infinity"], [true], [[0.9]], [{}], [{ valueOf: 1 }]
    ])("%j is rejected", (input) => {
      expect(conf(input)).toBeNull();
    });

    it("rejects the values the legacy loop wrongly accepted", () => {
      for (const bad of ["high", Infinity, 1.5, "1.5", true, [0.9], {}]) {
        const legacy = legacyDecide({ content: "abcde", confidence: bad });
        expect(legacy.kind, label(bad)).toBe("process");
        expect(conf(bad), label(bad)).toBeNull();
      }
    });

    it("still rejects in-range values below 0.70, and a missing confidence", () => {
      expect(conf(0.69)).toBeNull();
      expect(conf("0.5")).toBeNull();
      expect(conf(0)).toBeNull();
      expect(conf(undefined)).toBeNull();
      expect(parseMemoryConfidence(0.5)).toBe(0.5);
    });
  });
});

describe("parseMemoryExtractionResponse (src, on production rules)", () => {
  const parse = (memories: unknown[]) =>
    parseMemoryExtractionResponse(JSON.stringify({ shouldRemember: true, memories }));

  it("defaults to production's 0.70 threshold, and so does the src config", () => {
    expect(DEFAULT_EXTRACTION_MIN_CONFIDENCE).toBe(0.7);
    expect(parse([{ content: "Barış uses pnpm.", confidence: 0.7 }]).candidates).toHaveLength(1);
    expect(parse([{ content: "Barış uses pnpm.", confidence: 0.69 }]).candidates).toHaveLength(0);
  });

  it("rejects a candidate without confidence", () => {
    expect(parse([{ content: "Barış uses pnpm." }]).candidates).toHaveLength(0);
  });

  it("accepts content over 1000 characters", () => {
    const long = "Barış ".repeat(300).trim();
    expect(parse([{ content: long, confidence: 0.9 }]).candidates[0]!.content).toBe(long);
  });

  it("accepts a numeric-string confidence and keeps it unrounded", () => {
    const [c] = parse([{ content: "Barış uses pnpm.", confidence: "0.9" }]).candidates;
    expect(c!.confidence).toBe(0.9);
    expect(parse([{ content: "Barış uses pnpm.", confidence: 0.87654 }]).candidates[0]!.confidence).toBe(0.87654);
  });

  it("returns exactly the validator's action and memoryType (unknown -> create / general)", () => {
    const [c] = parse([{ content: "Barış uses pnpm.", confidence: 0.9, memoryType: "bogus", action: "update" }]).candidates;
    expect(c!.memoryType).toBe("general");
    expect(c!.action).toBe("create");
    const [d] = parse([{ content: "Barış uses pnpm.", confidence: 0.9, memoryType: "WORKFLOW", action: " Forget" }]).candidates;
    expect(d!.memoryType).toBe("workflow");
    expect(d!.action).toBe("forget");
  });

  it("skips null and other non-object entries mid-list and keeps the rest (fix 1)", () => {
    const res = parse([
      { content: "First durable fact.", confidence: 0.9 },
      null,
      "a bare string",
      42,
      [{ content: "nested", confidence: 1 }],
      { content: "Second durable fact.", confidence: 0.9, action: "supersede" }
    ]);
    expect(res.candidates.map((c) => [c.content, c.action])).toEqual([
      ["First durable fact.", "create"],
      ["Second durable fact.", "supersede"]
    ]);
  });

  it("accepts exactly the candidates the shared validator accepts, in order, with its values", () => {
    const r = rng(7);
    for (let round = 0; round < 300; round++) {
      const memories: unknown[] = [];
      const len = Math.floor(r() * 6);
      for (let i = 0; i < len; i++) {
        memories.push(r() < 0.1 ? null : {
          content: pick(r, CONTENT_VALUES.filter((x) => x !== undefined)),
          confidence: r() < 0.5 ? Math.round(r() * 100) / 100 : pick(r, CONFIDENCE_VALUES.filter((x) => x !== undefined)),
          action: pick(r, ACTION_VALUES.filter((x) => x !== undefined)),
          memoryType: pick(r, MEMORY_TYPE_VALUES.filter((x) => x !== undefined))
        });
      }
      const json: unknown[] = JSON.parse(JSON.stringify(memories));
      const expected = json.flatMap((c) => {
        const v = validateMemoryCandidate(c);
        return v ? [v] : [];
      });
      const got = parse(json).candidates.map(({ content, action, memoryType, confidence }) => ({ content, action, memoryType, confidence }));
      expect(got).toEqual(expected);
      // And on legacy-correct lists, the same candidates the old loop processed.
      if (json.every(legacyWasCorrect)) {
        expect(got.map((c) => c.content)).toEqual(
          json.map((c) => legacyDecide(c)).flatMap((d) => (d.kind === "process" ? [d.content] : []))
        );
      }
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
    // The two deliberate changes from production's copy:
    expect(generateDeterministicTitle("istanbul'a uçuş planı yap")).toBe("İstanbul'a uçuş planı yap");
    expect(generateDeterministicTitle("is it raining in London today")).toBe("Is it raining in London today");
    expect(generateDeterministicTitle("a".repeat(36) + "🎉 party")).toBe("A" + "a".repeat(35) + "...");
  });

  // Production's copy, plus the two fixes: no lone surrogate before "..." and
  // "İ" for a leading "i" in Turkish text. Identical on every other input.
  const LONE_HIGH_SURROGATE_BEFORE_DOTS = /[\uD800-\uDBFF]\.\.\.$/;
  function expectedTitle(s: string): string {
    let title = legacyGenerateDeterministicTitle(s);
    if (LONE_HIGH_SURROGATE_BEFORE_DOTS.test(title)) title = title.replace(LONE_HIGH_SURROGATE_BEFORE_DOTS, "...");
    const clean = s.replace(/^[\s#*>`"']+|[\s*>`"']+$/g, "");
    if (/[çğışöüÇĞİŞÖÜ]/.test(clean) && clean.startsWith("i")) title = "İ" + title.slice(1);
    return title;
  }

  it("matches production's copy on fixed and random inputs, apart from the two fixes", () => {
    for (const s of samples) expect(generateDeterministicTitle(s), JSON.stringify(s)).toBe(expectedTitle(s));
    const r = rng(42);
    const alphabet = ["a", "B", "ç", "İ", "ı", " ", "  ", "\n", "\t", "#", "*", ">", "`", "\"", "'", "-", ".", "?", "🎉", "word", "longerword"];
    for (let i = 0; i < 3000; i++) {
      let s = "";
      const len = Math.floor(r() * 40);
      for (let j = 0; j < len; j++) s += pick(r, alphabet);
      const title = generateDeterministicTitle(s);
      expect(title, JSON.stringify(s)).toBe(expectedTitle(s));
      expect(title, JSON.stringify(s)).not.toMatch(LONE_HIGH_SURROGATE_BEFORE_DOTS);
    }
  });
});

describe("functions/api.ts uses the shared modules", () => {
  const index = readFileSync(new URL("../../functions/api.ts", import.meta.url), "utf8");
  // Extraction moved to functions/memory-extraction.ts and the candidate loop
  // to functions/memory-persistence.ts (both bundled into the same
  // functions/lib/index.js); the loop itself is src/'s memory-write-loop.ts.
  const extraction = readFileSync(new URL("../../functions/memory-extraction.ts", import.meta.url), "utf8");
  const persistence = readFileSync(new URL("../../functions/memory-persistence.ts", import.meta.url), "utf8");
  const loop = readFileSync(new URL("../../src/alfred/cognitive/memory/memory-write-loop.ts", import.meta.url), "utf8");
  const source = `${index}\n${extraction}\n${persistence}`;

  it("imports them instead of carrying copies", () => {
    expect(index).toContain('from "../src/data/firestore/conversation-title.js"');
    expect(index).toContain('import { createExtractAndPersistMemories } from "./memory-extraction.js";');
    expect(extraction).toContain('import { runMemoryExtraction } from "../src/alfred/cognitive/memory/extractor/extraction-pipeline.js";');
    expect(persistence).toContain('import { runMemoryWriteLoop } from "../src/alfred/cognitive/memory/memory-write-loop.js";');
    expect(source).not.toMatch(/function\s+generateDeterministicTitle\s*\(/);
    expect(source).not.toContain("You are Alfred's autonomous memory extraction subsystem.");
    expect(source).not.toMatch(/confidence \|\| 0\) < 0\.70/);
    expect(`${extraction}\n${persistence}`).not.toMatch(/validateMemoryCandidate\(|PrivacyFilter\.|extractJsonPayload\(|JSON\.parse\(/);
    expect(index).not.toMatch(/validateMemoryCandidate\(|PrivacyFilter\.|extractJsonPayload\(|getMemoryExtractionCandidates\(/);
  });

  it("the shared loop runs PrivacyFilter on the validated content before acting on it", () => {
    const validateAt = loop.indexOf("validateMemoryCandidate(raw, minConfidence)");
    const privacyAt = loop.indexOf("PrivacyFilter.check(content)");
    const actionAt = loop.indexOf('if (candidate.action === "forget")');
    expect(validateAt).toBeGreaterThan(-1);
    expect(privacyAt).toBeGreaterThan(validateAt);
    expect(actionAt).toBeGreaterThan(privacyAt);
  });
});
