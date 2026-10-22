/**
 * Memory write planner: the pure decision logic of the long-term memory
 * persistence pipeline, shared by production (functions/memory-persistence.js,
 * bundled into functions/lib/index.js by functions/build.js) and
 * MemoryService.processConversationForMemories.
 *
 * Deliberately free of I/O: no Firestore, no embedding calls, no logging, no
 * src/core/config (dotenv), no file reads. Callers read the active memories,
 * embed the candidate, ask `planMemoryWrite` what to do and perform the writes
 * themselves. Ids and timestamps are injected, so the record builders are pure.
 *
 * Rules (tests/unit/memory-write-planner.test.ts pins them, and proves them
 * equal to the former inline loop of functions/index.js wherever the fixes
 * listed under "History" do not apply):
 *
 * - forget: the *best* comparable active memory (highest cosine, the earliest
 *   one on ties, strictly above 0) is retracted when its score is >= 0.5.
 * - create and supersede: first an exact-content duplicate check against
 *   *every* active memory, whatever model embedded it (or whether it has an
 *   embedding at all): the candidate is skipped when an active memory has the
 *   same `normalizeMemoryContent` (trimmed, whitespace collapsed, lower-cased).
 *   The first such memory in snapshot order is reported.
 * - create: otherwise a duplicate as soon as *any* comparable active memory
 *   scores >= 0.85 (the first one in snapshot order is reported).
 * - supersede: otherwise the *best* comparable active memory scoring >= 0.5
 *   (highest cosine, the earliest in snapshot order on ties) is superseded;
 *   without such a target it is a plain create. There is deliberately no
 *   cosine dedup for supersede: a legitimate update ("moved from X to Y") can
 *   be semantically very close to the fact it replaces.
 *
 * History (fix-memory-persistence): supersede used to take the *first* match
 * >= 0.5 in snapshot order rather than the best, and neither supersede nor a
 * create whose near-twin was embedded by another model (Gemini -> Ollama
 * fallback turns) had any duplicate check.
 *
 * "Comparable" is `isComparableEmbedding`: a non-empty stored embedding made by
 * the same model as the candidate's. The active set is re-read for every
 * candidate, so a memory written, superseded or retracted earlier in the same
 * turn is (or is no longer) part of the next candidate's decision.
 */
import { cosineSimilarity } from "../../../data/vector/cosine-similarity.js";
import {
  GEMINI_EMBEDDING_MODEL,
  isComparableEmbedding,
  type EmbeddingResult
} from "../../../ai/embedding/embedding-client.js";
import type { MemoryType } from "../../../data/firestore/memory.types.js";

/** Minimum cosine for a forget to retract, or a supersede to replace, a memory. */
export const MEMORY_MATCH_THRESHOLD = 0.5;

/** Minimum cosine at which a create candidate duplicates an active memory. */
export const MEMORY_DUPLICATE_THRESHOLD = 0.85;

export type MemoryWriteAction = "create" | "forget" | "supersede";

/** The stored fields the planner reads from an active memory. */
export interface ComparableMemoryRecord {
  embedding?: unknown;
  embeddingModel?: unknown;
  /** Stored memory text, for the exact-content duplicate check. */
  content?: unknown;
}

/**
 * Canonical form for the exact-content duplicate check: trimmed, runs of
 * whitespace collapsed to one space, lower-cased. Deliberately not fuzzy.
 */
export function normalizeMemoryContent(content: string): string {
  return content.trim().replace(/\s+/g, " ").toLowerCase();
}

/** How a duplicate was detected. */
export type MemoryDuplicateMatch = "exact_content" | "embedding";

/**
 * What to do with one candidate. `T` is whatever the caller passed as an
 * active memory (a Firestore document snapshot, a repository record, ...).
 *
 * - `retract`: forget matched `target`; mark it retracted.
 * - `noMatch`: forget found nothing to retract; nothing to write.
 * - `skipDuplicate`: create or supersede duplicates `target`; nothing to
 *   write. `match` says how: `exact_content` (score is null; the target may
 *   not even have a comparable embedding) or `embedding` (create only).
 * - `supersede`: write the new memory and mark `target` superseded by it.
 * - `create`: write the new memory (also a supersede with no target).
 */
export type MemoryWritePlan<T> =
  | { kind: "retract"; target: T; score: number }
  | { kind: "noMatch" }
  | { kind: "skipDuplicate"; target: T; score: number | null; match: MemoryDuplicateMatch }
  | { kind: "supersede"; target: T; score: number }
  | { kind: "create" };

export interface PlanMemoryWriteInput<T> {
  action: MemoryWriteAction;
  /** The candidate's validated content, for the exact-content duplicate check. */
  content: string;
  /** The candidate's embedding. */
  embedding: EmbeddingResult;
  /** The user's active memories, in the order the store returned them. */
  activeMemories: readonly T[];
  /** Reads the stored fields of an active memory (called once per memory). */
  recordOf: (memory: T) => ComparableMemoryRecord;
}

export function planMemoryWrite<T>({
  action,
  content,
  embedding,
  activeMemories,
  recordOf
}: PlanMemoryWriteInput<T>): MemoryWritePlan<T> {
  const records = activeMemories.map((memory) => ({ memory, record: recordOf(memory) }));

  if (action === "forget") {
    const best = bestComparableMatch(records, embedding);
    if (best && best.score >= MEMORY_MATCH_THRESHOLD) {
      return { kind: "retract", target: best.memory, score: best.score };
    }
    return { kind: "noMatch" };
  }

  // Exact-content duplicate: every active memory, whatever embedded it.
  const normalized = normalizeMemoryContent(content);
  for (const { memory, record } of records) {
    if (typeof record.content === "string" && normalizeMemoryContent(record.content) === normalized) {
      return { kind: "skipDuplicate", target: memory, score: null, match: "exact_content" };
    }
  }

  if (action === "create") {
    for (const { memory, record } of records) {
      if (isComparableEmbedding(record, embedding.model)) {
        const score = cosineSimilarity(embedding.values, record.embedding as number[]);
        if (score >= MEMORY_DUPLICATE_THRESHOLD) {
          return { kind: "skipDuplicate", target: memory, score, match: "embedding" };
        }
      }
    }
    return { kind: "create" };
  }

  const best = bestComparableMatch(records, embedding);
  if (best && best.score >= MEMORY_MATCH_THRESHOLD) {
    return { kind: "supersede", target: best.memory, score: best.score };
  }
  return { kind: "create" };
}

/** Highest-cosine comparable memory (the earliest on ties, strictly above 0), or null. */
function bestComparableMatch<T>(
  records: ReadonlyArray<{ memory: T; record: ComparableMemoryRecord }>,
  embedding: EmbeddingResult
): { memory: T; score: number } | null {
  let best: { memory: T; score: number } | null = null;
  for (const { memory, record } of records) {
    if (isComparableEmbedding(record, embedding.model)) {
      const score = cosineSimilarity(embedding.values, record.embedding as number[]);
      if (score > (best ? best.score : 0)) {
        best = { memory, score };
      }
    }
  }
  return best;
}

/** `mem_<ms>_<6 base-36 chars>`, production's memory id format. */
export function generateMemoryId(
  nowMs: number = Date.now(),
  random: number = Math.random()
): string {
  return `mem_${nowMs}_${random.toString(36).slice(2, 8)}`;
}

/** Update that retracts a memory (forget). */
export function buildMemoryRetractionUpdate<TTime>(now: TTime): { status: "retracted"; updatedAt: TTime } {
  return { status: "retracted", updatedAt: now };
}

/** Update that marks a memory superseded by `newMemoryId`. */
export function buildMemorySupersessionUpdate<TTime>(
  newMemoryId: string,
  now: TTime
): { status: "superseded"; supersededByMemoryId: string; updatedAt: TTime } {
  return { status: "superseded", supersededByMemoryId: newMemoryId, updatedAt: now };
}

export interface MemoryVectorRecordInput<TTime> {
  memoryId: string;
  userId: string;
  content: string;
  memoryType: MemoryType;
  projectId?: string | null;
  sourceConversationId?: string | null;
  sourceMessageIds?: string[] | null;
  embedding: EmbeddingResult;
  /** Id of the memory this one supersedes, or null. */
  supersedesMemoryId: string | null;
  /** Server timestamp used for createdAt, updatedAt and indexedAt. */
  now: TTime;
}

/**
 * Production's `memory_vectors/{memoryId}` document (field set, order and
 * values). Production stores the embedding in Firestore itself, so the record
 * is written `indexed` against the `firestore` vector store.
 */
export function buildMemoryVectorRecord<TTime>(input: MemoryVectorRecordInput<TTime>) {
  const { memoryId, embedding, now } = input;
  return {
    memoryId,
    userId: input.userId,
    content: input.content,
    memoryType: input.memoryType,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    sourceConversationId: input.sourceConversationId,
    sourceMessageIds: input.sourceMessageIds || [],
    embeddingProvider: embedding.model === GEMINI_EMBEDDING_MODEL ? "gemini" : "ollama",
    embeddingModel: embedding.model,
    embeddingDimension: embedding.values.length,
    embedding: embedding.values,
    vectorStore: "firestore",
    vectorId: `vec_${memoryId}`,
    status: "active" as const,
    supersedesMemoryId: input.supersedesMemoryId,
    indexStatus: "indexed" as const,
    createdAt: now,
    updatedAt: now,
    indexedAt: now
  };
}

/**
 * Per-candidate outcome counters behind the `memory_extraction` log event.
 * rejected: secret filter; invalid: validateMemoryCandidate rejected it.
 */
export interface MemoryWriteTally {
  stored: number;
  superseded: number;
  retracted: number;
  duplicate: number;
  rejected: number;
  invalid: number;
  failed: number;
}

export function createMemoryWriteTally(): MemoryWriteTally {
  return { stored: 0, superseded: 0, retracted: 0, duplicate: 0, rejected: 0, invalid: 0, failed: 0 };
}

/**
 * The `memory_extraction` summary: the most significant outcome of the turn,
 * `fallbackOutcome` when no candidate reached a write, the stored + retracted
 * count, the extractor provider and every counter.
 */
export function summarizeMemoryWriteTally(
  tally: MemoryWriteTally,
  fallbackOutcome: string,
  extractorProvider: string | null
) {
  const outcome = tally.superseded ? "superseded"
    : tally.stored ? "stored"
      : tally.retracted ? "retracted"
        : tally.duplicate ? "duplicate"
          : tally.failed ? "failed"
            : fallbackOutcome;
  return {
    outcome,
    count: tally.stored + tally.retracted,
    extractor_provider: extractorProvider,
    ...tally
  };
}
