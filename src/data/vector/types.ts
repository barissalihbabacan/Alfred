/**
 * Vector Database Abstraction for B.U.T.L.E.R. Alfred
 *
 * Provides a minimal, leak-free contract for semantic vector indexing,
 * metadata filtering, and similarity retrieval.
 */

export interface VectorRecordMetadata {
  content: string;
  memoryType: string;
  status: "active" | "superseded" | "retracted";
  userId: string;
  sourceConversationId?: string;
  sourceMessageIds?: string[];
  embeddingProvider?: string;
  embeddingModel?: string;
  embeddingDimension?: number;
  /** ISO-8601 creation time of the underlying memory record. */
  createdAt?: string;
  [key: string]: unknown;
}

export interface VectorRecord {
  /** Vector index identifier */
  id: string;

  /** Canonical Alfred memory identifier */
  memoryId: string;

  /** User identity for strict isolation */
  userId: string;

  /** Normalized floating-point embedding vector */
  values: number[];

  /** Associated metadata for filtering and hydration */
  metadata: VectorRecordMetadata;
}

export interface VectorSearchOptions {
  /** User ID for mandatory user partitioning */
  userId: string;

  /** Maximum number of nearest neighbors to retrieve */
  topK?: number;

  /** Minimum similarity score threshold (0.0 to 1.0 for cosine similarity) */
  minScore?: number;

  /** Optional metadata filters */
  filter?: {
    memoryType?: string;
    status?: "active" | "superseded" | "retracted";
    /**
     * Only records whose metadata.embeddingModel equals this. Vectors from
     * different models do not share a space and must never be compared.
     */
    embeddingModel?: string;
  };
}

export interface VectorSearchResult {
  memoryId: string;
  vectorId: string;
  score: number;
  metadata: VectorRecordMetadata;
}

export interface IVectorStore {
  readonly storeId: string;

  /**
   * Inserts or updates a vector record in the index.
   */
  upsert(record: VectorRecord): Promise<void>;

  /**
   * Inserts or updates multiple vector records.
   */
  upsertBatch(records: VectorRecord[]): Promise<void>;

  /**
   * Searches for top-K nearest neighbors matching query embedding and filters.
   */
  search(queryEmbedding: number[], options: VectorSearchOptions): Promise<VectorSearchResult[]>;

  /**
   * Retrieves a record by vector ID.
   */
  get(vectorId: string): Promise<VectorRecord | null>;

  /**
   * Deletes a vector record by vector ID.
   */
  delete(vectorId: string): Promise<void>;

  /**
   * Deletes vector records associated with a given memory ID.
   */
  deleteByMemoryId(memoryId: string): Promise<void>;

  /**
   * Returns total count of indexed vectors.
   */
  count(): Promise<number>;

  /**
   * Clears all records from the vector store (used during complete re-indexing).
   */
  clear(): Promise<void>;
}
