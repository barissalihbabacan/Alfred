import {
  MemoryVectorDocument,
  CreateMemoryRecordParams,
  UpdateMemoryIndexStatusParams,
  UpdateMemoryStatusParams,
  ListMemoriesOptions
} from "./memory.types.js";

/**
 * Standard configuration limits for memory persistence.
 */
export const MEMORY_PERSISTENCE_CONFIG = {
  COLLECTION_NAME: "memory_vectors",
  MAX_CONTENT_LENGTH: 10000,
  DEFAULT_LIST_LIMIT: 50
} as const;

/**
 * IMemoryRepository
 *
 * Clean contract isolating Firestore memory persistence from business logic.
 * Ensures the vector database remains completely rebuildable from Firestore.
 */
export interface IMemoryRepository {
  /**
   * Persists a canonical memory record to the historical collection.
   */
  createMemoryRecord(params: CreateMemoryRecordParams): Promise<MemoryVectorDocument>;

  /**
   * Retrieves a memory record by its document ID.
   */
  getMemoryRecord(id: string): Promise<MemoryVectorDocument | null>;

  /**
   * Retrieves a memory record by its domain memoryId.
   */
  getMemoryRecordByMemoryId(memoryId: string): Promise<MemoryVectorDocument | null>;

  /**
   * Updates indexing status and timestamps (e.g. indexed or failed).
   */
  updateIndexStatus(params: UpdateMemoryIndexStatusParams): Promise<void>;

  /**
   * Updates domain status (e.g. active, superseded, retracted).
   */
  updateMemoryStatus(params: UpdateMemoryStatusParams): Promise<void>;

  /**
   * Lists memories for a specific user with optional status and category filtering.
   */
  listMemories(options: ListMemoriesOptions): Promise<MemoryVectorDocument[]>;

  /**
   * Lists all active memories for rebuilding the vector index.
   * If userId is omitted, retrieves active memories across all users (for system-wide rebuild).
   */
  listAllActive(userId?: string): Promise<MemoryVectorDocument[]>;

  /**
   * Lists all superseded and retracted memories (all users when userId is
   * omitted), so a rebuild can remove vectors a failed delete left behind.
   */
  listAllInactive(userId?: string): Promise<MemoryVectorDocument[]>;

  /**
   * Deletes a memory record (used primarily in cleanup or testing).
   */
  deleteMemoryRecord(id: string): Promise<void>;
}
