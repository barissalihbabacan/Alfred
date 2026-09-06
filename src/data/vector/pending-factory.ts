import { IPendingEmbeddingStore } from "./pending-embedding-store.interface.js";
import { LocalFilePendingEmbeddingStore } from "./local-file-pending-embedding-store.js";
import { InMemoryPendingEmbeddingStore } from "./in-memory-pending-embedding-store.js";

let cachedPendingStore: IPendingEmbeddingStore | null = null;

/**
 * Returns the active pending embedding store singleton.
 */
export function getPendingEmbeddingStore(): IPendingEmbeddingStore {
  if (cachedPendingStore) {
    return cachedPendingStore;
  }

  // During tests, default to InMemoryPendingEmbeddingStore
  if (process.env.VITEST || process.env.NODE_ENV === "test") {
    if (process.env.USE_LIVE_PENDING_STORE_IN_TESTS !== "true") {
      cachedPendingStore = new InMemoryPendingEmbeddingStore();
      return cachedPendingStore;
    }
  }

  cachedPendingStore = new LocalFilePendingEmbeddingStore();
  return cachedPendingStore;
}

/**
 * Overrides active pending embedding store (primarily for unit tests).
 */
export function setPendingEmbeddingStore(store: IPendingEmbeddingStore | null): void {
  cachedPendingStore = store;
}
