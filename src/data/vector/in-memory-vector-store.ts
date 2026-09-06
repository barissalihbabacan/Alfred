import {
  IVectorStore,
  VectorRecord,
  VectorSearchOptions,
  VectorSearchResult
} from "./types.js";
import { cosineSimilarity } from "./cosine-similarity.js";

export interface InMemoryVectorStoreOptions {
  shouldFail?: boolean;
  failureMessage?: string;
}

/**
 * InMemoryVectorStore
 *
 * Fast, dependency-free vector store for unit tests and ephemeral runtime testing.
 */
export class InMemoryVectorStore implements IVectorStore {
  public readonly storeId: string = "in-memory";
  protected records: Map<string, VectorRecord> = new Map();

  public shouldFail = false;
  public failureMessage = "Simulated vector store failure";

  constructor(options?: InMemoryVectorStoreOptions) {
    if (options?.shouldFail !== undefined) {
      this.shouldFail = options.shouldFail;
    }
    if (options?.failureMessage) {
      this.failureMessage = options.failureMessage;
    }
  }

  public async upsert(record: VectorRecord): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    this.records.set(record.id, { ...record });
  }

  public async upsertBatch(records: VectorRecord[]): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    for (const record of records) {
      this.records.set(record.id, { ...record });
    }
  }

  public async search(
    queryEmbedding: number[],
    options: VectorSearchOptions
  ): Promise<VectorSearchResult[]> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    const { userId, topK = 5, minScore = 0, filter } = options;

    if (!userId) {
      throw new Error("[VectorStore] Search requires a valid userId for tenant partitioning.");
    }

    const candidates: VectorSearchResult[] = [];

    for (const record of this.records.values()) {
      // 1. Strict user partitioning
      if (record.userId !== userId) {
        continue;
      }

      // 2. Metadata filtering
      if (filter) {
        if (filter.status && record.metadata.status !== filter.status) {
          continue;
        }
        if (filter.memoryType && record.metadata.memoryType !== filter.memoryType) {
          continue;
        }
      }

      // 3. Compute cosine similarity score
      const score = cosineSimilarity(queryEmbedding, record.values);

      // 4. Threshold filtering
      if (score >= minScore) {
        candidates.push({
          memoryId: record.memoryId,
          vectorId: record.id,
          score,
          metadata: { ...record.metadata }
        });
      }
    }

    // 5. Sort descending by similarity score
    candidates.sort((a, b) => b.score - a.score);

    // 6. Top-K truncation
    return candidates.slice(0, topK);
  }

  public async get(vectorId: string): Promise<VectorRecord | null> {
    const record = this.records.get(vectorId);
    return record ? { ...record } : null;
  }

  public async delete(vectorId: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    this.records.delete(vectorId);
  }

  public async deleteByMemoryId(memoryId: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    for (const [id, record] of this.records.entries()) {
      if (record.memoryId === memoryId) {
        this.records.delete(id);
      }
    }
  }

  public async count(): Promise<number> {
    return this.records.size;
  }

  public async clear(): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    this.records.clear();
  }
}
