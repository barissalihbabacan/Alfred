import { MemoryType } from "../firestore/memory.types.js";

/**
 * Temporary local record staged during write-ahead embedding persistence.
 */
export interface PendingEmbeddingRecord {
  memoryId: string;
  userId: string;
  content: string;
  memoryType: MemoryType;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimension: number;
  embedding: number[];
  sourceConversationId?: string;
  sourceMessageIds?: string[];
  supersedesMemoryId?: string;
  stagedAt: string;
  retryCount: number;
  lastError?: string;
}

/**
 * IPendingEmbeddingStore
 *
 * Contract for temporary, durable local staging of generated embeddings.
 * Embeddings are written here BEFORE attempting persistence to Firestore.
 * Once Firestore confirms successful storage, records are purged from here.
 * If Firestore fails, records are retained for retry/recovery.
 */
export interface IPendingEmbeddingStore {
  savePending(record: PendingEmbeddingRecord): Promise<void>;
  removePending(memoryId: string): Promise<void>;
  getPending(memoryId: string): Promise<PendingEmbeddingRecord | null>;
  listPending(userId?: string): Promise<PendingEmbeddingRecord[]>;
  count(userId?: string): Promise<number>;
  clear(): Promise<void>;
}
