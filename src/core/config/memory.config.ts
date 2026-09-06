import dotenv from "dotenv";
import { DEFAULT_OLLAMA_BASE_URL } from "./ai.config.js";

dotenv.config();

export interface EmbeddingConfig {
  provider: string;
  model: string;
  dimension: number;
  baseUrl: string;
  timeoutMs: number;
}

export interface VectorStoreConfig {
  type: string;
  filePath: string;
}

export interface MemoryRetrievalConfig {
  enabled: boolean;
  topK: number;
  minScore: number;
  timeoutMs: number;
}

export interface MemoryExtractionConfig {
  enabled: boolean;
  minConfidence: number;
  maxContextMessages: number;
  model?: string;
  timeoutMs: number;
  deduplicationThreshold: number;
}

export interface MemorySystemConfig {
  embedding: EmbeddingConfig;
  vectorStore: VectorStoreConfig;
  retrieval: MemoryRetrievalConfig;
  extraction: MemoryExtractionConfig;
}

export const DEFAULT_EMBEDDING_PROVIDER = "ollama";
export const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
export const DEFAULT_EMBEDDING_DIMENSION = 768;
export const DEFAULT_VECTOR_STORE_PATH = ".data/vector_store.json";
export const DEFAULT_RETRIEVAL_TOP_K = 5;
export const DEFAULT_RETRIEVAL_MIN_SCORE = 0.65;
export const DEFAULT_RETRIEVAL_TIMEOUT_MS = 3000;

export const DEFAULT_EXTRACTION_ENABLED = true;
export const DEFAULT_EXTRACTION_MIN_CONFIDENCE = 0.75;
export const DEFAULT_EXTRACTION_MAX_MESSAGES = 6;
export const DEFAULT_EXTRACTION_TIMEOUT_MS = 15000;
export const DEFAULT_EXTRACTION_DEDUP_THRESHOLD = 0.85;

export function getMemoryConfig(): MemorySystemConfig {
  const provider = (process.env.EMBEDDING_PROVIDER || DEFAULT_EMBEDDING_PROVIDER).trim().toLowerCase();
  const model = (process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL).trim();
  const rawDim = process.env.EMBEDDING_DIMENSION ? parseInt(process.env.EMBEDDING_DIMENSION, 10) : DEFAULT_EMBEDDING_DIMENSION;
  const dimension = Number.isFinite(rawDim) && rawDim > 0 ? rawDim : DEFAULT_EMBEDDING_DIMENSION;
  const baseUrl = (process.env.EMBEDDING_BASE_URL || process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL).trim();

  const rawTimeout = process.env.EMBEDDING_TIMEOUT_MS ? parseInt(process.env.EMBEDDING_TIMEOUT_MS, 10) : 10000;
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 10000;

  const vectorStoreType = (process.env.VECTOR_STORE_TYPE || "local-file").trim().toLowerCase();
  const filePath = (process.env.VECTOR_STORE_PATH || DEFAULT_VECTOR_STORE_PATH).trim();

  const enabled = process.env.MEMORY_RETRIEVAL_ENABLED !== "false";
  const rawTopK = process.env.MEMORY_RETRIEVAL_TOP_K ? parseInt(process.env.MEMORY_RETRIEVAL_TOP_K, 10) : DEFAULT_RETRIEVAL_TOP_K;
  const topK = Number.isFinite(rawTopK) && rawTopK > 0 ? rawTopK : DEFAULT_RETRIEVAL_TOP_K;

  const rawMinScore = process.env.MEMORY_RETRIEVAL_MIN_SCORE ? parseFloat(process.env.MEMORY_RETRIEVAL_MIN_SCORE) : DEFAULT_RETRIEVAL_MIN_SCORE;
  const minScore = Number.isFinite(rawMinScore) && rawMinScore >= 0 && rawMinScore <= 1 ? rawMinScore : DEFAULT_RETRIEVAL_MIN_SCORE;

  const rawRetTimeout = process.env.MEMORY_RETRIEVAL_TIMEOUT_MS ? parseInt(process.env.MEMORY_RETRIEVAL_TIMEOUT_MS, 10) : DEFAULT_RETRIEVAL_TIMEOUT_MS;
  const retTimeoutMs = Number.isFinite(rawRetTimeout) && rawRetTimeout > 0 ? rawRetTimeout : DEFAULT_RETRIEVAL_TIMEOUT_MS;

  const extractionEnabled = process.env.MEMORY_EXTRACTION_ENABLED !== "false";
  const rawMinConf = process.env.MEMORY_EXTRACTION_MIN_CONFIDENCE ? parseFloat(process.env.MEMORY_EXTRACTION_MIN_CONFIDENCE) : DEFAULT_EXTRACTION_MIN_CONFIDENCE;
  const minConfidence = Number.isFinite(rawMinConf) && rawMinConf >= 0 && rawMinConf <= 1 ? rawMinConf : DEFAULT_EXTRACTION_MIN_CONFIDENCE;

  const rawMaxContext = process.env.MEMORY_EXTRACTION_MAX_MESSAGES ? parseInt(process.env.MEMORY_EXTRACTION_MAX_MESSAGES, 10) : DEFAULT_EXTRACTION_MAX_MESSAGES;
  const maxContextMessages = Number.isFinite(rawMaxContext) && rawMaxContext > 0 ? rawMaxContext : DEFAULT_EXTRACTION_MAX_MESSAGES;

  const extractionModel = process.env.MEMORY_EXTRACTION_MODEL?.trim() || undefined;

  const rawExtTimeout = process.env.MEMORY_EXTRACTION_TIMEOUT_MS ? parseInt(process.env.MEMORY_EXTRACTION_TIMEOUT_MS, 10) : DEFAULT_EXTRACTION_TIMEOUT_MS;
  const extTimeoutMs = Number.isFinite(rawExtTimeout) && rawExtTimeout > 0 ? rawExtTimeout : DEFAULT_EXTRACTION_TIMEOUT_MS;

  const rawDedup = process.env.MEMORY_EXTRACTION_DEDUP_THRESHOLD ? parseFloat(process.env.MEMORY_EXTRACTION_DEDUP_THRESHOLD) : DEFAULT_EXTRACTION_DEDUP_THRESHOLD;
  const deduplicationThreshold = Number.isFinite(rawDedup) && rawDedup >= 0 && rawDedup <= 1 ? rawDedup : DEFAULT_EXTRACTION_DEDUP_THRESHOLD;

  return {
    embedding: {
      provider,
      model,
      dimension,
      baseUrl,
      timeoutMs
    },
    vectorStore: {
      type: vectorStoreType,
      filePath
    },
    retrieval: {
      enabled,
      topK,
      minScore,
      timeoutMs: retTimeoutMs
    },
    extraction: {
      enabled: extractionEnabled,
      minConfidence,
      maxContextMessages,
      model: extractionModel,
      timeoutMs: extTimeoutMs,
      deduplicationThreshold
    }
  };
}
