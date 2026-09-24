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
  normalizeMemoryContent,
  planMemoryWrite,
  summarizeMemoryWriteTally,
  type ComparableMemoryRecord,
  type MemoryWriteAction
} from "../../src/alfred/cognitive/memory/memory-write-planner.js";
import {
  GEMINI_EMBEDDING_MODEL,
  OLLAMA_EMBEDDING_MODEL,
  isComparableEmbedding
} from "../../src/ai/embedding/embedding-client.js";
import { cosineSimilarity } from "../../src/data/vector/cosine-similarity.js";
import { validateMemoryCandidate } from "../../src/ai/prompts/memory-extraction.js";
import { PrivacyFilter } from "../../src/alfred/cognitive/memory/privacy-filter.js";
import { persistMemoryCandidates } from "../../functions/memory-persistence.js";
import { legacyPersistMemories } from "./fixtures/legacy-memory-persistence.js";
import { legacyPersistMemoryCandidatesBatch } from "./fixtures/legacy-memory-persistence-batch.js";
import { MemoryService } from "../../src/alfred/cognitive/memory/memory-service.js";
import { InMemoryMemoryRepository } from "../../src/data/firestore/in-memory-memory-repository.js";
import { InMemoryVectorStore } from "../../src/data/vector/in-memory-vector-store.js";
import { InMemoryPendingEmbeddingStore } from "../../src/data/vector/in-memory-pending-embedding-store.js";

/**
 * The memory persistence decisions (forget / duplicate / supersede / create)
 * are shared by functions/memory-persistence.js (production) and MemoryService
 * through memory-write-planner.ts.
 *
 * The differential suite runs the production module and a verbatim copy of
 * the former inline loop of functions/index.js
 * (fixtures/legacy-memory-persistence.js) against the same fake Firestore,
 * fake embeddings and injected failures. Five production bugs were fixed
 * since that copy was taken:
 *
 * 1. supersede is one Firestore batch (old marked superseded + new record);
 * 2. supersede targets the best match >= 0.5, not the first;
 * 3. supersede skips an exact normalized-content duplicate;
 * 4. create and supersede skip an exact normalized-content duplicate across
 *    embedding models;
 * 5. log lines carry memory_id / memory_type / content_length, never text.
 *
 * `affectedByFixes` finds the turns where 1-4 change the outcome; every other
 * turn must produce identical reads, writes, embedding calls, tallies,
 * summaries and final store contents, and identical log lines up to fix 5
 * (`logKey`). All turns, affected or not, must satisfy the fixed invariants
 * (`checkInvariants`). The explicit tests below pin each fix.
 */

type Rec = ComparableMemoryRecord & { id: string };

function rec(id: string, embedding: unknown, embeddingModel: unknown = GEMINI_EMBEDDING_MODEL, content: unknown = `stored ${id}`): Rec {
  return { id, embedding, embeddingModel, content };
}

function plan(action: MemoryWriteAction, values: number[], memories: Rec[], model = GEMINI_EMBEDDING_MODEL, content = "the candidate") {
  const result = planMemoryWrite({ action, content, embedding: { values, model }, activeMemories: memories, recordOf: (m) => m });
  if (result.kind === "skipDuplicate") return { kind: result.kind, target: result.target.id, score: result.score, match: result.match };
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
    expect(first).toMatchObject({ kind: "skipDuplicate", target: "b", match: "embedding" });
    expect(plan("create", [1, 0], [rec("a", AT_08)])).toEqual({ kind: "create" });
    expect(plan("create", UNIT5, [rec("a", EXACTLY_085)])).toEqual({ kind: "skipDuplicate", target: "a", score: 0.85, match: "embedding" });
    expect(plan("create", UNIT5, [rec("a", [17, 10, 3, 1, 1.01])])).toEqual({ kind: "create" });
  });

  it("supersede takes the best comparable match >= 0.5 (fix 2), earliest on ties, and is not cosine-deduped", () => {
    // Formerly "b" (the first match >= 0.5); now "c", the best.
    expect(plan("supersede", [1, 0], [rec("a", [0, 1]), rec("b", AT_06), rec("c", [1, 0])])).toEqual({ kind: "supersede", target: "c", score: 1 });
    expect(plan("supersede", [1, 0], [rec("a", AT_06), rec("b", AT_08), rec("c", AT_08)])).toEqual({ kind: "supersede", target: "b", score: 0.8 });
    // Cosine 1.0 with different text is a legitimate update, not a duplicate.
    expect(plan("supersede", [1, 0], [rec("a", [1, 0])])).toEqual({ kind: "supersede", target: "a", score: 1 });
    expect(plan("supersede", [1, 0], [rec("a", [0, 1])])).toEqual({ kind: "create" });
    expect(plan("supersede", UNIT5, [rec("a", BELOW_05), rec("b", EXACTLY_05)])).toEqual({ kind: "supersede", target: "b", score: 0.5 });
    expect(plan("supersede", UNIT5, [rec("a", BELOW_05)])).toEqual({ kind: "create" });
  });

  it("create and supersede skip an exact normalized-content duplicate across all models (fixes 3 and 4)", () => {
    const content = "Barış prefers dark roast coffee.";
    const memories = [
      rec("far", [0, 1], GEMINI_EMBEDDING_MODEL, "Something else entirely."),
      rec("other-model", [5, 5, 5], OLLAMA_EMBEDDING_MODEL, "  barış PREFERS dark\n roast   coffee. "),
      rec("same", [1, 0], GEMINI_EMBEDDING_MODEL, content)
    ];
    for (const action of ["create", "supersede"] as const) {
      expect(plan(action, [1, 0], memories, GEMINI_EMBEDDING_MODEL, content)).toEqual({
        kind: "skipDuplicate", target: "other-model", score: null, match: "exact_content"
      });
    }
    // No embedding at all still counts; non-string content never does.
    expect(plan("create", [1, 0], [rec("bare", undefined, undefined, content)], GEMINI_EMBEDDING_MODEL, content))
      .toMatchObject({ kind: "skipDuplicate", target: "bare", match: "exact_content" });
    expect(plan("create", [1, 0], [rec("num", [0, 1], GEMINI_EMBEDDING_MODEL, 42)], GEMINI_EMBEDDING_MODEL, "42 is the answer"))
      .toEqual({ kind: "create" });
    // Not fuzzy: punctuation or a single word changes it.
    expect(plan("create", [1, 0], [rec("a", [0, 1], GEMINI_EMBEDDING_MODEL, "Barış prefers dark roast coffee")], GEMINI_EMBEDDING_MODEL, content))
      .toEqual({ kind: "create" });
    // forget ignores content.
    expect(plan("forget", [1, 0], [rec("a", [0, 1], GEMINI_EMBEDDING_MODEL, content)], GEMINI_EMBEDDING_MODEL, content))
      .toEqual({ kind: "noMatch" });
  });

  it("normalizeMemoryContent trims, collapses whitespace and lower-cases", () => {
    expect(normalizeMemoryContent("  Barış\tUSES \n\n Vim.  ")).toBe("barış uses vim.");
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
type Event = { kind: string; failed?: true; [key: string]: unknown };

interface Failures {
  embed: number;
  get: number;
  update: number;
  set: number;
}

const NO_FAILURES: Failures = { embed: 0, get: 0, update: 0, set: 0 };

/**
 * Minimal Firestore double: `collection().where().where().get()` returns the
 * matching documents in document-id order (Firestore's default), `data()`
 * returns a fresh copy, `ref.update` merges, `doc().set` replaces and
 * `batch()` queues updates/sets that `commit()` applies all together or not at
 * all. Each write kind fails according to its own seeded stream (a batch rolls
 * each queued op in order and stops at the first failure, which consumes the
 * streams exactly like the same writes issued one by one), so two runs that
 * issue the same operations see the same failures. Failed events are flagged.
 */
class FakeFirestore {
  readonly store = new Map<string, Data>();
  /** Every batch created, with its op kinds and whether it committed. */
  readonly batches: Array<{ ops: string[]; committed: boolean }> = [];
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

  /** Records a write event, then throws if its seeded stream says it fails. */
  private attempt(kind: "update" | "set", id: string, payload: Data): void {
    const event: Event = { kind, collection: "memory_vectors", id, payload: structuredClone(payload) };
    this.events.push(event);
    if (this.fails(kind)) {
      event.failed = true;
      throw new Error(`${kind} ${id} failed`);
    }
  }

  private apply(kind: "update" | "set", id: string, payload: Data): void {
    this.store.set(id, kind === "update" ? { ...this.store.get(id), ...structuredClone(payload) } : structuredClone(payload));
  }

  private snapshotDoc(id: string) {
    return {
      id,
      data: () => structuredClone(this.store.get(id)) as Data,
      ref: {
        id,
        update: async (payload: Data) => {
          this.attempt("update", id, payload);
          this.apply("update", id, payload);
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
        const event: Event = { kind: "get", collection: name, filters: [...filters] };
        this.events.push(event);
        if (this.fails("get")) {
          event.failed = true;
          throw new Error("query failed");
        }
        const ids = [...this.store.keys()]
          .filter((id) => filters.every(([f, v]) => this.store.get(id)![f] === v))
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        // What the caller saw, for the "affected by the fixes" walk below.
        event.docs = ids.map((id) => ({ id, data: structuredClone(this.store.get(id)) }));
        const docs = ids.map((id) => this.snapshotDoc(id));
        return { docs, size: docs.length };
      },
      doc: (id: string) => ({
        id,
        set: async (payload: Data) => {
          this.attempt("set", id, payload);
          this.apply("set", id, payload);
        }
      })
    };
    return query;
  }

  batch() {
    const ops: Array<{ kind: "update" | "set"; id: string; payload: Data }> = [];
    const record = { ops: [] as string[], committed: false };
    this.batches.push(record);
    const queue = (kind: "update" | "set") => (ref: { id: string }, payload: Data) => {
      ops.push({ kind, id: ref.id, payload: structuredClone(payload) });
      record.ops.push(kind);
    };
    return {
      update: queue("update"),
      set: queue("set"),
      commit: async () => {
        for (const op of ops) this.attempt(op.kind, op.id, op.payload);
        for (const op of ops) this.apply(op.kind, op.id, op.payload);
        record.committed = true;
      }
    };
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
// Stored-only texts: most existing memories differ in wording from every
// candidate, so exact-content duplicates (fixes 3 and 4) stay the exception
// and most scenarios remain comparable with the legacy loop.
const STORED_ONLY = [
  "Barış drinks espresso every morning.",
  "The staging database is Firestore.",
  "Barış is based in Turkey.",
  "Barış enjoys green tea.",
  "Alfred runs on Cloud Functions."
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
    content: r() < 0.15 ? pick(r, CONTENTS) : pick(r, STORED_ONLY),
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
    // memory's vector so cosine duplicates/matches are frequent.
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
      : NO_FAILURES,
    sourceMessageIds: r() < 0.8 ? ["msg_u", "msg_a"] : undefined
  };
}

/**
 * legacy: the pre-refactor inline loop of functions/index.js;
 * batch: functions/memory-persistence.js as it was before its loop moved to
 *   the shared memory-write-loop.ts (fixtures/legacy-memory-persistence-batch.js);
 * shared: the current production module.
 */
type Runner = "legacy" | "batch" | "shared";

/**
 * The log lines fix 5 rewrote (they used to embed memory text) compare by
 * kind and memory id; every other log line compares verbatim, arguments too.
 */
function logKey(e: Event): unknown[] {
  const args = e.args as unknown[];
  const msg = String(args[0]);
  const retracted = /^\[Memory\] Retracted memory (\S+)/.exec(msg);
  if (retracted) return [e.level, "retracted", retracted[1]];
  if (msg.startsWith("[Memory] Suppressed duplicate memory")) return [e.level, "duplicate"];
  if (msg.startsWith("[Memory] Stored long-term memory in Firestore")) return [e.level, "stored"];
  return [e.level, ...args];
}

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
    const event: Event = { kind: "embed", text, ollamaUrl, geminiKey };
    events.push(event);
    if (db.fails("embed")) {
      event.failed = true;
      throw new Error("Neither Gemini nor Ollama could generate embedding");
    }
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
      await (runner === "batch" ? legacyPersistMemoryCandidatesBatch : persistMemoryCandidates)({
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
  const logs = events.filter((e) => e.kind === "log");
  return {
    // Writes/reads/embeds and logs are separate streams: the batch moves the
    // "Superseded memory" log after the commit, i.e. after the new record's set.
    comparable: {
      io: events.filter((e) => e.kind !== "log"),
      logs: logs.map(logKey),
      tally,
      summary,
      store: [...db.store.entries()].sort(),
      timestamps: tsCounter
    },
    // Everything, logs verbatim, for the batch-vs-shared comparison.
    exact: {
      events,
      tally,
      summary,
      store: [...db.store.entries()].sort(),
      batches: db.batches,
      timestamps: tsCounter
    },
    events,
    logs,
    store: new Map(db.store)
  };
}

type FixReason = "fix1-atomic-supersede" | "fix2-best-match" | "fix3-4-exact-duplicate";

/**
 * Walks a legacy run and reports the first place where fixes 1-4 change
 * production's behaviour; from there on the two runs legitimately diverge.
 * Fix 5 (log text) applies to every run and is handled by `logKey`.
 */
function affectedByFixes(s: Scenario, events: Event[]): FixReason | null {
  // Fix 1: the old record was marked superseded but the new record's set failed.
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.kind === "update" && (e.payload as Data).status === "superseded" && !e.failed) {
      const next = events.slice(i + 1).find((x) => x.kind !== "log");
      if (next?.kind === "set" && next.failed) return "fix1-atomic-supersede";
    }
  }

  let cursor = 0;
  for (const candidate of s.memories) {
    const v = validateMemoryCandidate(candidate);
    if (!v || !PrivacyFilter.check(v.content).isSafe) continue;
    while (cursor < events.length && events[cursor]!.kind !== "embed") cursor++;
    const embedEvent = events[cursor++];
    if (!embedEvent || embedEvent.text !== v.content) throw new Error(`walk out of sync at seed ${s.seed}`);
    if (embedEvent.failed || v.action === "forget") continue;
    const get = events.slice(cursor).find((e) => e.kind !== "log");
    if (!get || get.kind !== "get" || get.failed) continue;
    const docs = get.docs as Array<{ id: string; data: Data }>;

    const normalized = normalizeMemoryContent(v.content);
    if (docs.some((d) => typeof d.data.content === "string" && normalizeMemoryContent(d.data.content) === normalized)) {
      return "fix3-4-exact-duplicate";
    }
    if (v.action === "supersede") {
      const embedding = s.embeddings.get(v.content)!;
      let first: string | null = null;
      let best: string | null = null;
      let bestScore = 0;
      for (const d of docs) {
        if (!isComparableEmbedding(d.data, embedding.model)) continue;
        const score = cosineSimilarity(embedding.values, d.data.embedding as number[]);
        if (score >= MEMORY_MATCH_THRESHOLD && first === null) first = d.id;
        if (score > bestScore) {
          bestScore = score;
          best = d.id;
        }
      }
      if (first !== null && first !== best) return "fix2-best-match";
    }
  }
  return null;
}

const CANDIDATE_TEXTS = CONTENTS.map((c) => c.trim()).filter((c) => c.length >= 5);
const STORED_TEXTS = [...CANDIDATE_TEXTS, ...STORED_ONLY];

/** Properties the fixed module must have in every scenario, affected or not. */
function checkInvariants(s: Scenario, shared: Awaited<ReturnType<typeof run>>) {
  const where = `seed ${s.seed}`;
  // Fix 5: no memory text in any log call.
  for (const log of shared.logs) {
    const text = JSON.stringify(log.args);
    for (const t of STORED_TEXTS) expect(text.includes(t), `${where}: ${text}`).toBe(false);
  }
  // Fix 1: a new record that supersedes X exists iff X points back at it.
  const initial = new Set(s.docs.map(([id]) => id));
  for (const [id, d] of shared.store) {
    if (!initial.has(id) && d.supersedesMemoryId) {
      const old = shared.store.get(String(d.supersedesMemoryId));
      expect(old?.status, where).toBe("superseded");
      expect(old?.supersededByMemoryId, where).toBe(id);
    }
    if (d.supersededByMemoryId) {
      expect(shared.store.get(String(d.supersededByMemoryId))?.supersedesMemoryId, where).toBe(id);
    }
  }
  // Fixes 3 and 4: a record written this turn never duplicates another active one.
  const active = [...shared.store].filter(([, d]) => d.userId === USER && d.status === "active");
  for (const [id, d] of active) {
    if (initial.has(id)) continue;
    const norm = normalizeMemoryContent(String(d.content));
    const twins = active.filter(([otherId, o]) => otherId !== id && typeof o.content === "string" && normalizeMemoryContent(o.content) === norm);
    expect(twins, where).toEqual([]);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("functions/memory-persistence.js vs the pre-refactor inline loop", () => {
  it("is identical wherever fixes 1-4 do not apply, and keeps the fixed invariants everywhere (8000 random turns)", async () => {
    const coverage = {
      stored: 0, superseded: 0, retracted: 0, duplicate: 0, rejected: 0, invalid: 0, failed: 0,
      duplicateAfterSameTurnWrite: 0, failedAfterSupersede: 0
    };
    const affected: Record<FixReason, number> = { "fix1-atomic-supersede": 0, "fix2-best-match": 0, "fix3-4-exact-duplicate": 0 };
    let unaffected = 0;

    for (let seed = 1; seed <= 8000; seed++) {
      const s = makeScenario(seed);
      const legacy = await run("legacy", s);
      const shared = await run("shared", s);
      checkInvariants(s, shared);

      const reason = affectedByFixes(s, legacy.events);
      if (reason) {
        affected[reason]++;
        continue;
      }
      unaffected++;
      expect(shared.comparable, `seed ${seed}`).toEqual(legacy.comparable);

      for (const key of ["stored", "superseded", "retracted", "duplicate", "rejected", "invalid", "failed"] as const) {
        coverage[key] += legacy.comparable.tally[key];
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
    // Most turns stay comparable, every branch is exercised in them
    // (including failures and same-turn interactions), and every fix is
    // actually hit by the random scenarios.
    if (process.env.PRINT_COVERAGE) console.log({ unaffected, affected, coverage });
    expect(unaffected).toBeGreaterThan(3000);
    for (const [key, count] of Object.entries(coverage)) {
      expect(count, key).toBeGreaterThan(20);
    }
    for (const [key, count] of Object.entries(affected)) {
      expect(count, key).toBeGreaterThan(20);
    }
  }, 180_000);
});

describe("functions/memory-persistence.js on the shared write loop vs its pre-loop version", () => {
  // The loop moved to src/alfred/cognitive/memory/memory-write-loop.ts (shared
  // with MemoryService). Production behaviour is meant to be unchanged, so
  // there is no exclusion: every read, write, batch, embedding call, log line
  // (verbatim, arguments included), tally, summary and final store content
  // must be identical on every turn.
  it("is identical on 8000 random turns (no exclusions)", async () => {
    const outcomes: Record<string, number> = {};
    for (let seed = 1; seed <= 8000; seed++) {
      const s = makeScenario(seed);
      const before = await run("batch", s);
      const after = await run("shared", s);
      expect(after.exact, `seed ${seed}`).toEqual(before.exact);
      const outcome = String(before.exact.summary.outcome);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
    if (process.env.PRINT_COVERAGE) console.log({ outcomes });
    for (const outcome of ["stored", "superseded", "retracted", "duplicate", "failed", "nothing"]) {
      expect(outcomes[outcome] ?? 0, outcome).toBeGreaterThan(50);
    }
  }, 180_000);
});

describe("MemoryService and production make the same write decisions (shared loop)", () => {
  // The storage layers differ on purpose (Firestore batch vs repository +
  // vector store, see memory-write-loop.ts), so this compares decisions and
  // outcomes, not I/O: the tally, the final status of every existing memory
  // and the records written (content, type, lineage, embedding model), on
  // turns without injected failures.
  function newRecordKey(content: unknown, memoryType: unknown, supersedes: unknown, model: unknown, newIds: string[]) {
    const lineage = typeof supersedes === "string" && newIds.includes(supersedes) ? `new#${newIds.indexOf(supersedes)}` : supersedes ?? null;
    return [content, memoryType, lineage, model];
  }

  it("matches production on 2000 random turns and never logs memory text", async () => {
    let compared = 0;
    let logLines = 0;
    try {
      for (let seed = 1; seed <= 2000; seed++) {
        const s0 = makeScenario(seed);
        const s = { ...s0, failures: NO_FAILURES, docs: s0.docs.filter(([, d]) => d.userId === USER).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) };
        if (s.memories.length === 0) continue;
        const production = await run("shared", s);
        const initialIds = s.docs.map(([id]) => id);
        const prodNewIds = [...production.store.keys()].filter((id) => !initialIds.includes(id)).sort();

        const memoryRepo = new InMemoryMemoryRepository();
        for (const [id, d] of s.docs) {
          await memoryRepo.createMemoryRecord({
            memoryId: id, userId: USER, content: String(d.content), memoryType: "general",
            embeddingProvider: "gemini", embeddingModel: d.embeddingModel as string, embeddingDimension: 0,
            embedding: d.embedding as number[], vectorStore: "test", status: d.status as "active"
          });
        }
        let clock = 1_750_000_000_000;
        const idRng = mulberry32(s.seed ^ 0x5555);
        vi.spyOn(Date, "now").mockImplementation(() => (clock += 7));
        vi.spyOn(Math, "random").mockImplementation(() => idRng());
        const service = new MemoryService({
          memoryRepo,
          vectorStore: new InMemoryVectorStore(),
          pendingStore: new InMemoryPendingEmbeddingStore(),
          embeddingProvider: {
            id: "table", model: "unused", dimension: 0,
            embed: async () => { throw new Error("embedDetailed expected"); },
            embedBatch: async () => [],
            isConfigured: () => true,
            embedDetailed: async (text: string) => {
              const e = s.embeddings.get(text);
              if (!e) throw new Error("no embedding");
              return { values: [...e.values], model: e.model, provider: "table" };
            }
          },
          extractor: { extract: async () => ({ shouldRemember: true, candidates: structuredClone(s.memories) as never }) },
          config: { extraction: { enabled: true, minConfidence: 0.7, maxContextMessages: 10, timeoutMs: 1000 } }
        });
        // run() restores all mocks, so the console spies are installed per turn.
        const consoleSpies = (["log", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
        const result = await service.processConversationForMemories({ currentMessage: "x", userId: USER, conversationId: "conv_1" });
        const consoleLines = consoleSpies.flatMap((spy) => spy.mock.calls.map((args) => JSON.stringify(args)));
        vi.restoreAllMocks();

        const where = `seed ${seed}`;
        for (const line of consoleLines) {
          for (const t of STORED_TEXTS) expect(line.includes(t), `${where}: ${line}`).toBe(false);
        }
        logLines += consoleLines.length;
        expect(result.tally, where).toEqual(production.exact.tally);
        for (const id of initialIds) {
          expect((await memoryRepo.getMemoryRecordByMemoryId(id))?.status, `${where} ${id}`).toBe(production.store.get(id)!.status);
        }
        const srcNew = result.created.map((r) => r.memoryId);
        expect(result.created.map((r) => newRecordKey(r.content, r.memoryType, r.supersedesMemoryId, r.embeddingModel, srcNew)), where)
          .toEqual(prodNewIds.map((id) => {
            const d = production.store.get(id)!;
            return newRecordKey(d.content, d.memoryType, d.supersedesMemoryId, d.embeddingModel, prodNewIds);
          }));
        compared++;
      }
    } finally {
      vi.restoreAllMocks();
    }
    expect(compared).toBeGreaterThan(1200);
    expect(logLines).toBeGreaterThan(1000);
  }, 180_000);
});

// ---------------------------------------------------------------------------
// Explicit tests for the fixes
// ---------------------------------------------------------------------------

type Embeddings = Record<string, { values: number[]; model: string }>;

function activeDoc(id: string, content: string, embedding: number[], embeddingModel = GEMINI_EMBEDDING_MODEL, memoryType = "general"): [string, Data] {
  return [id, { memoryId: id, userId: USER, content, memoryType, status: "active", embedding, embeddingModel }];
}

function cand(content: string, action: string, memoryType = "project_fact") {
  return { content, action, memoryType, confidence: 0.95 };
}

async function persist(docs: Array<[string, Data]>, memories: unknown[], embeddings: Embeddings, failures: Partial<Failures> = {}) {
  const events: Event[] = [];
  const db = new FakeFirestore(docs, events, 7, { ...NO_FAILURES, ...failures });
  const logs: unknown[][] = [];
  const logger = {
    info: (...args: unknown[]) => { logs.push(args); },
    warn: (...args: unknown[]) => { logs.push(args); }
  };
  const tally = createMemoryWriteTally();
  let ts = 0;
  await persistMemoryCandidates({
    db,
    memories,
    userId: USER,
    conversationId: "conv_1",
    sourceMessageIds: ["msg_1"],
    embed: async (text: string) => {
      const e = embeddings[text];
      if (!e) throw new Error("no embedding");
      return { values: [...e.values], model: e.model };
    },
    logger,
    now: () => ({ ts: ++ts }),
    errMessage: (err: unknown) => String((err as Error)?.message || err),
    tally
  });
  const newIds = [...db.store.keys()].filter((id) => !docs.some(([d]) => d === id));
  return { db, events, logs, tally, store: db.store, newIds };
}

describe("memory persistence fixes (production module)", () => {
  const NEW = "Barış migrated CI to GitHub Actions.";
  const OLD = "Barış uses Jenkins for CI.";

  it("fix 1: a supersede commits the old-record update and the new record in one batch", async () => {
    const r = await persist([activeDoc("old", OLD, [1, 0])], [cand(NEW, "supersede")], { [NEW]: { values: [1, 0.1], model: GEMINI_EMBEDDING_MODEL } });
    expect(r.db.batches).toEqual([{ ops: ["update", "set"], committed: true }]);
    const [newId] = r.newIds;
    expect(r.store.get("old")).toMatchObject({ status: "superseded", supersededByMemoryId: newId });
    expect(r.store.get(newId!)).toMatchObject({ status: "active", supersedesMemoryId: "old", content: NEW });
    expect(r.tally).toMatchObject({ stored: 1, superseded: 1, failed: 0 });
  });

  it("fix 1: a plain create is a single set, no batch", async () => {
    const r = await persist([], [cand(NEW, "create")], { [NEW]: { values: [1, 0], model: GEMINI_EMBEDDING_MODEL } });
    expect(r.db.batches).toEqual([]);
    expect(r.newIds).toHaveLength(1);
  });

  for (const failing of ["set", "update"] as const) {
    it(`fix 1: when the batch's ${failing} fails, neither write lands and the old fact survives`, async () => {
      const r = await persist(
        [activeDoc("old", OLD, [1, 0])],
        [cand(NEW, "supersede")],
        { [NEW]: { values: [1, 0.1], model: GEMINI_EMBEDDING_MODEL } },
        { [failing]: 1 }
      );
      expect(r.db.batches).toEqual([{ ops: ["update", "set"], committed: false }]);
      expect(r.store.get("old")).toEqual(activeDoc("old", OLD, [1, 0])[1]);
      expect(r.newIds).toEqual([]);
      expect(r.tally).toMatchObject({ stored: 0, superseded: 0, failed: 1 });
      expect(r.logs.map((l) => String(l[0]))).toEqual([`[Memory] Failed to save memory candidate: ${failing} ${failing === "set" ? r.events.find((e) => e.kind === "set")!.id : "old"} failed`]);
    });
  }

  it("fix 1: the legacy loop lost the old fact when the new record's set failed", async () => {
    const events: Event[] = [];
    const db = new FakeFirestore([activeDoc("old", OLD, [1, 0])], events, 7, { ...NO_FAILURES, set: 1 });
    const silent = { info: () => {}, warn: () => {} };
    await legacyPersistMemories({
      db, logger: silent, Timestamp: { now: () => 1 },
      getEmbedding: async () => ({ values: [1, 0.1], model: GEMINI_EMBEDDING_MODEL }),
      errMessage: String, ollamaUrl: "", geminiKey: "", memories: [cand(NEW, "supersede")],
      userId: USER, conversationId: "c", sourceMessageIds: [], extractorProvider: null
    });
    // Old record superseded, pointing at a record that was never written.
    expect(db.store.get("old")?.status).toBe("superseded");
    expect(db.store.size).toBe(1);
  });

  it("fix 2: a supersede replaces the best match, not the first one >= 0.5", async () => {
    const r = await persist(
      [activeDoc("a_first", "Barış uses Travis for CI.", [3, 4]), activeDoc("b_best", OLD, [4, 3]), activeDoc("c_tie", "Barış uses Drone for CI.", [4, 3])],
      [cand(NEW, "supersede")],
      { [NEW]: { values: [1, 0], model: GEMINI_EMBEDDING_MODEL } }
    );
    expect(r.store.get("b_best")?.status).toBe("superseded");
    expect(r.store.get("a_first")?.status).toBe("active");
    expect(r.store.get("c_tie")?.status).toBe("active");
    expect(r.store.get(r.newIds[0]!)?.supersedesMemoryId).toBe("b_best");
  });

  it("fix 3: a supersede whose normalized content already exists is skipped as a duplicate", async () => {
    const r = await persist(
      [activeDoc("same", "  barış MIGRATED ci to github\tactions. ", [0, 1]), activeDoc("old", OLD, [1, 0])],
      [cand(NEW, "supersede")],
      { [NEW]: { values: [1, 0], model: GEMINI_EMBEDDING_MODEL } }
    );
    expect(r.tally).toMatchObject({ duplicate: 1, stored: 0, superseded: 0 });
    expect(r.newIds).toEqual([]);
    expect(r.store.get("old")?.status).toBe("active");
    expect(r.events.filter((e) => e.kind === "update" || e.kind === "set")).toEqual([]);
    expect(r.logs).toEqual([["[Memory] Suppressed duplicate memory", {
      memory_id: "same", memory_type: "project_fact", content_length: NEW.length, match: "exact_content", score: null
    }]]);
  });

  it("fix 3: a supersede that is only semantically close (cosine 1.0, other text) still supersedes", async () => {
    const r = await persist([activeDoc("old", OLD, [1, 0])], [cand(NEW, "supersede")], { [NEW]: { values: [1, 0], model: GEMINI_EMBEDDING_MODEL } });
    expect(r.tally).toMatchObject({ stored: 1, superseded: 1, duplicate: 0 });
  });

  it("fix 4: an exact duplicate embedded by another model is detected for create and supersede", async () => {
    for (const action of ["create", "supersede"]) {
      const r = await persist(
        [activeDoc("ollama_twin", NEW, [9, 9, 9], OLLAMA_EMBEDDING_MODEL)],
        [cand(NEW, action)],
        { [NEW]: { values: [1, 0], model: GEMINI_EMBEDDING_MODEL } }
      );
      expect(r.tally, action).toMatchObject({ duplicate: 1, stored: 0 });
      expect(r.newIds, action).toEqual([]);
    }
  });

  it("fix 4: cosine dedup still only compares vectors from the same model", async () => {
    const r = await persist(
      [activeDoc("ollama_near", "Barış moved CI to GitHub Actions.", [1, 0], OLLAMA_EMBEDDING_MODEL)],
      [cand(NEW, "create")],
      { [NEW]: { values: [1, 0], model: GEMINI_EMBEDDING_MODEL } }
    );
    expect(r.tally).toMatchObject({ stored: 1, duplicate: 0 });
  });

  it("fix 5: no log call contains memory text; ids, types and lengths are logged instead", async () => {
    const texts = {
      tea: "Barış likes tea with lemon.",
      teaShout: "barış LIKES tea   with Lemon.",
      teaNear: "Barış enjoys lemon tea.",
      coffee: "Barış drinks coffee.",
      forgetCoffee: "Forget that Barış drinks coffee.",
      secret: "password: hunter2hunter2",
      broken: "This one fails to embed."
    };
    const r = await persist(
      [activeDoc("coffee", texts.coffee, [0, 1], GEMINI_EMBEDDING_MODEL, "user_preference"), activeDoc("old", OLD, [1, 0])],
      [
        cand(texts.tea, "create", "user_preference"),
        cand(texts.teaNear, "create", "user_preference"), // cosine duplicate
        cand(` ${texts.teaShout} `, "create"), // exact duplicate once normalized
        cand(NEW, "supersede"),
        cand(texts.forgetCoffee, "forget"),
        cand(texts.secret, "create"),
        cand(texts.broken, "create")
      ],
      {
        [texts.tea]: { values: [1, 1], model: GEMINI_EMBEDDING_MODEL },
        [texts.teaNear]: { values: [1, 1.05], model: GEMINI_EMBEDDING_MODEL },
        [texts.teaShout]: { values: [5, -1], model: GEMINI_EMBEDDING_MODEL },
        [NEW]: { values: [1, 0.1], model: GEMINI_EMBEDDING_MODEL },
        [texts.forgetCoffee]: { values: [0, 1], model: GEMINI_EMBEDDING_MODEL }
      }
    );
    expect(r.tally).toMatchObject({ stored: 2, superseded: 1, duplicate: 2, retracted: 1, rejected: 1, failed: 1 });

    const all = [...Object.values(texts), NEW, OLD];
    for (const args of r.logs) {
      const line = JSON.stringify(args);
      for (const t of all) expect(line.includes(t), line).toBe(false);
    }
    const byMessage = (m: string) => r.logs.filter((l) => String(l[0]).startsWith(m)).map((l) => l[1]);
    const idOf = (content: string) => r.newIds.find((id) => r.store.get(id)!.content === content);
    const teaId = idOf(texts.tea);
    const newId = idOf(NEW);
    expect(byMessage("[Memory] Stored long-term memory in Firestore")).toEqual([
      { memory_id: teaId, memory_type: "user_preference", content_length: texts.tea.length },
      { memory_id: newId, memory_type: "project_fact", content_length: NEW.length }
    ]);
    expect(byMessage("[Memory] Suppressed duplicate memory")).toEqual([
      { memory_id: teaId, memory_type: "user_preference", content_length: texts.teaNear.length, match: "embedding", score: expect.any(Number) },
      { memory_id: teaId, memory_type: "project_fact", content_length: texts.teaShout.length, match: "exact_content", score: null }
    ]);
    expect(byMessage("[Memory] Retracted memory")).toEqual([
      { memory_id: "coffee", memory_type: "user_preference", content_length: texts.coffee.length }
    ]);
  });
});

describe("functions wiring", () => {
  const index = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");
  const extraction = readFileSync(new URL("../../functions/memory-extraction.js", import.meta.url), "utf8");
  const persistence = readFileSync(new URL("../../functions/memory-persistence.js", import.meta.url), "utf8");

  it("index.js delegates extraction to memory-extraction.js, which persists through memory-persistence.js and the shared tally", () => {
    expect(index).toContain('from "./memory-extraction.js"');
    expect(extraction).toContain('from "./memory-persistence.js"');
    expect(extraction).toMatch(/createMemoryWriteTally,[\s\S]*summarizeMemoryWriteTally[\s\S]*from "\.\.\/src\/alfred\/cognitive\/memory\/memory-write-planner\.js"/);
    expect(extraction).toContain("await persist({");
    for (const source of [index, extraction]) {
      expect(source).not.toContain('status: "retracted"');
      expect(source).not.toContain("score >= 0.85");
    }
  });

  it("memory-persistence.js runs the shared loop and builds records with the shared planner", () => {
    expect(persistence).toContain('from "../src/alfred/cognitive/memory/memory-write-planner.js"');
    expect(persistence).toContain("await runMemoryWriteLoop({");
    expect(persistence).not.toContain("planMemoryWrite(");
    expect(persistence).toContain("buildMemoryVectorRecord({");
    expect(persistence).toContain("db.batch()");
    expect(persistence).not.toMatch(/cosineSimilarity|isComparableEmbedding|0\.85|>= 0\.5/);
    expect(persistence).not.toMatch(/from "firebase-/);
    // Fix 5: memory text is never interpolated into a log line.
    expect(persistence).not.toMatch(/\$\{content\}|\.content\}/);
  });
});
