import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  InMemoryVectorStore,
  LocalFileVectorStore,
  cosineSimilarity,
  VectorRecord
} from "../../src/data/vector/index.js";

describe("Vector Database & Math", () => {
  describe("cosineSimilarity", () => {
    it("returns 1.0 for identical normalized vectors", () => {
      const a = [0.6, 0.8];
      const b = [0.6, 0.8];
      expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
    });

    it("returns 0.0 for orthogonal vectors", () => {
      const a = [1, 0];
      const b = [0, 1];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
    });

    it("returns -1.0 for opposite vectors", () => {
      const a = [1, 0];
      const b = [-1, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
    });

    it("handles zero vectors safely without division by zero", () => {
      const a = [0, 0];
      const b = [1, 1];
      expect(cosineSimilarity(a, b)).toBe(0);
    });
  });

  describe("InMemoryVectorStore", () => {
    let store: InMemoryVectorStore;

    beforeEach(() => {
      store = new InMemoryVectorStore();
    });

    it("upserts and retrieves a vector record", async () => {
      const rec: VectorRecord = {
        id: "vec_1",
        memoryId: "mem_1",
        userId: "baris",
        values: [1, 0, 0],
        metadata: {
          content: "Test content",
          memoryType: "user_preference",
          status: "active",
          userId: "baris"
        }
      };

      await store.upsert(rec);
      expect(await store.count()).toBe(1);

      const fetched = await store.get("vec_1");
      expect(fetched).not.toBeNull();
      expect(fetched?.memoryId).toBe("mem_1");
      expect(fetched?.metadata.content).toBe("Test content");
    });

    it("enforces strict user isolation during search", async () => {
      await store.upsert({
        id: "vec_baris",
        memoryId: "mem_baris",
        userId: "baris",
        values: [1, 0, 0],
        metadata: { content: "Baris fact", memoryType: "user_fact", status: "active", userId: "baris" }
      });

      await store.upsert({
        id: "vec_other",
        memoryId: "mem_other",
        userId: "stranger",
        values: [1, 0, 0],
        metadata: { content: "Stranger fact", memoryType: "user_fact", status: "active", userId: "stranger" }
      });

      // Search as Barış
      const barisResults = await store.search([1, 0, 0], { userId: "baris" });
      expect(barisResults).toHaveLength(1);
      expect(barisResults[0]!.memoryId).toBe("mem_baris");

      // Search as Stranger
      const strangerResults = await store.search([1, 0, 0], { userId: "stranger" });
      expect(strangerResults).toHaveLength(1);
      expect(strangerResults[0]!.memoryId).toBe("mem_other");
    });

    it("filters by status and memoryType", async () => {
      await store.upsertBatch([
        {
          id: "vec_active",
          memoryId: "mem_active",
          userId: "u1",
          values: [1, 0, 0],
          metadata: { content: "Active pref", memoryType: "user_preference", status: "active", userId: "u1" }
        },
        {
          id: "vec_retracted",
          memoryId: "mem_retracted",
          userId: "u1",
          values: [1, 0, 0],
          metadata: { content: "Retracted pref", memoryType: "user_preference", status: "retracted", userId: "u1" }
        },
        {
          id: "vec_project",
          memoryId: "mem_project",
          userId: "u1",
          values: [1, 0, 0],
          metadata: { content: "Project fact", memoryType: "project_fact", status: "active", userId: "u1" }
        }
      ]);

      const activeOnly = await store.search([1, 0, 0], {
        userId: "u1",
        filter: { status: "active" }
      });
      expect(activeOnly).toHaveLength(2);

      const projectOnly = await store.search([1, 0, 0], {
        userId: "u1",
        filter: { status: "active", memoryType: "project_fact" }
      });
      expect(projectOnly).toHaveLength(1);
      expect(projectOnly[0]!.memoryId).toBe("mem_project");
    });

    it("respects topK bounding and minScore filtering", async () => {
      await store.upsertBatch([
        {
          id: "vec_high",
          memoryId: "mem_high",
          userId: "u1",
          values: [0.99, 0.1, 0],
          metadata: { content: "High similarity", memoryType: "general", status: "active", userId: "u1" }
        },
        {
          id: "vec_med",
          memoryId: "mem_med",
          userId: "u1",
          values: [0.7, 0.7, 0],
          metadata: { content: "Medium similarity", memoryType: "general", status: "active", userId: "u1" }
        },
        {
          id: "vec_low",
          memoryId: "mem_low",
          userId: "u1",
          values: [0, 1, 0],
          metadata: { content: "Orthogonal", memoryType: "general", status: "active", userId: "u1" }
        }
      ]);

      const query = [1, 0, 0];

      // minScore = 0.8 should only match high
      const strict = await store.search(query, { userId: "u1", minScore: 0.8 });
      expect(strict).toHaveLength(1);
      expect(strict[0]!.memoryId).toBe("mem_high");

      // topK = 1 should return only highest
      const top1 = await store.search(query, { userId: "u1", topK: 1 });
      expect(top1).toHaveLength(1);
      expect(top1[0]!.memoryId).toBe("mem_high");
    });

    it("deletes records by ID and by memoryId", async () => {
      await store.upsert({
        id: "vec_del",
        memoryId: "mem_del",
        userId: "u1",
        values: [1, 0, 0],
        metadata: { content: "To delete", memoryType: "general", status: "active", userId: "u1" }
      });

      expect(await store.count()).toBe(1);
      await store.deleteByMemoryId("mem_del");
      expect(await store.count()).toBe(0);
    });

    it("throws explicit error when shouldFail is set", async () => {
      store.shouldFail = true;
      store.failureMessage = "Disk I/O error";

      await expect(
        store.upsert({
          id: "1",
          memoryId: "1",
          userId: "u1",
          values: [1],
          metadata: { content: "c", memoryType: "g", status: "active", userId: "u1" }
        })
      ).rejects.toThrow("Disk I/O error");
    });
  });

  describe("LocalFileVectorStore", () => {
    let tmpFile: string;

    beforeEach(() => {
      tmpFile = path.join(os.tmpdir(), `test_vector_store_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    });

    afterEach(() => {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    });

    it("persists records to disk and reloads them on new instance", async () => {
      const store1 = new LocalFileVectorStore({ filePath: tmpFile });
      await store1.upsert({
        id: "v1",
        memoryId: "m1",
        userId: "baris",
        values: [1, 0, 0],
        metadata: { content: "Persistent memory", memoryType: "project_fact", status: "active", userId: "baris" }
      });

      expect(fs.existsSync(tmpFile)).toBe(true);

      // Create new instance pointing to same file
      const store2 = new LocalFileVectorStore({ filePath: tmpFile });
      const record = await store2.get("v1");
      expect(record).not.toBeNull();
      expect(record?.metadata.content).toBe("Persistent memory");

      const search = await store2.search([1, 0, 0], { userId: "baris" });
      expect(search).toHaveLength(1);
      expect(search[0]!.memoryId).toBe("m1");
    });
  });
});
