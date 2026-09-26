import {
  MemoryType,
  MemoryStatus,
  MemoryIndexStatus,
  MemoryVectorDocument
} from "../../../data/firestore/memory.types.js";

export type { MemoryType, MemoryStatus, MemoryIndexStatus, MemoryVectorDocument };

export interface CreateMemoryInput {
  content: string;
  userId: string;
  memoryType?: MemoryType;
  sourceConversationId?: string;
  sourceMessageIds?: string[];
  memoryId?: string;
  supersedesMemoryId?: string;
}

export interface RetrievedMemory {
  memoryId: string;
  content: string;
  memoryType: MemoryType;
  score: number;
  createdAt: string;
  sourceConversationId?: string;
}

export interface SearchMemoriesOptions {
  topK?: number;
  minScore?: number;
  memoryType?: MemoryType;
  timeoutMs?: number;
}

export interface ReindexResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: Array<{ memoryId: string; error: string }>;
  /** Superseded / retracted memories whose vectors were removed (a no-op when none was left). */
  retiredRemoved: number;
}
