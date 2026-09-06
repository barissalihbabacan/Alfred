import { describe, it, expect, beforeEach } from "vitest";
import { MemoryService } from "../../src/alfred/cognitive/memory/memory-service.js";
import { InMemoryMemoryRepository } from "../../src/data/firestore/in-memory-memory-repository.js";
import { InMemoryVectorStore } from "../../src/data/vector/in-memory-vector-store.js";
import { InMemoryPendingEmbeddingStore } from "../../src/data/vector/in-memory-pending-embedding-store.js";
import { MockEmbeddingProvider } from "../../src/ai/embedding/mock-embedding-provider.js";

describe("Memory Pending Embedding Pipeline — Write-Ahead Staging & Durability", () => {
  let memoryRepo: InMemoryMemoryRepository;
  let vectorStore: InMemoryVectorStore;
  let embeddingProvider: MockEmbeddingProvider;
  let pendingStore: InMemoryPendingEmbeddingStore;
  let service: MemoryService;

  beforeEach(() => {
    memoryRepo = new InMemoryMemoryRepository();
    vectorStore = new InMemoryVectorStore();
    embeddingProvider = new MockEmbeddingProvider({ dimension: 64 });
    pendingStore = new InMemoryPendingEmbeddingStore();

    service = new MemoryService({
      memoryRepo,
      vectorStore,
      embeddingProvider,
      pendingStore,
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

  describe("Happy Path: Full Lifecycle", () => {
    it("stages embedding locally, persists embedding to Firestore, cleans local stage, and indexes in vector store", async () => {
      const record = await service.createMemory({
        userId: "baris",
        content: "Barış prefers drinking apple juice.",
        memoryType: "user_preference"
      });

      // 1. Authoritative Firestore document contains full embedding
      const inFirestore = await memoryRepo.getMemoryRecordByMemoryId(record.memoryId);
      expect(inFirestore).not.toBeNull();
      expect(inFirestore?.content).toBe("Barış prefers drinking apple juice.");
      expect(inFirestore?.embedding).toBeDefined();
      expect(Array.isArray(inFirestore?.embedding)).toBe(true);
      expect(inFirestore?.embedding).toHaveLength(64);
      expect(inFirestore?.indexStatus).toBe("indexed");

      // 2. Local pending staging store was cleaned up on confirmed Firestore write
      const remainingPending = await pendingStore.listPending("baris");
      expect(remainingPending).toHaveLength(0);

      // 3. Vector DB index is populated
      const inVector = await vectorStore.get(record.vectorId);
      expect(inVector).not.toBeNull();
      expect(inVector?.values).toEqual(inFirestore?.embedding);
    });
  });

  describe("Partial Failure Scenarios", () => {
    it("Scenario 1: embedding generation fails -> no local record, no Firestore write, no vector write", async () => {
      embeddingProvider.shouldFail = true;
      embeddingProvider.failureMessage = "Ollama connection timeout";

      await expect(
        service.createMemory({
          userId: "baris",
          content: "Favorite food is pizza"
        })
      ).rejects.toThrow("Ollama connection timeout");

      // Verify no pending record created
      expect(await pendingStore.count()).toBe(0);

      // Verify no Firestore record created
      expect(await memoryRepo.listAllActive("baris")).toHaveLength(0);

      // Verify no vector record created
      expect(await vectorStore.count()).toBe(0);
    });

    it("Scenario 2: local staging fails -> stops immediately, Firestore never called", async () => {
      pendingStore.shouldFail = true;
      pendingStore.failureMessage = "Disk I/O error writing pending embedding";

      await expect(
        service.createMemory({
          userId: "baris",
          content: "Favorite music is jazz"
        })
      ).rejects.toThrow("Disk I/O error writing pending embedding");

      // Firestore was never touched
      expect(await memoryRepo.listAllActive("baris")).toHaveLength(0);

      // Vector store was never touched
      expect(await vectorStore.count()).toBe(0);
    });

    it("Scenario 3: Firestore fails -> local pending embedding is PRESERVED for retry/recovery", async () => {
      memoryRepo.shouldFail = true;
      memoryRepo.failureMessage = "Firestore connection unavailable";

      await expect(
        service.createMemory({
          userId: "baris",
          content: "Barış prefers dark mode in code editors."
        })
      ).rejects.toThrow("Firestore connection unavailable");

      // Local pending embedding store holds the staged record
      const pendingList = await pendingStore.listPending("baris");
      expect(pendingList).toHaveLength(1);
      const staged = pendingList[0]!;
      expect(staged.content).toBe("Barış prefers dark mode in code editors.");
      expect(staged.userId).toBe("baris");
      expect(staged.embedding).toHaveLength(64);
      expect(staged.embeddingProvider).toBe("mock");

      // Vector DB was never touched
      expect(await vectorStore.count()).toBe(0);
    });

    it("Scenario 4: local cleanup fails after Firestore success -> does not fail memory creation", async () => {
      // Simulate cleanup failure by monkey-patching removePending
      const originalRemove = pendingStore.removePending.bind(pendingStore);
      pendingStore.removePending = async () => {
        throw new Error("Unable to unlink local pending file");
      };

      // Memory creation still succeeds because Firestore (SSOT) has confirmed write
      const record = await service.createMemory({
        userId: "baris",
        content: "Barış uses Linux as primary OS."
      });

      expect(record).toBeDefined();
      expect(record.content).toBe("Barış uses Linux as primary OS.");

      // Firestore record exists and has embedding
      const inFirestore = await memoryRepo.getMemoryRecordByMemoryId(record.memoryId);
      expect(inFirestore).not.toBeNull();
      expect(inFirestore?.embedding).toHaveLength(64);

      // Restore original method
      pendingStore.removePending = originalRemove;
    });
  });

  describe("Idempotent Retries & Recovery", () => {
    it("retryPendingEmbeddings recovers staged embeddings without creating duplicate Firestore records", async () => {
      // 1. Simulate a failed Firestore write by staging an item manually
      await pendingStore.savePending({
        memoryId: "mem_recovery_test_001",
        userId: "baris",
        content: "Barış uses Neovim.",
        memoryType: "user_preference",
        embeddingProvider: "mock",
        embeddingModel: "alfred-mock-embed-v1",
        embeddingDimension: 64,
        embedding: new Array(64).fill(0.123),
        stagedAt: new Date().toISOString(),
        retryCount: 0
      });

      expect(await pendingStore.count()).toBe(1);
      expect(await memoryRepo.getMemoryRecordByMemoryId("mem_recovery_test_001")).toBeNull();

      // 2. Run retry
      const retryReport1 = await service.retryPendingEmbeddings("baris");
      expect(retryReport1.processed).toBe(1);
      expect(retryReport1.succeeded).toBe(1);
      expect(retryReport1.failed).toBe(0);

      // 3. Confirm Firestore now contains the record with the staged embedding
      const inFirestore = await memoryRepo.getMemoryRecordByMemoryId("mem_recovery_test_001");
      expect(inFirestore).not.toBeNull();
      expect(inFirestore?.content).toBe("Barış uses Neovim.");
      expect(inFirestore?.embedding).toEqual(new Array(64).fill(0.123));

      // 4. Pending store is cleaned up
      expect(await pendingStore.count()).toBe(0);

      // 5. Test idempotency: if the item was somehow staged again, retry does not duplicate
      await pendingStore.savePending({
        memoryId: "mem_recovery_test_001",
        userId: "baris",
        content: "Barış uses Neovim.",
        memoryType: "user_preference",
        embeddingProvider: "mock",
        embeddingModel: "alfred-mock-embed-v1",
        embeddingDimension: 64,
        embedding: new Array(64).fill(0.123),
        stagedAt: new Date().toISOString(),
        retryCount: 1
      });

      const retryReport2 = await service.retryPendingEmbeddings("baris");
      expect(retryReport2.processed).toBe(1);
      expect(retryReport2.succeeded).toBe(1);

      // All active records in Firestore: still exactly 1 record, no duplicate
      const allActive = await memoryRepo.listAllActive("baris");
      expect(allActive.filter((r) => r.memoryId === "mem_recovery_test_001")).toHaveLength(1);
      expect(await pendingStore.count()).toBe(0);
    });
  });

  describe("Fallback Semantic Search from Firestore", () => {
    it("retrieves memories directly from Firestore active embeddings when Vector DB is empty or wiped", async () => {
      // 1. Create memories through normal pipeline
      await service.createMemory({
        userId: "baris",
        content: "Barış prefers TypeScript for backend engineering.",
        memoryType: "technical_preference"
      });

      await service.createMemory({
        userId: "baris",
        content: "Production runs on Firebase Cloud Functions.",
        memoryType: "project_fact"
      });

      await service.createMemory({
        userId: "other_user",
        content: "Other user strictly writes Python.",
        memoryType: "technical_preference"
      });

      // 2. Completely wipe the local vector store to simulate fresh container / wiped vector store
      await vectorStore.clear();
      expect(await vectorStore.count()).toBe(0);

      // 3. Execute search for Barış
      const results = await service.searchMemories("What programming language does Barış use?", "baris", {
        minScore: 0.05
      });

      // Fallback successfully retrieved relevant memories from Firestore without vector DB
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.content).toContain("TypeScript");

      // Strict user isolation preserved in fallback
      for (const res of results) {
        expect(res.content).not.toContain("Python");
      }
    });
  });
});
