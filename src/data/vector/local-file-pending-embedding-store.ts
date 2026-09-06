import fs from "fs";
import path from "path";
import {
  IPendingEmbeddingStore,
  PendingEmbeddingRecord
} from "./pending-embedding-store.interface.js";

export interface LocalFilePendingStoreOptions {
  filePath?: string;
}

/**
 * LocalFilePendingEmbeddingStore
 *
 * Persists pending embeddings to local disk before attempting Firestore writes.
 * If local write fails, the pipeline halts immediately (fail-safe).
 * Upon successful Firestore write, the staged entry is removed.
 */
export class LocalFilePendingEmbeddingStore implements IPendingEmbeddingStore {
  private filePath: string;
  private isLoaded = false;
  private records = new Map<string, PendingEmbeddingRecord>();

  constructor(options?: LocalFilePendingStoreOptions) {
    this.filePath = options?.filePath || path.resolve(process.cwd(), ".data/pending_embeddings.json");
  }

  private async load(): Promise<void> {
    if (this.isLoaded) return;

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = await fs.promises.readFile(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as { records?: PendingEmbeddingRecord[] };
        if (Array.isArray(parsed?.records)) {
          this.records.clear();
          for (const rec of parsed.records) {
            this.records.set(rec.memoryId, rec);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[LocalFilePendingStore] Could not read ${this.filePath}:`, err?.message || err);
    } finally {
      this.isLoaded = true;
    }
  }

  private async persist(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }

    const payload = JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        count: this.records.size,
        records: Array.from(this.records.values())
      },
      null,
      2
    );

    await fs.promises.writeFile(this.filePath, payload, "utf-8");
  }

  public async savePending(record: PendingEmbeddingRecord): Promise<void> {
    await this.load();
    this.records.set(record.memoryId, { ...record });
    await this.persist();
  }

  public async removePending(memoryId: string): Promise<void> {
    await this.load();
    if (this.records.has(memoryId)) {
      this.records.delete(memoryId);
      await this.persist();
    }
  }

  public async getPending(memoryId: string): Promise<PendingEmbeddingRecord | null> {
    await this.load();
    const rec = this.records.get(memoryId);
    return rec ? { ...rec } : null;
  }

  public async listPending(userId?: string): Promise<PendingEmbeddingRecord[]> {
    await this.load();
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
    await this.persist();
  }
}
