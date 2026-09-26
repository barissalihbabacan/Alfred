import { IMemoryRepository } from "../../../data/firestore/memory-repository.interface.js";
import { getMemoryRepository } from "../../../data/firestore/memory-factory.js";
import { IVectorStore } from "../../../data/vector/types.js";
import { getVectorStore } from "../../../data/vector/factory.js";
import {
  IPendingEmbeddingStore,
  getPendingEmbeddingStore,
  cosineSimilarity
} from "../../../data/vector/index.js";
import { DetailedEmbedding, IEmbeddingProvider, embedWithModel } from "../../../ai/embedding/types.js";
import { isComparableEmbedding } from "../../../ai/embedding/embedding-client.js";
import { getEmbeddingProvider } from "../../../ai/embedding/factory.js";
import { MemorySystemConfig, getMemoryConfig } from "../../../core/config/index.js";
import {
  CreateMemoryInput,
  RetrievedMemory,
  SearchMemoriesOptions,
  ReindexResult,
  MemoryVectorDocument,
  MemoryType
} from "./types.js";
import {
  IMemoryExtractor,
  MemoryExtractionInput,
  ProcessedExtractionResult
} from "./extractor/types.js";
import { MemoryExtractor } from "./extractor/memory-extractor.js";
import { createMemoryWriteTally, generateMemoryId } from "./memory-write-planner.js";
import { runMemoryWriteLoop } from "./memory-write-loop.js";
import { parseMemoryConfidence } from "../../../ai/prompts/memory-extraction.js";
import { errorMessage } from "../../../core/errors/index.js";

export interface MemoryServiceOptions {
  memoryRepo?: IMemoryRepository;
  vectorStore?: IVectorStore;
  embeddingProvider?: IEmbeddingProvider;
  extractor?: IMemoryExtractor;
  pendingStore?: IPendingEmbeddingStore;
  config?: Partial<MemorySystemConfig>;
}

/**
 * MemoryService
 *
 * Orchestrates Alfred's long-term semantic memory pipeline:
 * 1. Generates dense embeddings for durable facts and preferences
 * 2. Temporarily stages embeddings locally before attempting persistence to Firestore
 * 3. Persists authoritative historical records (with complete embeddings) to Google Cloud Firestore
 * 4. Cleans up temporary local staging only after Firestore confirms successful write
 * 5. Upserts index entries into the local Vector Database
 * 6. Retrieves semantically relevant memories bounded by top-K and similarity thresholds
 * 7. Rebuilds the vector index entirely from Firestore on demand
 * 8. Autonomous extraction from conversations with deduplication and supersession
 */
export class MemoryService {
  private memoryRepo: IMemoryRepository;
  private vectorStore: IVectorStore;
  private embeddingProvider: IEmbeddingProvider;
  private extractor: IMemoryExtractor;
  private pendingStore: IPendingEmbeddingStore;
  private config: MemorySystemConfig;

  constructor(options?: MemoryServiceOptions) {
    this.config = {
      ...getMemoryConfig(),
      ...options?.config
    };
    this.memoryRepo = options?.memoryRepo || getMemoryRepository();
    this.vectorStore = options?.vectorStore || getVectorStore();
    this.embeddingProvider = options?.embeddingProvider || getEmbeddingProvider();
    this.extractor = options?.extractor || new MemoryExtractor({ config: this.config.extraction });
    this.pendingStore = options?.pendingStore || getPendingEmbeddingStore();
  }

  /**
   * Creates, persists, embeds, and indexes a new long-term memory record.
   *
   * Failure invariants:
   * - If embedding fails: No Firestore record or vector is created.
   * - If Firestore persistence fails: Vector index is not touched (no orphaned vectors).
   * - If vector indexing fails: Firestore record is preserved with indexStatus='failed'
   *   and lastError details so it can be safely re-indexed later.
   */
  public async createMemory(input: CreateMemoryInput): Promise<MemoryVectorDocument> {
    if (!input.userId || !input.userId.trim()) {
      throw new Error("[MemoryService] userId is required for tenant isolation.");
    }
    if (!input.content || !input.content.trim()) {
      throw new Error("[MemoryService] content cannot be empty.");
    }

    const startTime = Date.now();

    // 1. Generate Embedding (fail fast before any DB write). embedWithModel
    // records the model that really produced it (the Gemini -> Ollama
    // fallback may answer with Ollama).
    const embedding = await embedWithModel(this.embeddingProvider, input.content.trim());

    return this.persistEmbeddedMemory(input, embedding, startTime);
  }

  /**
   * Steps 2-6 of createMemory for content that has already been embedded
   * (the extraction pipeline embeds each candidate once, to plan its write).
   */
  private async persistEmbeddedMemory(
    input: CreateMemoryInput,
    embedded: DetailedEmbedding,
    startTime: number = Date.now()
  ): Promise<MemoryVectorDocument> {
    const embedding = embedded.values;
    // Provider, model and dimension of the vector itself, not of the
    // configured provider: they decide which vectors it is compared with.
    const embeddingProvider = embedded.provider;
    const embeddingModel = embedded.model;
    const embeddingDimension = embedding.length;
    const memoryId = input.memoryId || generateMemoryId();
    const vectorId = `vec_${memoryId}`;
    const cleanContent = input.content.trim();
    const memoryType: MemoryType = input.memoryType || "general";

    // 2. Persist to temporary local storage first (write-ahead durability)
    await this.pendingStore.savePending({
      memoryId,
      userId: input.userId,
      content: cleanContent,
      memoryType,
      embeddingProvider,
      embeddingModel,
      embeddingDimension,
      embedding,
      sourceConversationId: input.sourceConversationId,
      sourceMessageIds: input.sourceMessageIds,
      supersedesMemoryId: input.supersedesMemoryId,
      stagedAt: new Date().toISOString(),
      retryCount: 0
    });

    // 3. Persist authoritative historical record (with full embedding) to Firestore
    let record: MemoryVectorDocument;
    try {
      record = await this.memoryRepo.createMemoryRecord({
        memoryId,
        userId: input.userId,
        content: cleanContent,
        memoryType,
        sourceConversationId: input.sourceConversationId,
        sourceMessageIds: input.sourceMessageIds,
        embeddingProvider,
        embeddingModel,
        embeddingDimension,
        embedding,
        vectorStore: this.vectorStore.storeId,
        vectorId,
        status: "active",
        supersedesMemoryId: input.supersedesMemoryId,
        indexStatus: "pending"
      });
    } catch (fsErr) {
      // If Firestore persistence fails, retain staged record in pendingStore for retry/recovery
      console.error(`[MemoryService] Failed to persist memory ${memoryId} to Firestore; retained in local pending store:`, fsErr);
      throw fsErr;
    }

    // 4. Firestore confirmed: remove the corresponding temporary local embedding
    try {
      await this.pendingStore.removePending(memoryId);
    } catch (cleanupErr) {
      // Non-fatal: Firestore is source of truth and record is safely persisted there
      console.warn(`[MemoryService] Failed to remove staged pending embedding ${memoryId}:`, cleanupErr);
    }

    // 5. Upsert into Vector Database (secondary index)
    try {
      await this.vectorStore.upsert({
        id: vectorId,
        memoryId,
        userId: input.userId,
        values: embedding,
        metadata: {
          content: cleanContent,
          memoryType,
          status: "active",
          userId: input.userId,
          sourceConversationId: input.sourceConversationId,
          sourceMessageIds: input.sourceMessageIds,
          embeddingProvider,
          embeddingModel,
          embeddingDimension,
          createdAt: record.createdAt
        }
      });

      // 6. Mark Firestore record as indexed
      const indexedAt = new Date().toISOString();
      await this.memoryRepo.updateIndexStatus({
        id: record.id,
        indexStatus: "indexed",
        indexedAt
      });

      record.indexStatus = "indexed";
      record.indexedAt = indexedAt;

      const durationMs = Date.now() - startTime;
      console.log(`[MemoryService] Memory ${memoryId} (${memoryType}) indexed successfully in ${durationMs}ms`);
      return record;
    } catch (vecErr: unknown) {
      const errMsg = errorMessage(vecErr);
      console.error(`[MemoryService] Vector store indexing failed for memory ${memoryId}:`, errMsg);

      // Record indexing failure in Firestore for subsequent re-indexing
      await this.memoryRepo.updateIndexStatus({
        id: record.id,
        indexStatus: "failed",
        lastError: errMsg
      }).catch((updateErr) => {
        console.error(`[MemoryService] Failed to record indexing failure status in Firestore:`, updateErr);
      });

      record.indexStatus = "failed";
      record.lastError = errMsg;
      throw vecErr;
    }
  }

  /**
   * Retrieves semantically relevant memories matching user query.
   *
   * Invariants:
   * - Strict user isolation (cannot return another user's memories).
   * - Bounded execution timeout.
   * - Primary retrieval via Vector Store; fallback directly to Firestore active records
   *   with stored embeddings if Vector Store returns 0 results or fails.
   * - Returns empty array if both fail or time out (never crashes chat flow).
   */
  public async searchMemories(
    query: string,
    userId: string,
    options?: SearchMemoriesOptions
  ): Promise<RetrievedMemory[]> {
    if (!this.config.retrieval.enabled || !query || !query.trim() || !userId) {
      return [];
    }

    const startTime = Date.now();
    const timeoutMs = options?.timeoutMs ?? this.config.retrieval.timeoutMs;
    const topK = options?.topK ?? this.config.retrieval.topK;
    const minScore = options?.minScore ?? this.config.retrieval.minScore;

    const retrievalTask = async (): Promise<RetrievedMemory[]> => {
      // 1. Embed query (and learn which model answered)
      const embeddedQuery = await embedWithModel(this.embeddingProvider, query.trim());
      const queryEmbedding = embeddedQuery.values;

      // 2. Vector search with tenant isolation, active status filter and only
      // vectors from the query's model (different models never compare).
      const searchResults = await this.vectorStore.search(queryEmbedding, {
        userId,
        topK,
        minScore,
        filter: {
          status: "active",
          memoryType: options?.memoryType,
          embeddingModel: embeddedQuery.model
        }
      });

      // If vector store returned results, return mapped memories
      if (searchResults.length > 0) {
        return searchResults.map((r) => ({
          memoryId: r.memoryId,
          content: r.metadata.content,
          memoryType: (r.metadata.memoryType as MemoryType) || "general",
          score: Math.round(r.score * 1000) / 1000,
          createdAt: r.metadata.createdAt || new Date().toISOString(),
          sourceConversationId: r.metadata.sourceConversationId
        }));
      }

      // Fallback: If vector store returned 0 results (empty or out of sync),
      // compute cosine similarity directly against Firestore active records using stored embeddings.
      const activeRecords = await this.memoryRepo.listAllActive(userId);
      const fallbackResults: RetrievedMemory[] = [];

      for (const doc of activeRecords) {
        if (doc.status !== "active") continue;
        if (options?.memoryType && doc.memoryType !== options.memoryType) continue;
        if (!isComparableEmbedding(doc, embeddedQuery.model)) continue;

        const sim = cosineSimilarity(queryEmbedding, doc.embedding as number[]);
        if (sim >= minScore) {
          fallbackResults.push({
            memoryId: doc.memoryId,
            content: doc.content,
            memoryType: doc.memoryType,
            score: Math.round(sim * 1000) / 1000,
            createdAt: doc.createdAt,
            sourceConversationId: doc.sourceConversationId
          });
        }
      }

      fallbackResults.sort((a, b) => b.score - a.score);
      return fallbackResults.slice(0, topK);
    };

    // Bounded timeout guard
    try {
      const timeoutPromise = new Promise<RetrievedMemory[]>((_, reject) => {
        setTimeout(() => reject(new Error(`Memory retrieval timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      const memories = await Promise.race([retrievalTask(), timeoutPromise]);
      const durationMs = Date.now() - startTime;

      if (memories.length > 0) {
        console.log(
          `[MemoryService] Retrieved ${memories.length} relevant memories for user '${userId}' in ${durationMs}ms (scores: ${memories.map(m => m.score).join(", ")})`
        );
      }

      return memories;
    } catch (err: unknown) {
      console.warn(`[MemoryService] Semantic memory retrieval bypassed (${Date.now() - startTime}ms):`, errorMessage(err));
      // Fail open: chat continues normally without long-term memories
      return [];
    }
  }

  /**
   * Rebuilds the vector index entirely from Firestore historical records.
   *
   * Invariants:
   * - Authoritative source is Firestore.
   * - Uses existing embeddings stored in Firestore when available to avoid redundant model calls.
   * - Never deletes or mutates Firestore memory content.
   * - Removes the vectors of superseded / retracted memories first: retracting
   *   marks Firestore before deleting the vector, so a crash or a failed
   *   delete in between would otherwise keep a forgotten fact searchable.
   * - Idempotent and safe to run repeatedly.
   */
  public async reindexAll(userId?: string): Promise<ReindexResult> {
    console.log(`[MemoryService] Starting vector index rebuild from Firestore${userId ? ` for user ${userId}` : ""}...`);
    const activeRecords = await this.memoryRepo.listAllActive(userId);

    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ memoryId: string; error: string }> = [];

    let retiredRemoved = 0;
    for (const record of await this.memoryRepo.listAllInactive(userId)) {
      try {
        await this.vectorStore.deleteByMemoryId(record.memoryId);
        retiredRemoved++;
      } catch (err: unknown) {
        failed++;
        errors.push({ memoryId: record.memoryId, error: `Removing retired vector failed: ${errorMessage(err)}` });
      }
    }

    for (const record of activeRecords) {
      try {
        // Reuse the stored vector under its stored model; otherwise re-embed and
        // index under the model that actually answered.
        const embedded: DetailedEmbedding = (record.embedding && Array.isArray(record.embedding) && record.embedding.length > 0)
          ? { values: record.embedding, model: record.embeddingModel, provider: record.embeddingProvider }
          : await embedWithModel(this.embeddingProvider, record.content);
        const embedding = embedded.values;
        const vectorId = record.vectorId || `vec_${record.memoryId}`;

        await this.vectorStore.upsert({
          id: vectorId,
          memoryId: record.memoryId,
          userId: record.userId,
          values: embedding,
          metadata: {
            content: record.content,
            memoryType: record.memoryType,
            status: record.status,
            userId: record.userId,
            sourceConversationId: record.sourceConversationId,
            sourceMessageIds: record.sourceMessageIds,
            embeddingProvider: embedded.provider,
            embeddingModel: embedded.model,
            embeddingDimension: embedding.length,
            createdAt: record.createdAt
          }
        });

        await this.memoryRepo.updateIndexStatus({
          id: record.id,
          indexStatus: "indexed",
          indexedAt: new Date().toISOString()
        });

        succeeded++;
      } catch (err: unknown) {
        failed++;
        const errorMsg = errorMessage(err);
        errors.push({ memoryId: record.memoryId, error: errorMsg });
        console.error(`[MemoryService] Reindex failed for memory ${record.memoryId}:`, errorMsg);

        await this.memoryRepo.updateIndexStatus({
          id: record.id,
          indexStatus: "failed",
          lastError: errorMsg
        }).catch(() => {});
      }
    }

    const summary: ReindexResult = {
      total: activeRecords.length,
      succeeded,
      failed,
      errors,
      retiredRemoved
    };

    console.log(
      `[MemoryService] Reindex completed: ${succeeded}/${activeRecords.length} succeeded, ${failed} failed.`
    );
    return summary;
  }

  /**
   * Retries persisting any locally staged pending embeddings to Firestore.
   *
   * Invariants:
   * - Idempotent: Checks if the record already exists in Firestore before attempting write.
   * - Once Firestore confirmed, removes the temporary local pending embedding.
   * - Syncs vector store secondary index.
   * - Returns detailed report of processed, succeeded, failed items.
   */
  public async retryPendingEmbeddings(userId?: string): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
    errors: Array<{ memoryId: string; error: string }>;
  }> {
    const pendingList = await this.pendingStore.listPending(userId);
    let succeeded = 0;
    let failed = 0;
    const errors: Array<{ memoryId: string; error: string }> = [];

    for (const item of pendingList) {
      try {
        // 1. Check if record already exists in Firestore (idempotent guard)
        let record = await this.memoryRepo.getMemoryRecordByMemoryId(item.memoryId);

        if (!record) {
          record = await this.memoryRepo.createMemoryRecord({
            memoryId: item.memoryId,
            userId: item.userId,
            content: item.content,
            memoryType: item.memoryType,
            sourceConversationId: item.sourceConversationId,
            sourceMessageIds: item.sourceMessageIds,
            embeddingProvider: item.embeddingProvider,
            embeddingModel: item.embeddingModel,
            embeddingDimension: item.embeddingDimension,
            embedding: item.embedding,
            vectorStore: this.vectorStore.storeId,
            vectorId: `vec_${item.memoryId}`,
            status: "active",
            supersedesMemoryId: item.supersedesMemoryId,
            indexStatus: "pending"
          });
        }

        // 2. Remove from temporary pending store now that Firestore has confirmed receipt
        await this.pendingStore.removePending(item.memoryId).catch((cleanupErr) => {
          console.warn(`[MemoryService] Failed to remove staged embedding during retry for ${item.memoryId}:`, cleanupErr);
        });

        // 3. Upsert into secondary Vector Store
        try {
          await this.vectorStore.upsert({
            id: record.vectorId || `vec_${record.memoryId}`,
            memoryId: record.memoryId,
            userId: record.userId,
            values: item.embedding,
            metadata: {
              content: record.content,
              memoryType: record.memoryType,
              status: record.status,
              userId: record.userId,
              sourceConversationId: record.sourceConversationId,
              sourceMessageIds: record.sourceMessageIds,
              embeddingProvider: item.embeddingProvider,
              embeddingModel: item.embeddingModel,
              embeddingDimension: item.embeddingDimension,
              createdAt: record.createdAt
            }
          });

          await this.memoryRepo.updateIndexStatus({
            id: record.id,
            indexStatus: "indexed",
            indexedAt: new Date().toISOString()
          });
        } catch (vecErr: unknown) {
          console.warn(`[MemoryService] Vector upsert failed during retry for ${record.memoryId}:`, errorMessage(vecErr));
        }

        succeeded++;
      } catch (err: unknown) {
        failed++;
        const errMsg = errorMessage(err);
        errors.push({ memoryId: item.memoryId, error: errMsg });
        console.error(`[MemoryService] Retry failed for pending embedding ${item.memoryId}:`, errMsg);
      }
    }

    return {
      processed: pendingList.length,
      succeeded,
      failed,
      errors
    };
  }

  /**
   * Retracts a memory (soft-delete in Firestore, removed from vector store).
   */
  public async retractMemory(memoryId: string, userId: string): Promise<void> {
    const record = await this.memoryRepo.getMemoryRecordByMemoryId(memoryId);
    if (!record) {
      throw new Error(`[MemoryService] Memory not found: ${memoryId}`);
    }

    if (record.userId !== userId) {
      throw new Error(`[MemoryService] Forbidden: Memory belongs to another user.`);
    }

    // 1. Mark status retracted in Firestore
    await this.memoryRepo.updateMemoryStatus({
      id: record.id,
      status: "retracted"
    });

    // 2. Remove from vector index
    await this.vectorStore.deleteByMemoryId(memoryId);
    console.log(`[MemoryService] Retracted memory ${memoryId} for user ${userId}`);
  }

  /**
   * Marks an existing memory as superseded by a newer memory.
   * Updates Firestore status to 'superseded' and removes from active vector index.
   */
  public async supersedeMemory(oldMemoryId: string, userId: string, newMemoryId?: string): Promise<void> {
    const record = await this.memoryRepo.getMemoryRecordByMemoryId(oldMemoryId);
    if (!record) {
      throw new Error(`[MemoryService] Memory not found: ${oldMemoryId}`);
    }

    if (record.userId !== userId) {
      throw new Error(`[MemoryService] Forbidden: Memory belongs to another user.`);
    }

    await this.memoryRepo.updateMemoryStatus({
      id: record.id,
      status: "superseded",
      supersededByMemoryId: newMemoryId
    });

    await this.vectorStore.deleteByMemoryId(oldMemoryId);
    console.log(`[MemoryService] Marked memory ${oldMemoryId} as superseded`);
  }

  /**
   * Autonomous memory extraction and indexing pipeline.
   *
   * 1. Extracts candidate memories from the bounded conversation context
   *    (MemoryExtractor: the extraction pipeline shared with production).
   * 2. Runs production's per-candidate write loop (memory-write-loop.ts):
   *    validation (confidence >= the configured minimum), the privacy filter,
   *    embedding, a fresh read of the user's active repository records and the
   *    shared planMemoryWrite decision: forget retracts the best match >= 0.5;
   *    create and supersede are skipped when an active memory has the same
   *    normalized content (any embedding model); create is also skipped when
   *    any comparable match is >= 0.85; supersede replaces the best match
   *    >= 0.5 (earliest in repository order on ties), preserving lineage.
   * 3. Only the storage layer is MemoryService's own: the Firestore record
   *    through IMemoryRepository, then the vector-store index (see `store`
   *    below for why a supersede is ordered rather than atomic here).
   *
   * Logs carry ids, types and lengths, never memory text (as in production).
   */
  public async processConversationForMemories(
    input: MemoryExtractionInput
  ): Promise<ProcessedExtractionResult> {
    const result: ProcessedExtractionResult = {
      created: [],
      superseded: [],
      retracted: [],
      skippedDuplicates: [],
      rejected: [],
      tally: createMemoryWriteTally()
    };

    if (!this.config.extraction.enabled) {
      return result;
    }

    const startTime = Date.now();
    let extractionResult;
    try {
      extractionResult = await this.extractor.extract(input);
    } catch (err: unknown) {
      console.warn("[MemoryService] Extraction error during conversation processing:", errorMessage(err));
      return result;
    }

    if (!extractionResult.shouldRemember || extractionResult.candidates.length === 0) {
      return result;
    }

    const minConfidence = this.config.extraction.minConfidence;

    await runMemoryWriteLoop<MemoryVectorDocument, DetailedEmbedding>({
      candidates: extractionResult.candidates,
      tally: result.tally,
      minConfidence,
      ports: {
        embed: (content) => embedWithModel(this.embeddingProvider, content),
        // The repository (the source of truth), not the vector store.
        readActive: () => this.memoryRepo.listAllActive(input.userId),
        recordOf: (record) => record,

        retract: async (target) => {
          await this.retractMemory(target.memoryId, input.userId);
          result.retracted.push(target.memoryId);
        },

        store: async ({ candidate, embedding, supersedeTarget }) => {
          // Supersede ordering: the repository and the vector store cannot
          // share a transaction, so the new memory is written (and indexed)
          // first and the old one is marked superseded only afterwards. A
          // failure in between leaves both active (a recoverable duplicate),
          // never the old fact lost. Production commits both in one batch.
          const newRecord = await this.persistEmbeddedMemory({
            content: candidate.content,
            userId: input.userId,
            memoryType: candidate.memoryType,
            sourceConversationId: input.conversationId,
            sourceMessageIds: input.sourceMessageIds,
            supersedesMemoryId: supersedeTarget?.memoryId
          }, embedding);
          result.created.push(newRecord);

          if (supersedeTarget) {
            await this.memoryRepo.updateMemoryStatus({
              id: supersedeTarget.id,
              status: "superseded",
              supersededByMemoryId: newRecord.memoryId
            });
            await this.vectorStore.deleteByMemoryId(supersedeTarget.memoryId);
            result.superseded.push({ oldMemoryId: supersedeTarget.memoryId, newMemoryId: newRecord.memoryId });
            console.log(`[MemoryService] Superseded memory ${supersedeTarget.memoryId} with ${newRecord.memoryId}`);
          }
        }
      },
      hooks: {
        onInvalid: (raw) => {
          const item = (raw && typeof raw === "object" ? raw : {}) as { content?: unknown; confidence?: unknown };
          const content = typeof item.content === "string" ? item.content : "";
          const confidence = parseMemoryConfidence(item.confidence);
          result.rejected.push({
            content,
            reason: confidence !== null && confidence < minConfidence
              ? `Confidence ${confidence} below threshold ${minConfidence}`
              : "Invalid candidate (shape, content or confidence)"
          });
        },
        onRejected: (candidate, reason) => {
          result.rejected.push({ content: candidate.content, reason: reason || "Violates privacy policy" });
          console.warn(`[MemoryService] Candidate rejected due to sensitive data policy (${candidate.memoryType}).`);
        },
        onDuplicate: (candidate, plan) => {
          result.skippedDuplicates.push(candidate.content);
          console.log(
            `[MemoryService] Suppressed duplicate candidate (${candidate.memoryType}, ${candidate.content.length} chars): matches ${plan.target.memoryId} (${plan.match}${plan.score === null ? "" : ` score ${plan.score}`})`
          );
        },
        onFailed: (candidate, err, stage) => {
          console.error(`[MemoryService] Memory ${stage === "forget" ? "retraction" : candidate.action} pipeline error:`, errorMessage(err));
        }
      }
    });

    const durationMs = Date.now() - startTime;
    console.log(
      `[MemoryService] Autonomous memory extraction processed in ${durationMs}ms: ${result.created.length} created, ${result.superseded.length} superseded, ${result.retracted.length} retracted, ${result.skippedDuplicates.length} duplicates skipped`
    );

    return result;
  }
}

let cachedMemoryService: MemoryService | null = null;

export function getMemoryService(): MemoryService {
  if (cachedMemoryService) {
    return cachedMemoryService;
  }
  cachedMemoryService = new MemoryService();
  return cachedMemoryService;
}

export function setMemoryService(service: MemoryService | null): void {
  cachedMemoryService = service;
}
