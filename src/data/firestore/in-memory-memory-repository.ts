import {
  IMemoryRepository,
  MEMORY_PERSISTENCE_CONFIG
} from "./memory-repository.interface.js";
import {
  MemoryVectorDocument,
  CreateMemoryRecordParams,
  UpdateMemoryIndexStatusParams,
  UpdateMemoryStatusParams,
  ListMemoriesOptions
} from "./memory.types.js";

export interface InMemoryMemoryRepositoryOptions {
  shouldFail?: boolean;
  failureMessage?: string;
}

/**
 * InMemoryMemoryRepository
 *
 * Fast, dependency-free memory repository for unit tests and local runs.
 */
export class InMemoryMemoryRepository implements IMemoryRepository {
  private records: Map<string, MemoryVectorDocument> = new Map();

  public shouldFail = false;
  public failureMessage = "Simulated Firestore memory repository failure";

  constructor(options?: InMemoryMemoryRepositoryOptions) {
    if (options?.shouldFail !== undefined) {
      this.shouldFail = options.shouldFail;
    }
    if (options?.failureMessage) {
      this.failureMessage = options.failureMessage;
    }
  }

  public async createMemoryRecord(params: CreateMemoryRecordParams): Promise<MemoryVectorDocument> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    if (!params.userId || !params.userId.trim()) {
      throw new Error("[InMemoryMemoryRepository] userId is required.");
    }
    if (!params.content || !params.content.trim()) {
      throw new Error("[InMemoryMemoryRepository] content cannot be empty.");
    }

    const now = new Date().toISOString();
    const id = params.memoryId || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const vectorId = params.vectorId || `vec_${id}`;

    const doc: MemoryVectorDocument = {
      id,
      memoryId: params.memoryId || id,
      userId: params.userId,
      content: params.content.trim(),
      memoryType: params.memoryType || "general",
      sourceConversationId: params.sourceConversationId,
      sourceMessageIds: params.sourceMessageIds,
      embeddingProvider: params.embeddingProvider,
      embeddingModel: params.embeddingModel,
      embeddingDimension: params.embeddingDimension,
      embedding: params.embedding,
      vectorStore: params.vectorStore,
      vectorId,
      status: params.status || "active",
      supersedesMemoryId: params.supersedesMemoryId,
      supersededByMemoryId: params.supersededByMemoryId,
      indexStatus: params.indexStatus || "pending",
      createdAt: now,
      updatedAt: now
    };

    this.records.set(doc.id, doc);
    return { ...doc };
  }

  public async getMemoryRecord(id: string): Promise<MemoryVectorDocument | null> {
    const doc = this.records.get(id);
    return doc ? { ...doc } : null;
  }

  public async getMemoryRecordByMemoryId(memoryId: string): Promise<MemoryVectorDocument | null> {
    for (const doc of this.records.values()) {
      if (doc.memoryId === memoryId) {
        return { ...doc };
      }
    }
    return null;
  }

  public async updateIndexStatus(params: UpdateMemoryIndexStatusParams): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const doc = this.records.get(params.id);
    if (!doc) {
      throw new Error(`[InMemoryMemoryRepository] Memory record not found: ${params.id}`);
    }

    doc.indexStatus = params.indexStatus;
    doc.updatedAt = new Date().toISOString();
    if (params.indexedAt) {
      doc.indexedAt = params.indexedAt;
    }
    if (params.lastError !== undefined) {
      doc.lastError = params.lastError;
    }
  }

  public async updateMemoryStatus(params: UpdateMemoryStatusParams): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const doc = this.records.get(params.id);
    if (!doc) {
      throw new Error(`[InMemoryMemoryRepository] Memory record not found: ${params.id}`);
    }

    doc.status = params.status;
    if (params.supersededByMemoryId) {
      doc.supersededByMemoryId = params.supersededByMemoryId;
    }
    doc.updatedAt = new Date().toISOString();
  }

  public async listMemories(options: ListMemoriesOptions): Promise<MemoryVectorDocument[]> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const { userId, status, indexStatus, memoryType, limit = MEMORY_PERSISTENCE_CONFIG.DEFAULT_LIST_LIMIT } = options;

    const results: MemoryVectorDocument[] = [];
    for (const doc of this.records.values()) {
      if (doc.userId !== userId) continue;
      if (status && doc.status !== status) continue;
      if (indexStatus && doc.indexStatus !== indexStatus) continue;
      if (memoryType && doc.memoryType !== memoryType) continue;

      results.push({ ...doc });
      if (results.length >= limit) break;
    }

    return results;
  }

  public async listAllActive(userId?: string): Promise<MemoryVectorDocument[]> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const results: MemoryVectorDocument[] = [];
    for (const doc of this.records.values()) {
      if (doc.status !== "active") continue;
      if (userId && doc.userId !== userId) continue;
      results.push({ ...doc });
    }
    return results;
  }

  public async deleteMemoryRecord(id: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    this.records.delete(id);
  }

  public clear(): void {
    this.records.clear();
  }
}
