import fs from "fs";
import path from "path";
import { InMemoryVectorStore } from "./in-memory-vector-store.js";
import { VectorRecord } from "./types.js";

export interface LocalFileVectorStoreOptions {
  filePath?: string;
  autoPersist?: boolean;
}

/**
 * LocalFileVectorStore
 *
 * Persistent, self-hosted local vector store backed by a JSON file.
 * Fast in-memory similarity search with durable local disk synchronization.
 */
export class LocalFileVectorStore extends InMemoryVectorStore {
  public override readonly storeId = "local-file" as const;
  private filePath: string;
  private isLoaded = false;
  private autoPersist = true;

  constructor(options?: LocalFileVectorStoreOptions) {
    super();
    this.filePath = options?.filePath || path.resolve(process.cwd(), ".data/vector_store.json");
    if (options?.autoPersist !== undefined) {
      this.autoPersist = options.autoPersist;
    }
  }

  /**
   * Initializes store by reading existing persisted records from disk.
   */
  public async init(): Promise<void> {
    if (this.isLoaded) {
      return;
    }

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = await fs.promises.readFile(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as { records?: VectorRecord[] };
        if (Array.isArray(parsed?.records)) {
          this.records.clear();
          for (const rec of parsed.records) {
            this.records.set(rec.id, rec);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[LocalFileVectorStore] Failed to read ${this.filePath}, starting with empty index:`, err?.message || err);
    } finally {
      this.isLoaded = true;
    }
  }

  private async persist(): Promise<void> {
    if (!this.autoPersist) {
      return;
    }

    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }

      const data = JSON.stringify(
        {
          version: 1,
          updatedAt: new Date().toISOString(),
          recordCount: this.records.size,
          records: Array.from(this.records.values())
        },
        null,
        2
      );

      // Write atomically via temp file to avoid corrupting on unexpected shutdown
      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      await fs.promises.writeFile(tmpPath, data, "utf-8");
      await fs.promises.rename(tmpPath, this.filePath);
    } catch (err: any) {
      console.error(`[LocalFileVectorStore] Failed to persist vector store to ${this.filePath}:`, err?.message || err);
    }
  }

  public override async upsert(record: VectorRecord): Promise<void> {
    await this.init();
    await super.upsert(record);
    await this.persist();
  }

  public override async upsertBatch(records: VectorRecord[]): Promise<void> {
    await this.init();
    await super.upsertBatch(records);
    await this.persist();
  }

  public override async search(queryEmbedding: number[], options: any): Promise<any[]> {
    await this.init();
    return super.search(queryEmbedding, options);
  }

  public override async get(vectorId: string): Promise<VectorRecord | null> {
    await this.init();
    return super.get(vectorId);
  }

  public override async delete(vectorId: string): Promise<void> {
    await this.init();
    await super.delete(vectorId);
    await this.persist();
  }

  public override async deleteByMemoryId(memoryId: string): Promise<void> {
    await this.init();
    await super.deleteByMemoryId(memoryId);
    await this.persist();
  }

  public override async count(): Promise<number> {
    await this.init();
    return super.count();
  }

  public override async clear(): Promise<void> {
    await this.init();
    await super.clear();
    await this.persist();
  }
}
