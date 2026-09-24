/**
 * The per-candidate memory write loop, shared by production
 * (functions/memory-persistence.js, bundled into functions/lib/index.js) and
 * MemoryService.processConversationForMemories.
 *
 * For each raw candidate, in order:
 *
 * 1. validateMemoryCandidate (shape, content length, confidence >=
 *    `minConfidence`, action and memoryType normalized): invalid -> `invalid`.
 * 2. PrivacyFilter: a secret -> `rejected`.
 * 3. Embed the content, re-read the active memories (so earlier writes of this
 *    turn count) and ask planMemoryWrite what to do.
 * 4. forget: `retract` the target (or nothing on noMatch); an error in any
 *    step -> `failed`.
 *    create / supersede: skipDuplicate -> `duplicate`; otherwise `store` the
 *    new memory with the supersede target, if any -> `stored` (+ `superseded`);
 *    an error in any step -> `failed`.
 *
 * What stays with the caller is the storage layer, because the two stores
 * cannot do the same thing:
 *
 * - Production keeps the vector inside the Firestore record, so `store` can
 *   commit "old record superseded" + "new record" in one Firestore batch
 *   (both or neither) and the record is `indexed` as soon as it is written.
 * - MemoryService writes through IMemoryRepository and then indexes into a
 *   separate vector store (the rebuildable cache). A repository and a vector
 *   store cannot share a transaction, so its `store` writes (and indexes) the
 *   new record first and marks the old one only afterwards: a failure in
 *   between leaves both active (a recoverable duplicate), never the old fact
 *   lost. Its record goes `pending` -> `indexed` / `failed` with the index.
 *
 * Pure apart from the injected ports: no Firestore, no config/dotenv, no file
 * reads, no logging of its own (hooks carry the events; callers must not log
 * memory text).
 */
import {
  MEMORY_MIN_CONFIDENCE,
  validateMemoryCandidate,
  type ValidatedMemoryCandidate
} from "../../../ai/prompts/memory-extraction.js";
import type { EmbeddingResult } from "../../../ai/embedding/embedding-client.js";
import { PrivacyFilter } from "./privacy-filter.js";
import {
  planMemoryWrite,
  type ComparableMemoryRecord,
  type MemoryWritePlan,
  type MemoryWriteTally
} from "./memory-write-planner.js";

export type SkipDuplicatePlan<T> = Extract<MemoryWritePlan<T>, { kind: "skipDuplicate" }>;

export interface MemoryStoreRequest<T, E extends EmbeddingResult> {
  candidate: ValidatedMemoryCandidate;
  embedding: E;
  /** The memory to mark superseded by the new one, or null for a plain create. */
  supersedeTarget: T | null;
}

export interface MemoryWritePorts<T, E extends EmbeddingResult> {
  /** Embeds the candidate's validated content. */
  embed(content: string): Promise<E>;
  /** The user's active memories, in store order (re-read per candidate). */
  readActive(): Promise<readonly T[]>;
  /** The stored fields planMemoryWrite compares. */
  recordOf(memory: T): ComparableMemoryRecord;
  /** Marks `target` retracted (forget). */
  retract(target: T, candidate: ValidatedMemoryCandidate): Promise<void>;
  /** Writes the new memory and, for a supersede, marks the target superseded. */
  store(request: MemoryStoreRequest<T, E>): Promise<void>;
}

/** Optional notifications, for logging and result lists. */
export interface MemoryWriteHooks<T> {
  onInvalid?(raw: unknown): void;
  onRejected?(candidate: ValidatedMemoryCandidate, reason: string | undefined): void;
  onNoMatch?(candidate: ValidatedMemoryCandidate): void;
  onDuplicate?(candidate: ValidatedMemoryCandidate, plan: SkipDuplicatePlan<T>): void;
  onFailed?(candidate: ValidatedMemoryCandidate, error: unknown, stage: "forget" | "write"): void;
}

export interface RunMemoryWriteLoopInput<T, E extends EmbeddingResult> {
  /** Raw candidates from the extraction model (validated here, one by one). */
  candidates: readonly unknown[];
  ports: MemoryWritePorts<T, E>;
  hooks?: MemoryWriteHooks<T>;
  /** Updated in place (production reports it in the memory_extraction event). */
  tally: MemoryWriteTally;
  minConfidence?: number;
}

export async function runMemoryWriteLoop<T, E extends EmbeddingResult>({
  candidates,
  ports,
  hooks = {},
  tally,
  minConfidence = MEMORY_MIN_CONFIDENCE
}: RunMemoryWriteLoopInput<T, E>): Promise<void> {
  for (const raw of candidates) {
    const candidate = validateMemoryCandidate(raw, minConfidence);
    if (!candidate) {
      tally.invalid++;
      hooks.onInvalid?.(raw);
      continue;
    }
    const content = candidate.content;

    const privacy = PrivacyFilter.check(content);
    if (!privacy.isSafe) {
      hooks.onRejected?.(candidate, privacy.reason);
      tally.rejected++;
      continue;
    }

    if (candidate.action === "forget") {
      try {
        const embedding = await ports.embed(content);
        const active = await ports.readActive();
        const plan = planMemoryWrite({
          action: "forget",
          content,
          embedding,
          activeMemories: active,
          recordOf: ports.recordOf
        });
        if (plan.kind === "retract") {
          await ports.retract(plan.target, candidate);
          tally.retracted++;
        } else {
          hooks.onNoMatch?.(candidate);
        }
      } catch (err) {
        hooks.onFailed?.(candidate, err, "forget");
        tally.failed++;
      }
      continue;
    }

    try {
      const embedding = await ports.embed(content);
      const active = await ports.readActive();
      const plan = planMemoryWrite({
        action: candidate.action,
        content,
        embedding,
        activeMemories: active,
        recordOf: ports.recordOf
      });

      if (plan.kind === "skipDuplicate") {
        hooks.onDuplicate?.(candidate, plan);
        tally.duplicate++;
        continue;
      }

      const supersedeTarget = plan.kind === "supersede" ? plan.target : null;
      await ports.store({ candidate, embedding, supersedeTarget });
      tally.stored++;
      if (supersedeTarget) tally.superseded++;
    } catch (err) {
      hooks.onFailed?.(candidate, err, "write");
      tally.failed++;
    }
  }
}
