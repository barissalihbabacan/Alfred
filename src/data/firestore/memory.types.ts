/**
 * Memory Vector Types for B.U.T.L.E.R. Alfred
 *
 * Definitive schemas for Firestore historical memory/vector records.
 */

export type MemoryType =
  | "user_preference"
  | "user_fact"
  | "project_fact"
  | "architectural_decision"
  | "technical_preference"
  | "constraint"
  | "relationship"
  | "workflow"
  | "general";

export type MemoryStatus = "active" | "superseded" | "retracted";

export type MemoryIndexStatus = "pending" | "indexed" | "failed";

export interface MemoryVectorDocument {
  /** Unique Firestore record identifier */
  id: string;

  /** Canonical Alfred memory identifier */
  memoryId: string;

  /** User identity for strict isolation */
  userId: string;

  /** Canonical semantic memory content */
  content: string;

  /** Category classification of memory */
  memoryType: MemoryType;

  /** Optional conversation origin */
  sourceConversationId?: string;

  /** Optional message origins */
  sourceMessageIds?: string[];

  /** Embedding provider used (e.g. 'ollama', 'mock') */
  embeddingProvider: string;

  /** Embedding model used (e.g. 'nomic-embed-text') */
  embeddingModel: string;

  /** Embedding dimensionality */
  embeddingDimension: number;

  /** Complete dense embedding vector stored authoritatively in Firestore */
  embedding?: number[];

  /** Vector database name (e.g. 'local-file', 'in-memory') */
  vectorStore: string;

  /** Vector record ID inside the vector store */
  vectorId: string;

  /** Domain lifecycle status */
  status: MemoryStatus;

  /** Optional ID of an older memory that this record replaces */
  supersedesMemoryId?: string;

  /** Optional ID of a newer memory that superseded this record */
  supersededByMemoryId?: string;

  /** Indexing pipeline lifecycle status */
  indexStatus: MemoryIndexStatus;

  /** Last indexing error message, if failed */
  lastError?: string;

  /** Creation timestamp (ISO string) */
  createdAt: string;

  /** Last update timestamp (ISO string) */
  updatedAt: string;

  /** When vector indexing succeeded (ISO string) */
  indexedAt?: string;
}

export interface CreateMemoryRecordParams {
  memoryId?: string;
  userId: string;
  content: string;
  memoryType?: MemoryType;
  sourceConversationId?: string;
  sourceMessageIds?: string[];
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimension: number;
  embedding?: number[];
  vectorStore: string;
  vectorId?: string;
  status?: MemoryStatus;
  supersedesMemoryId?: string;
  supersededByMemoryId?: string;
  indexStatus?: MemoryIndexStatus;
}

export interface UpdateMemoryIndexStatusParams {
  id: string;
  indexStatus: MemoryIndexStatus;
  indexedAt?: string;
  lastError?: string;
}

export interface UpdateMemoryStatusParams {
  id: string;
  status: MemoryStatus;
  supersededByMemoryId?: string;
}

export interface ListMemoriesOptions {
  userId: string;
  status?: MemoryStatus;
  indexStatus?: MemoryIndexStatus;
  memoryType?: MemoryType;
  limit?: number;
}
