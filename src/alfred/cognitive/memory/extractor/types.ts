import { MemoryType, MemoryVectorDocument } from "../../../../data/firestore/memory.types.js";

export type MemoryExtractionAction = "create" | "forget" | "supersede";

export interface ExtractedMemoryCandidate {
  content: string;
  memoryType: MemoryType;
  confidence: number;
  action: MemoryExtractionAction;
  subject?: string;
  reasoning?: string;
}

export interface MemoryExtractionInput {
  currentMessage: string;
  userId: string;
  userName?: string;
  conversationId?: string;
  recentMessages?: Array<{ role: string; content: string }>;
  assistantResponse?: string;
  sourceMessageIds?: string[];
}

export interface MemoryExtractionResult {
  shouldRemember: boolean;
  candidates: ExtractedMemoryCandidate[];
  rawResponse?: string;
}

export interface IMemoryExtractor {
  extract(input: MemoryExtractionInput): Promise<MemoryExtractionResult>;
}

export interface ProcessedExtractionResult {
  created: MemoryVectorDocument[];
  superseded: Array<{ oldMemoryId: string; newMemoryId: string }>;
  retracted: string[];
  skippedDuplicates: string[];
  rejected: Array<{ content: string; reason: string }>;
}
