import {
  IPendingEmbeddingStore,
  PendingEmbeddingRecord
} from "./pending-embedding-store.interface.js";

/**
 * InMemoryPendingEmbeddingStore
 *
 * Fast, dependency-free pending store for tests and ephemeral runtimes.
 */
export class InMemoryPendingEmbeddingStore implements IPendingEmbeddingStore {
  private records = new Map<string, PendingEmbeddingRecord>();

  public shouldFail = false;
  public failureMessage = "Simulated local pending embedding store failure";

  public async savePending(record: PendingEmbeddingRecord): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    this.records.set(record.memoryId, { ...record });
  }

  public async removePending(memoryId: string): Promise<void> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    this.records.delete(memoryId);
  }

  public async getPending(memoryId: string): Promise<PendingEmbeddingRecord | null> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    const rec = this.records.get(memoryId);
    return rec ? { ...rec } : null;
  }

  public async listPending(userId?: string): Promise<PendingEmbeddingRecord[]> {
    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }
    const results: PendingEmbeddingRecord[] = [];
    for (const rec of this.records.values()) {
      if (userId && rec.userId !== userId) continue;
      results.push({ ...rec });
    }
    return results;
  }

  public async count(userId?: string): Promise<number> {
    const list = await this.listPending(userId);
    return list.length;
  }

  public async clear(): Promise<void> {
    this.records.clear();
  }
}
