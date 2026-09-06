import { IVectorStore } from "./types.js";
import { LocalFileVectorStore } from "./local-file-vector-store.js";
import { InMemoryVectorStore } from "./in-memory-vector-store.js";
import { getMemoryConfig } from "../../core/config/index.js";

let cachedStore: IVectorStore | null = null;

/**
 * Returns the active vector store singleton based on environment configuration.
 */
export function getVectorStore(): IVectorStore {
  if (cachedStore) {
    return cachedStore;
  }

  // During Vitest unit tests, default to InMemoryVectorStore unless live file is requested
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    if (process.env.USE_LIVE_VECTOR_FILE_IN_TESTS !== "true") {
      cachedStore = new InMemoryVectorStore();
      return cachedStore;
    }
  }

  const config = getMemoryConfig().vectorStore;

  if (config.type === "in-memory") {
    cachedStore = new InMemoryVectorStore();
    return cachedStore;
  }

  cachedStore = new LocalFileVectorStore({
    filePath: config.filePath
  });
  return cachedStore;
}

/**
 * Overrides the active vector store (primarily for unit tests).
 */
export function setVectorStore(store: IVectorStore | null): void {
  cachedStore = store;
}
