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
 * The semantics are production's, byte for byte (pinned by
 * tests/unit/memory-write-planner.test.ts against a verbatim copy of the
 * former inline loop in functions/index.js):
 *
 * - forget: the *best* comparable active memory (highest cosine, the earliest
 *   one on ties, strictly above 0) is retracted when its score is >= 0.5.
 * - create: the candidate is a duplicate as soon as *any* comparable active
 *   memory scores >= 0.85 (the first one in snapshot order is reported).
 * - supersede: the *first* comparable active memory in snapshot order that
 *   scores >= 0.5 is superseded (not the best one). A supersede candidate is
 *   never checked for duplicates, and without a target it is a plain create.
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
}

/**
 * What to do with one candidate. `T` is whatever the caller passed as an
 * active memory (a Firestore document snapshot, a repository record, ...).
 *
 * - `retract`: forget matched `target`; mark it retracted.
 * - `noMatch`: forget found nothing to retract; nothing to write.
 * - `skipDuplicate`: create duplicates `target`; nothing to write.
 * - `supersede`: write the new memory and mark `target` superseded by it.
 * - `create`: write the new memory (also a supersede with no target).
 */
export type MemoryWritePlan<T> =
  | { kind: "retract"; target: T; score: number }
  | { kind: "noMatch" }
  | { kind: "skipDuplicate"; target: T; score: number }
  | { kind: "supersede"; target: T; score: number }
  | { kind: "create" };

export interface PlanMemoryWriteInput<T> {
  action: MemoryWriteAction;
  /** The candidate's embedding. */
  embedding: EmbeddingResult;
  /** The user's active memories, in the order the store returned them. */
  activeMemories: readonly T[];
  /** Reads the stored fields of an active memory (called once per memory). */
  recordOf: (memory: T) => ComparableMemoryRecord;
}

export function planMemoryWrite<T>({
  action,
  embedding,
  activeMemories,
  recordOf
}: PlanMemoryWriteInput<T>): MemoryWritePlan<T> {
  if (action === "forget") {
    let bestMatch: T | null = null;
    let bestScore = 0;
    for (const memory of activeMemories) {
      const record = recordOf(memory);
      if (isComparableEmbedding(record, embedding.model)) {
        const score = cosineSimilarity(embedding.values, record.embedding as number[]);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = memory;
        }
      }
    }
    if (bestMatch !== null && bestScore >= MEMORY_MATCH_THRESHOLD) {
      return { kind: "retract", target: bestMatch, score: bestScore };
    }
    return { kind: "noMatch" };
  }

  let supersedeTarget: { memory: T; score: number } | null = null;
  for (const memory of activeMemories) {
    const record = recordOf(memory);
    if (isComparableEmbedding(record, embedding.model)) {
      const score = cosineSimilarity(embedding.values, record.embedding as number[]);
      if (action === "create" && score >= MEMORY_DUPLICATE_THRESHOLD) {
        return { kind: "skipDuplicate", target: memory, score };
      }
      if (action === "supersede" && score >= MEMORY_MATCH_THRESHOLD && !supersedeTarget) {
        supersedeTarget = { memory, score };
      }
    }
  }

  if (action === "supersede" && supersedeTarget) {
    return { kind: "supersede", target: supersedeTarget.memory, score: supersedeTarget.score };
  }
  return { kind: "create" };
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
