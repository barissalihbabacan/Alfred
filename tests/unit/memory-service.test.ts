import { describe, it, expect, beforeEach } from "vitest";
import { MemoryService } from "../../src/alfred/cognitive/memory/memory-service.js";
import { InMemoryMemoryRepository } from "../../src/data/firestore/in-memory-memory-repository.js";
import { InMemoryVectorStore } from "../../src/data/vector/in-memory-vector-store.js";
import { MockEmbeddingProvider } from "../../src/ai/embedding/mock-embedding-provider.js";

describe("MemoryService — Core Cognitive Memory Lifecycle", () => {
  let memoryRepo: InMemoryMemoryRepository;
  let vectorStore: InMemoryVectorStore;
  let embeddingProvider: MockEmbeddingProvider;
  let service: MemoryService;

  beforeEach(() => {
    memoryRepo = new InMemoryMemoryRepository();
    vectorStore = new InMemoryVectorStore();
    embeddingProvider = new MockEmbeddingProvider({ dimension: 64 });
    service = new MemoryService({
      memoryRepo,
      vectorStore,
      embeddingProvider,
      config: {
        retrieval: {
          enabled: true,
          topK: 3,
          minScore: 0.05,
          timeoutMs: 1000
        }
      }
    });
  });

  describe("Memory Creation & Indexing Pipeline", () => {
    it("creates a memory, generates stable ID, persists to Firestore, and indexes in vector DB", async () => {
      const record = await service.createMemory({
        userId: "baris",
        content: "Barış prefers TypeScript for application development.",
        memoryType: "user_preference"
      });

      // 1. Stable Memory ID & Metadata
      expect(record.memoryId).toBeDefined();
      expect(record.memoryId.startsWith("mem_")).toBe(true);
      expect(record.userId).toBe("baris");
      expect(record.content).toBe("Barış prefers TypeScript for application development.");
      expect(record.memoryType).toBe("user_preference");
      expect(record.status).toBe("active");
      expect(record.indexStatus).toBe("indexed");
      expect(record.embeddingProvider).toBe("mock");
      expect(record.embeddingModel).toBe("alfred-mock-embed-v1");
      expect(record.embeddingDimension).toBe(64);

      // 2. Firestore authoritative record exists
      const inFirestore = await memoryRepo.getMemoryRecordByMemoryId(record.memoryId);
      expect(inFirestore).not.toBeNull();
      expect(inFirestore?.indexStatus).toBe("indexed");

      // 3. Vector DB index entry exists
      const inVector = await vectorStore.get(record.vectorId);
      expect(inVector).not.toBeNull();
      expect(inVector?.memoryId).toBe(record.memoryId);
      expect(inVector?.userId).toBe("baris");
      expect(inVector?.values).toHaveLength(64);
    });

    it("fails fast if embedding generation fails without persisting Firestore or vector data", async () => {
      embeddingProvider.shouldFail = true;
      embeddingProvider.failureMessage = "Ollama connection refused";

      await expect(
        service.createMemory({
          userId: "baris",
          content: "Some fact"
        })
      ).rejects.toThrow("Ollama connection refused");

      // Assert no orphan data in Firestore or Vector DB
      const firestoreActive = await memoryRepo.listAllActive();
      expect(firestoreActive).toHaveLength(0);
      expect(await vectorStore.count()).toBe(0);
    });

    it("fails fast if Firestore persistence fails without indexing an orphaned vector", async () => {
      memoryRepo.shouldFail = true;
      memoryRepo.failureMessage = "Firestore write quota exceeded";

      await expect(
        service.createMemory({
          userId: "baris",
          content: "Some fact"
        })
      ).rejects.toThrow("Firestore write quota exceeded");

      // Assert vector DB was not touched
      expect(await vectorStore.count()).toBe(0);
    });

    it("preserves Firestore record with indexStatus='failed' if vector indexing fails", async () => {
      vectorStore.shouldFail = true;
      vectorStore.failureMessage = "Vector DB disk full";

      await expect(
        service.createMemory({
          userId: "baris",
          content: "Important architectural constraint"
        })
      ).rejects.toThrow("Vector DB disk full");

      // Assert Firestore has the record preserved as failed
      const active = await memoryRepo.listAllActive("baris");
      expect(active).toHaveLength(1);
      const failedRecord = active[0]!;
      expect(failedRecord.status).toBe("active");
      expect(failedRecord.indexStatus).toBe("failed");
      expect(failedRecord.lastError).toContain("Vector DB disk full");
    });
  });

  describe("Semantic Retrieval & User Isolation", () => {
    beforeEach(async () => {
      await service.createMemory({
        userId: "baris",
        content: "Barış prefers TypeScript for backend and web engineering.",
        memoryType: "technical_preference"
      });

      await service.createMemory({
        userId: "baris",
        content: "The production web application runs through Firebase Cloud Functions.",
        memoryType: "project_fact"
      });

      await service.createMemory({
        userId: "other_user",
        content: "Other user strictly requires Python and Django.",
        memoryType: "technical_preference"
      });
    });

    it("retrieves semantically relevant memories matching query", async () => {
      const results = await service.searchMemories(
        "What programming language does Barış prefer?",
        "baris"
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.content).toContain("TypeScript");
      expect(results[0]!.score).toBeGreaterThan(0.05);
    });

    it("strictly isolates users so tenant memories never leak", async () => {
      // Barış searching should NEVER see other_user's memories
      const barisResults = await service.searchMemories(
        "What programming language is required?",
        "baris"
      );

      for (const res of barisResults) {
        expect(res.content).not.toContain("Django");
      }

      // Other user should only see their own memory
      const otherResults = await service.searchMemories(
        "What programming language is required?",
        "other_user"
      );
      expect(otherResults).toHaveLength(1);
      expect(otherResults[0]!.content).toContain("Python and Django");
    });

    it("respects topK bounding and minScore threshold", async () => {
      const strictResults = await service.searchMemories("TypeScript", "baris", {
        minScore: 0.99 // Impossibly high threshold
      });
      expect(strictResults).toHaveLength(0);

      const boundedResults = await service.searchMemories("engineering application", "baris", {
        topK: 1,
        minScore: 0.01
      });
      expect(boundedResults).toHaveLength(1);
    });

    it("fails open gracefully if vector store fails during retrieval (does not throw)", async () => {
      vectorStore.shouldFail = true;
      vectorStore.failureMessage = "Vector DB offline";

      const results = await service.searchMemories("What is the architecture?", "baris");
      expect(results).toEqual([]);
    });
  });

  describe("Memory Retraction (Soft-delete & De-indexing)", () => {
    it("marks memory retracted in Firestore and removes it from vector store", async () => {
      const created = await service.createMemory({
        userId: "baris",
        content: "Temporary working note",
        memoryType: "general"
      });

      expect(await vectorStore.count()).toBe(1);

      await service.retractMemory(created.memoryId, "baris");

      // Verify Firestore status changed
      const updated = await memoryRepo.getMemoryRecordByMemoryId(created.memoryId);
      expect(updated?.status).toBe("retracted");

      // Verify vector index purged
      expect(await vectorStore.count()).toBe(0);

      // Search yields nothing
      const search = await service.searchMemories("Temporary working note", "baris");
      expect(search).toHaveLength(0);
    });

    it("prevents retracting another user's memory", async () => {
      const created = await service.createMemory({
        userId: "baris",
        content: "Barış private note"
      });

      await expect(service.retractMemory(created.memoryId, "intruder")).rejects.toThrow("Forbidden");
    });
  });

  describe("Rebuilding Vector Index from Firestore (Mandatory Re-index)", () => {
    it("can completely rebuild vector database from Firestore historical records", async () => {
      // 1. Create multiple memories
      await service.createMemory({
        userId: "baris",
        content: "Barış prefers TypeScript for application development.",
        memoryType: "user_preference"
      });

      await service.createMemory({
        userId: "baris",
        content: "The Alfred project uses Ollama with Gemma 4 12B MLX.",
        memoryType: "project_fact"
      });

      expect(await vectorStore.count()).toBe(2);

      // 2. Simulate complete vector store loss / deletion
      await vectorStore.clear();
      expect(await vectorStore.count()).toBe(0);

      // 3. Run Re-indexing from Firestore source of truth
      const result = await service.reindexAll();
      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);

      // 4. Verify vector database is fully restored
      expect(await vectorStore.count()).toBe(2);

      const search = await service.searchMemories("What model does Alfred use?", "baris");
      expect(search.length).toBeGreaterThan(0);
      expect(search[0]!.content).toContain("Gemma 4 12B MLX");
    });

    it("removes the vector of a memory that was retracted in Firestore but whose vector delete never happened", async () => {
      const kept = await service.createMemory({ userId: "baris", content: "Alfred runs Gemma 4 12B MLX locally", memoryType: "architectural_decision" });
      const forgotten = await service.createMemory({ userId: "baris", content: "Barış's old office was in Levent", memoryType: "user_preference" });
      expect(await vectorStore.count()).toBe(2);

      // Firestore says retracted, but the process died before the vector delete.
      const record = await memoryRepo.getMemoryRecordByMemoryId(forgotten.memoryId);
      await memoryRepo.updateMemoryStatus({ id: record!.id, status: "retracted" });
      expect(await vectorStore.count()).toBe(2);

      const result = await service.reindexAll("baris");
      expect(result).toMatchObject({ total: 1, succeeded: 1, failed: 0, retiredRemoved: 1 });
      expect(await vectorStore.count()).toBe(1);
      const hits = await service.searchMemories("Where was Barış's old office?", "baris");
      expect(hits.map((h) => h.memoryId)).not.toContain(forgotten.memoryId);
      expect(kept.memoryId).toBeTruthy();
    });

    it("re-indexing is idempotent and safe to run repeatedly", async () => {
      await service.createMemory({
        userId: "baris",
        content: "Idempotency invariant fact",
        memoryType: "architectural_decision"
      });

      // Run reindex 1st time
      const res1 = await service.reindexAll();
      expect(res1.succeeded).toBe(1);
      expect(await vectorStore.count()).toBe(1);

      // Run reindex 2nd time without clearing
      const res2 = await service.reindexAll();
      expect(res2.succeeded).toBe(1);
      expect(await vectorStore.count()).toBe(1);
    });
  });
});
