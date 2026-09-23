import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  MEMORY_DUPLICATE_THRESHOLD,
  MEMORY_MATCH_THRESHOLD,
  buildMemoryRetractionUpdate,
  buildMemorySupersessionUpdate,
  buildMemoryVectorRecord,
  createMemoryWriteTally,
  generateMemoryId,
  planMemoryWrite,
  summarizeMemoryWriteTally,
  type ComparableMemoryRecord,
  type MemoryWriteAction
} from "../../src/alfred/cognitive/memory/memory-write-planner.js";
import { GEMINI_EMBEDDING_MODEL, OLLAMA_EMBEDDING_MODEL } from "../../src/ai/embedding/embedding-client.js";
import { persistMemoryCandidates } from "../../functions/memory-persistence.js";
import { legacyPersistMemories } from "./fixtures/legacy-memory-persistence.js";

/**
 * The memory persistence decisions (forget / duplicate / supersede / create)
 * are shared by functions/memory-persistence.js (production) and MemoryService
 * through memory-write-planner.ts. The differential suite runs the production
 * module and a verbatim copy of the former inline loop of functions/index.js
 * (fixtures/legacy-memory-persistence.js) against the same fake Firestore,
 * fake embeddings and injected failures, and requires identical writes,
 * embedding calls, log lines, tallies, summaries and final store contents.
 */

type Rec = ComparableMemoryRecord & { id: string };

function rec(id: string, embedding: unknown, embeddingModel: unknown = GEMINI_EMBEDDING_MODEL): Rec {
  return { id, embedding, embeddingModel };
}

function plan(action: MemoryWriteAction, values: number[], memories: Rec[], model = GEMINI_EMBEDDING_MODEL) {
  const result = planMemoryWrite({ action, embedding: { values, model }, activeMemories: memories, recordOf: (m) => m });
  return "target" in result ? { kind: result.kind, target: result.target.id, score: result.score } : { kind: result.kind };
}

// Against [1, 0] (or [1, 0, 0, 0, 0]) these score exactly, in floating point too.
const AT_06 = [3, 4]; // 0.6
const AT_08 = [4, 3]; // 0.8
const UNIT5 = [1, 0, 0, 0, 0];
const EXACTLY_05 = [1, 1, 1, 1, 0]; // 1 / (2 * 1)
const EXACTLY_085 = [17, 10, 3, 1, 1]; // 17 / (20 * 1)
const BELOW_05 = [1, 1, 1, 1, 0.01];

describe("planMemoryWrite", () => {
  it("uses production's thresholds", () => {
    expect(MEMORY_MATCH_THRESHOLD).toBe(0.5);
    expect(MEMORY_DUPLICATE_THRESHOLD).toBe(0.85);
  });

  it("forget retracts the best comparable match at >= 0.5, earliest on ties", () => {
    expect(plan("forget", [1, 0], [rec("a", AT_06), rec("b", AT_08), rec("c", AT_06)])).toEqual({ kind: "retract", target: "b", score: 0.8 });
    expect(plan("forget", [1, 0], [rec("a", AT_08), rec("b", AT_08)])).toMatchObject({ kind: "retract", target: "a" });
    expect(plan("forget", [1, 0], [rec("a", [1, 1.8])])).toEqual({ kind: "noMatch" });
    expect(plan("forget", UNIT5, [rec("a", EXACTLY_05)])).toEqual({ kind: "retract", target: "a", score: 0.5 });
    expect(plan("forget", UNIT5, [rec("a", BELOW_05)])).toEqual({ kind: "noMatch" });
    expect(plan("forget", [1, 0], [])).toEqual({ kind: "noMatch" });
    expect(plan("forget", [1, 0], [rec("a", [-1, 0])])).toEqual({ kind: "noMatch" });
  });

  it("create is a duplicate at the first comparable match >= 0.85", () => {
    const first = plan("create", [1, 0], [rec("a", AT_06), rec("b", [1, 0.1]), rec("c", [1, 0])]);
    expect(first).toMatchObject({ kind: "skipDuplicate", target: "b" });
    expect(plan("create", [1, 0], [rec("a", AT_08)])).toEqual({ kind: "create" });
    expect(plan("create", UNIT5, [rec("a", EXACTLY_085)])).toEqual({ kind: "skipDuplicate", target: "a", score: 0.85 });
    expect(plan("create", UNIT5, [rec("a", [17, 10, 3, 1, 1.01])])).toEqual({ kind: "create" });
  });

  it("supersede takes the first comparable match >= 0.5, not the best, and never dedups", () => {
    expect(plan("supersede", [1, 0], [rec("a", [0, 1]), rec("b", AT_06), rec("c", [1, 0])])).toEqual({ kind: "supersede", target: "b", score: 0.6 });
    expect(plan("supersede", [1, 0], [rec("a", [1, 0])])).toMatchObject({ kind: "supersede", target: "a" });
    expect(plan("supersede", [1, 0], [rec("a", [0, 1])])).toEqual({ kind: "create" });
    expect(plan("supersede", UNIT5, [rec("a", BELOW_05), rec("b", EXACTLY_05)])).toEqual({ kind: "supersede", target: "b", score: 0.5 });
  });

  it("only compares non-empty embeddings from the same model", () => {
    const memories = [
      rec("wrong-model", [1, 0], OLLAMA_EMBEDDING_MODEL),
      rec("empty", []),
      rec("missing", undefined),
      rec("not-array", "1,0"),
      rec("other-dimension", [1, 0, 0])
    ];
    for (const action of ["create", "supersede"] as const) {
      expect(plan(action, [1, 0], memories)).toEqual({ kind: "create" });
    }
    expect(plan("forget", [1, 0], memories)).toEqual({ kind: "noMatch" });
    expect(plan("forget", [1, 0], memories, OLLAMA_EMBEDDING_MODEL)).toMatchObject({ kind: "retract", target: "wrong-model" });
  });
});

describe("record builders", () => {
  it("builds production's memory_vectors document", () => {
    const now = { t: 1 };
    const record = buildMemoryVectorRecord({
      memoryId: "mem_1_abc",
      userId: "u",
      content: "Barış prefers tea.",
      memoryType: "user_preference",
      sourceConversationId: "c",
      sourceMessageIds: undefined,
      embedding: { values: [1, 2, 3], model: GEMINI_EMBEDDING_MODEL },
      supersedesMemoryId: null,
      now
    });
    expect(Object.keys(record)).toEqual([
      "memoryId", "userId", "content", "memoryType", "sourceConversationId", "sourceMessageIds",
      "embeddingProvider", "embeddingModel", "embeddingDimension", "embedding", "vectorStore", "vectorId",
      "status", "supersedesMemoryId", "indexStatus", "createdAt", "updatedAt", "indexedAt"
    ]);
    expect(record).toMatchObject({
      sourceMessageIds: [],
      embeddingProvider: "gemini",
      embeddingDimension: 3,
      vectorStore: "firestore",
      vectorId: "vec_mem_1_abc",
      status: "active",
      indexStatus: "indexed",
      createdAt: now,
      updatedAt: now,
      indexedAt: now
    });
    expect(buildMemoryVectorRecord({ ...record, sourceMessageIds: ["m"], embedding: { values: [1], model: OLLAMA_EMBEDDING_MODEL }, supersedesMemoryId: "old", now }))
      .toMatchObject({ sourceMessageIds: ["m"], embeddingProvider: "ollama", supersedesMemoryId: "old" });
  });

  it("builds the retraction and supersession updates", () => {
    expect(buildMemoryRetractionUpdate(7)).toEqual({ status: "retracted", updatedAt: 7 });
    expect(buildMemorySupersessionUpdate("mem_x", 7)).toEqual({ status: "superseded", supersededByMemoryId: "mem_x", updatedAt: 7 });
  });

  it("generates production's memory id format", () => {
    expect(generateMemoryId(1700000000000, 0.123456789)).toBe(`mem_1700000000000_${(0.123456789).toString(36).slice(2, 8)}`);
    expect(generateMemoryId()).toMatch(/^mem_\d+_[0-9a-z]{0,6}$/);
  });

  it("summarizes the tally with production's outcome precedence", () => {
    const t = createMemoryWriteTally();
    expect(summarizeMemoryWriteTally(t, "nothing", null)).toEqual({ outcome: "nothing", count: 0, extractor_provider: null, ...t });
    t.failed = 1; expect(summarizeMemoryWriteTally(t, "nothing", "groq").outcome).toBe("failed");
    t.duplicate = 1; expect(summarizeMemoryWriteTally(t, "nothing", "groq").outcome).toBe("duplicate");
    t.retracted = 1; expect(summarizeMemoryWriteTally(t, "nothing", "groq").outcome).toBe("retracted");
    t.stored = 2; expect(summarizeMemoryWriteTally(t, "nothing", "groq")).toMatchObject({ outcome: "stored", count: 3 });
    t.superseded = 1; expect(summarizeMemoryWriteTally(t, "nothing", "groq").outcome).toBe("superseded");
    expect(Object.keys(summarizeMemoryWriteTally(t, "x", null))).toEqual([
      "outcome", "count", "extractor_provider", "stored", "superseded", "retracted", "duplicate", "rejected", "invalid", "failed"
    ]);
  });
});

// ---------------------------------------------------------------------------
// Differential test: production module vs the verbatim legacy loop
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)]!;
}

type Data = Record<string, unknown>;
type Event = { kind: string; [key: string]: unknown };

interface Failures {
  embed: number;
  get: number;
  update: number;
  set: number;
}

/**
 * Minimal Firestore double: `collection().where().where().get()` returns the
 * matching documents in document-id order (Firestore's default), `data()`
 * returns a fresh copy, `ref.update` merges and `doc().set` replaces. Each
 * operation kind fails according to its own seeded stream, so two runs that
 * issue the same operations see the same failures.
 */
class FakeFirestore {
  readonly store = new Map<string, Data>();
  private readonly failRng: Record<keyof Failures, () => number>;

  constructor(initial: Array<[string, Data]>, private readonly events: Event[], seed: number, private readonly failures: Failures) {
    for (const [id, data] of initial) this.store.set(id, structuredClone(data));
    this.failRng = {
      embed: mulberry32(seed ^ 0x1111),
      get: mulberry32(seed ^ 0x2222),
      update: mulberry32(seed ^ 0x3333),
      set: mulberry32(seed ^ 0x4444)
    };
  }

  fails(kind: keyof Failures): boolean {
    return this.failRng[kind]() < this.failures[kind];
  }

  private snapshotDoc(id: string) {
    return {
      id,
      data: () => structuredClone(this.store.get(id)) as Data,
      ref: {
        update: async (payload: Data) => {
          this.events.push({ kind: "update", collection: "memory_vectors", id, payload: structuredClone(payload) });
          if (this.fails("update")) throw new Error(`update ${id} failed`);
          this.store.set(id, { ...this.store.get(id), ...structuredClone(payload) });
        }
      }
    };
  }

  collection(name: string) {
    const filters: Array<[string, unknown]> = [];
    const query = {
      where: (field: string, op: string, value: unknown) => {
        if (op !== "==") throw new Error(`unsupported op ${op}`);
        filters.push([field, value]);
        return query;
      },
      get: async () => {
        this.events.push({ kind: "get", collection: name, filters: [...filters] });
        if (this.fails("get")) throw new Error("query failed");
        const ids = [...this.store.keys()]
          .filter((id) => filters.every(([f, v]) => this.store.get(id)![f] === v))
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const docs = ids.map((id) => this.snapshotDoc(id));
        return { docs, size: docs.length };
      },
      doc: (id: string) => ({
        set: async (payload: Data) => {
          this.events.push({ kind: "set", collection: name, id, payload: structuredClone(payload) });
          if (this.fails("set")) throw new Error(`set ${id} failed`);
          this.store.set(id, structuredClone(payload));
        }
      })
    };
    return query;
  }
}

const USER = "user_1";
const MODELS = [GEMINI_EMBEDDING_MODEL, GEMINI_EMBEDDING_MODEL, GEMINI_EMBEDDING_MODEL, OLLAMA_EMBEDDING_MODEL];
const CONTENTS = [
  "Barış prefers dark roast coffee.",
  "Barış prefers light roast coffee.",
  "The project uses Firestore for state.",
  "The project migrated to Postgres.",
  "Barış works from Istanbul.",
  "Barış no longer works from Istanbul.",
  "password: hunter2hunter2", // PrivacyFilter rejects
  "abc", // too short
  "   Barış likes tea.   "
];

function randomVector(r: () => number, dim: number): number[] {
  // Coarse components make exact ties, collinear vectors and scores right at
  // the 0.5 / 0.85 thresholds common.
  return Array.from({ length: dim }, () => pick(r, [-1, 0, 0, 1, 1, 2, 3]));
}

// Pairs that score exactly 0.5 / 0.85 (and just below) against UNIT5.
const BOUNDARY_VECTORS = [UNIT5, EXACTLY_05, BELOW_05, EXACTLY_085, [17, 10, 3, 1, 1.01]];

function randomEmbedding(r: () => number) {
  const roll = r();
  const values = roll < 0.2 ? [...pick(r, BOUNDARY_VECTORS)] : randomVector(r, roll < 0.92 ? 3 : 2);
  return { values, model: pick(r, MODELS) };
}

function randomDoc(r: () => number, i: number): [string, Data] {
  const id = r() < 0.5 ? `mem_${1000 + Math.floor(r() * 50)}_${i}` : `doc_${String.fromCharCode(97 + Math.floor(r() * 26))}${i}`;
  const e = randomEmbedding(r);
  const embedding = pick(r, ["vector", "vector", "vector", "vector", "empty", "missing", "string"] as const);
  const data: Data = {
    memoryId: id,
    userId: r() < 0.85 ? USER : "someone_else",
    content: pick(r, CONTENTS),
    status: pick(r, ["active", "active", "active", "active", "superseded", "retracted"]),
    embeddingModel: r() < 0.9 ? e.model : undefined
  };
  if (embedding === "vector") data.embedding = e.values;
  else if (embedding === "empty") data.embedding = [];
  else if (embedding === "string") data.embedding = "1,2,3";
  if (data.embeddingModel === undefined) delete data.embeddingModel;
  return [id, data];
}

function randomCandidate(r: () => number): unknown {
  const roll = r();
  if (roll < 0.04) return null;
  if (roll < 0.06) return "not an object";
  const candidate: Data = {
    content: pick(r, CONTENTS),
    memoryType: pick(r, ["user_preference", "project_fact", "general", "bogus", undefined]),
    confidence: pick(r, [0.95, 0.99, 0.8, 0.5, "0.9", undefined]),
    action: pick(r, ["create", "create", "forget", "supersede", "supersede", "SUPERSEDE", "delete", undefined])
  };
  if (r() < 0.05) candidate.content = 42;
  return candidate;
}

interface Scenario {
  seed: number;
  docs: Array<[string, Data]>;
  memories: unknown[];
  embeddings: Map<string, { values: number[]; model: string }>;
  failures: Failures;
  sourceMessageIds: string[] | undefined;
}

function makeScenario(seed: number): Scenario {
  const r = mulberry32(seed);
  const docs = Array.from({ length: Math.floor(r() * 9) }, (_, i) => randomDoc(r, i));
  const memories = Array.from({ length: Math.floor(r() * 7) }, () => randomCandidate(r));
  const embeddings = new Map<string, { values: number[]; model: string }>();
  for (const content of CONTENTS) {
    // Candidates embed their trimmed content; sometimes reuse an existing
    // memory's vector so exact duplicates/matches are frequent.
    const reuse = docs.length > 0 && r() < 0.35 ? docs[Math.floor(r() * docs.length)]![1] : null;
    const values = reuse && Array.isArray(reuse.embedding) && reuse.embedding.length > 0 ? (reuse.embedding as number[]) : null;
    embeddings.set(content.trim(), values ? { values, model: String(reuse!.embeddingModel ?? GEMINI_EMBEDDING_MODEL) } : randomEmbedding(r));
  }
  const noisy = r() < 0.3;
  return {
    seed,
    docs,
    memories,
    embeddings,
    failures: noisy
      ? { embed: 0.15, get: 0.1, update: 0.15, set: 0.15 }
      : { embed: 0, get: 0, update: 0, set: 0 },
    sourceMessageIds: r() < 0.8 ? ["msg_u", "msg_a"] : undefined
  };
}

type Runner = "legacy" | "shared";

async function run(runner: Runner, s: Scenario) {
  const events: Event[] = [];
  const db = new FakeFirestore(s.docs, events, s.seed, s.failures);
  const logger = {
    info: (...args: unknown[]) => { events.push({ kind: "log", level: "info", args: structuredClone(args) }); },
    warn: (...args: unknown[]) => { events.push({ kind: "log", level: "warn", args: structuredClone(args) }); }
  };
  let tsCounter = 0;
  const Timestamp = { now: () => ({ ts: ++tsCounter }) };
  const getEmbedding = async (text: string, ollamaUrl: unknown, geminiKey: unknown) => {
    events.push({ kind: "embed", text, ollamaUrl, geminiKey });
    if (db.fails("embed")) throw new Error("Neither Gemini nor Ollama could generate embedding");
    const e = s.embeddings.get(text);
    if (!e) throw new Error(`no embedding for ${text}`);
    return { values: [...e.values], model: e.model };
  };
  const errMessage = (err: unknown) => String((err as Error)?.message || err || "unknown error").slice(0, 300);

  // Memory ids come from Date.now() and Math.random(); both runs get the same
  // deterministic sequence.
  let clock = 1_750_000_000_000;
  const idRng = mulberry32(s.seed ^ 0x5555);
  vi.spyOn(Date, "now").mockImplementation(() => (clock += 7));
  vi.spyOn(Math, "random").mockImplementation(() => idRng());

  const common = { memories: structuredClone(s.memories), userId: USER, conversationId: "conv_1", sourceMessageIds: s.sourceMessageIds };
  let tally;
  let summary;
  try {
    if (runner === "legacy") {
      ({ tally, summary } = await legacyPersistMemories({
        db, logger, Timestamp, getEmbedding, errMessage, ollamaUrl: "http://ollama", geminiKey: "gk", extractorProvider: "groq", ...common
      }));
    } else {
      tally = createMemoryWriteTally();
      await persistMemoryCandidates({
        db,
        logger,
        now: () => Timestamp.now(),
        embed: (text: string) => getEmbedding(text, "http://ollama", "gk"),
        errMessage,
        tally,
        ...common
      });
      summary = summarizeMemoryWriteTally(tally, "nothing", "groq");
    }
  } finally {
    vi.restoreAllMocks();
  }
  return { events, tally, summary, store: [...db.store.entries()].sort(), timestamps: tsCounter };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("functions/memory-persistence.js matches the pre-refactor inline loop", () => {
  it("makes identical writes, logs, tallies and summaries over 5000 random turns", async () => {
    const coverage = {
      stored: 0, superseded: 0, retracted: 0, duplicate: 0, rejected: 0, invalid: 0, failed: 0,
      duplicateAfterSameTurnWrite: 0, failedAfterSupersede: 0
    };
    for (let seed = 1; seed <= 5000; seed++) {
      const s = makeScenario(seed);
      const legacy = await run("legacy", s);
      const shared = await run("shared", s);
      expect(shared, `seed ${seed}`).toEqual(legacy);

      for (const key of ["stored", "superseded", "retracted", "duplicate", "rejected", "invalid", "failed"] as const) {
        coverage[key] += legacy.tally[key];
      }
      // Walk the legacy event stream for the harder interactions.
      let writtenThisTurn = false;
      let supersededThisCandidate = false;
      for (const e of legacy.events) {
        const msg = e.kind === "log" ? String((e.args as unknown[])[0]) : "";
        if (e.kind === "set") writtenThisTurn = true;
        if (e.kind === "embed") supersededThisCandidate = false;
        if (e.kind === "update" && (e.payload as Data).status === "superseded") supersededThisCandidate = true;
        if (msg.startsWith("[Memory] Failed to save memory candidate") && supersededThisCandidate) coverage.failedAfterSupersede++;
        if (msg.startsWith("[Memory] Suppressed duplicate memory") && writtenThisTurn) coverage.duplicateAfterSameTurnWrite++;
      }
    }
    // Every branch must actually be exercised, including failures and
    // same-turn interactions.
    for (const [key, count] of Object.entries(coverage)) {
      expect(count, key).toBeGreaterThan(20);
    }
  }, 120_000);
});

describe("functions wiring", () => {
  const index = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");
  const persistence = readFileSync(new URL("../../functions/memory-persistence.js", import.meta.url), "utf8");

  it("index.js delegates persistence to memory-persistence.js and the shared tally", () => {
    expect(index).toContain('from "./memory-persistence.js"');
    expect(index).toMatch(/createMemoryWriteTally,[\s\S]*summarizeMemoryWriteTally[\s\S]*from "\.\.\/src\/alfred\/cognitive\/memory\/memory-write-planner\.js"/);
    expect(index).toContain("await persistMemoryCandidates({");
    expect(index).not.toContain('status: "retracted"');
    expect(index).not.toContain("score >= 0.85");
  });

  it("memory-persistence.js takes its decisions and records from the shared planner", () => {
    expect(persistence).toContain('from "../src/alfred/cognitive/memory/memory-write-planner.js"');
    expect(persistence).toContain("planMemoryWrite({");
    expect(persistence).toContain("buildMemoryVectorRecord({");
    expect(persistence).not.toMatch(/cosineSimilarity|isComparableEmbedding|0\.85|>= 0\.5/);
    expect(persistence).not.toMatch(/from "firebase-/);
  });
});
