import { describe, it, expect, beforeEach } from "vitest";
import { MemoryService } from "../../src/alfred/cognitive/memory/memory-service.js";
import { InMemoryMemoryRepository } from "../../src/data/firestore/in-memory-memory-repository.js";
import { InMemoryVectorStore } from "../../src/data/vector/in-memory-vector-store.js";
import { MockEmbeddingProvider } from "../../src/ai/embedding/mock-embedding-provider.js";
import { MemoryExtractor } from "../../src/alfred/cognitive/memory/extractor/memory-extractor.js";
import { PrivacyFilter } from "../../src/alfred/cognitive/memory/privacy-filter.js";
import { buildMemoryExtractionPrompt, parseMemoryExtractionResponse } from "../../src/ai/prompts/memory-extraction.js";
import { AIProvider, ChatMessage, ChatCompletionResponse } from "../../src/ai/providers/types.js";
import { IEmbeddingProvider } from "../../src/ai/embedding/types.js";

/** Embeds by lookup, so tests control exact cosine scores. */
class TableEmbeddingProvider implements IEmbeddingProvider {
  public readonly id = "table";
  public readonly dimension = 2;
  constructor(public readonly vectors: Record<string, number[]>, public readonly model = "table-model") {}
  public async embed(text: string): Promise<number[]> {
    const v = this.vectors[text.trim()];
    if (!v) throw new Error(`no vector for ${text}`);
    return [...v];
  }
  public async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
  public isConfigured(): boolean {
    return true;
  }
}

/**
 * Mock AI Provider for deterministic extraction tests.
 */
class MockAIProvider implements AIProvider {
  public readonly id = "mock-ai";
  public readonly name = "Mock AI Provider";
  public responseJson: unknown = { shouldRemember: false, memories: [] };
  public shouldFail = false;
  public lastMessages: ChatMessage[] = [];

  public isConfigured(): boolean {
    return true;
  }

  public getSupportedModels() {
    return { chat: ["mock-model"] };
  }

  public async chat(messages: ChatMessage[]): Promise<ChatCompletionResponse> {
    this.lastMessages = messages;
    if (this.shouldFail) {
      throw new Error("Mock AI Provider LLM error");
    }

    const content = typeof this.responseJson === "string" 
      ? this.responseJson 
      : JSON.stringify(this.responseJson);

    return {
      id: "mock_chat_id",
      content,
      model: "mock-model",
      role: "assistant"
    };
  }
}

describe("Autonomous Long-Term Memory Extraction Suite", () => {
  describe("PrivacyFilter", () => {
    it("rejects API keys, passwords, and private keys", () => {
      expect(PrivacyFilter.check("Barış uses sk-proj-12345678901234567890123456 for testing").isSafe).toBe(false);
      expect(PrivacyFilter.check("password: superSecretPassword123").isSafe).toBe(false);
      expect(PrivacyFilter.check("-----BEGIN RSA PRIVATE KEY-----\nMIIE...").isSafe).toBe(false);
      expect(PrivacyFilter.check("ghp_123456789012345678901234567890123456").isSafe).toBe(false);
    });

    it("allows standard preferences and engineering statements", () => {
      expect(PrivacyFilter.check("Barış prefers TypeScript for full-stack architecture.").isSafe).toBe(true);
      expect(PrivacyFilter.check("The project uses Firebase Firestore for runtime state.").isSafe).toBe(true);
    });
  });

  describe("Memory Extraction Prompt & Response Parsing", () => {
    it("bounds conversation context to max specified messages", () => {
      const messages = buildMemoryExtractionPrompt({
        currentMessage: "We are using Vite.",
        userId: "baris",
        userName: "Barış",
        recentMessages: [
          { role: "user", content: "Msg 1" },
          { role: "assistant", content: "Msg 2" },
          { role: "user", content: "Msg 3" }
        ]
      });

      expect(messages).toHaveLength(2);
      expect(messages[0]!.role).toBe("system");
      expect(messages[0]!.content).toContain("Barış");
      expect(messages[1]!.content).toContain("Msg 1");
      expect(messages[1]!.content).toContain("We are using Vite.");
    });

    it("parses valid JSON candidate memories cleanly", () => {
      const json = JSON.stringify({
        shouldRemember: true,
        memories: [
          {
            content: "Barış prefers TypeScript for application development.",
            memoryType: "user_preference",
            confidence: 0.95,
            action: "create"
          }
        ]
      });

      const parsed = parseMemoryExtractionResponse(json, 0.75);
      expect(parsed.shouldRemember).toBe(true);
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]!.content).toBe("Barış prefers TypeScript for application development.");
      expect(parsed.candidates[0]!.memoryType).toBe("user_preference");
      expect(parsed.candidates[0]!.confidence).toBe(0.95);
    });

    it("strips markdown code fences from model response", () => {
      const text = "```json\n" + JSON.stringify({
        shouldRemember: true,
        memories: [
          {
            content: "The Alfred project uses Firestore for runtime persistence.",
            memoryType: "project_fact",
            confidence: 0.9,
            action: "create"
          }
        ]
      }) + "\n```";

      const parsed = parseMemoryExtractionResponse(text, 0.75);
      expect(parsed.shouldRemember).toBe(true);
      expect(parsed.candidates).toHaveLength(1);
      expect(parsed.candidates[0]!.memoryType).toBe("project_fact");
    });

    it("rejects malformed non-JSON output gracefully without throwing", () => {
      const parsed = parseMemoryExtractionResponse("I think you should remember that Barış likes TypeScript.", 0.75);
      expect(parsed.shouldRemember).toBe(false);
      expect(parsed.candidates).toHaveLength(0);
    });

    it("filters out candidates below confidence threshold", () => {
      const json = JSON.stringify({
        shouldRemember: true,
        memories: [
          {
            content: "Barış might possibly enjoy hiking.",
            memoryType: "user_fact",
            confidence: 0.4,
            action: "create"
          }
        ]
      });

      const parsed = parseMemoryExtractionResponse(json, 0.75);
      expect(parsed.shouldRemember).toBe(false);
      expect(parsed.candidates).toHaveLength(0);
    });
  });

  describe("MemoryExtractor Class", () => {
    let mockProvider: MockAIProvider;
    let extractor: MemoryExtractor;

    beforeEach(() => {
      mockProvider = new MockAIProvider();
      extractor = new MemoryExtractor({
        provider: mockProvider,
        config: {
          enabled: true,
          minConfidence: 0.75,
          maxContextMessages: 4,
          timeoutMs: 1000
        }
      });
    });

    it("extracts candidate memory on explicit user instruction", async () => {
      mockProvider.responseJson = {
        shouldRemember: true,
        memories: [
          {
            content: "Barış prefers dark mode for all code editors.",
            memoryType: "user_preference",
            confidence: 0.98,
            action: "create"
          }
        ]
      };

      const result = await extractor.extract({
        currentMessage: "Remember that I prefer dark mode for all code editors.",
        userId: "baris",
        userName: "Barış"
      });

      expect(result.shouldRemember).toBe(true);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]!.content).toContain("dark mode");
    });

    it("returns empty when explicit negative signal is detected (fast-path)", async () => {
      const result = await extractor.extract({
        currentMessage: "don't remember this",
        userId: "baris"
      });

      expect(result.shouldRemember).toBe(false);
      expect(result.candidates).toHaveLength(0);
      // Fast path skips calling AI provider
      expect(mockProvider.lastMessages).toHaveLength(0);
    });

    it("fails open gracefully when AI provider throws", async () => {
      mockProvider.shouldFail = true;

      const result = await extractor.extract({
        currentMessage: "My favorite language is TypeScript.",
        userId: "baris"
      });

      expect(result.shouldRemember).toBe(false);
      expect(result.candidates).toHaveLength(0);
    });
  });

  describe("MemoryService Integration with Autonomous Extraction", () => {
    let memoryRepo: InMemoryMemoryRepository;
    let vectorStore: InMemoryVectorStore;
    let embeddingProvider: MockEmbeddingProvider;
    let mockAI: MockAIProvider;
    let extractor: MemoryExtractor;
    let service: MemoryService;

    beforeEach(() => {
      memoryRepo = new InMemoryMemoryRepository();
      vectorStore = new InMemoryVectorStore();
      embeddingProvider = new MockEmbeddingProvider({ dimension: 64 });
      mockAI = new MockAIProvider();
      extractor = new MemoryExtractor({
        provider: mockAI,
        config: {
          enabled: true,
          minConfidence: 0.75,
          maxContextMessages: 4,
          timeoutMs: 1000
        }
      });

      service = new MemoryService({
        memoryRepo,
        vectorStore,
        embeddingProvider,
        extractor,
        config: {
          retrieval: {
            enabled: true,
            topK: 3,
            minScore: 0.05,
            timeoutMs: 1000
          },
          extraction: {
            enabled: true,
            minConfidence: 0.75,
            maxContextMessages: 4,
            timeoutMs: 1000
          }
        }
      });
    });

    it("creates durable memory from candidate and indexes through pipeline", async () => {
      mockAI.responseJson = {
        shouldRemember: true,
        memories: [
          {
            content: "Barış prefers TypeScript for application development.",
            memoryType: "user_preference",
            confidence: 0.95,
            action: "create"
          }
        ]
      };

      const result = await service.processConversationForMemories({
        currentMessage: "Remember that I prefer TypeScript for application development.",
        userId: "baris",
        userName: "Barış",
        conversationId: "conv_123"
      });

      expect(result.created).toHaveLength(1);
      expect(result.created[0]!.content).toContain("TypeScript");

      // Verify Firestore has it
      const inFirestore = await memoryRepo.listMemories({ userId: "baris" });
      expect(inFirestore).toHaveLength(1);
      expect(inFirestore[0]!.status).toBe("active");

      // Verify Vector Store has it
      const vectorCount = await vectorStore.count();
      expect(vectorCount).toBe(1);
    });

    it("rejects transient chit-chat, greetings, and simple questions", async () => {
      mockAI.responseJson = {
        shouldRemember: false,
        memories: []
      };

      const result = await service.processConversationForMemories({
        currentMessage: "Good morning Alfred! What time is it right now?",
        userId: "baris",
        userName: "Barış"
      });

      expect(result.created).toHaveLength(0);
      expect(result.skippedDuplicates).toHaveLength(0);
      expect(await memoryRepo.listAllActive("baris")).toHaveLength(0);
    });

    it("suppresses duplicate memories when identical/highly-similar memory already exists", async () => {
      // 1. First seed an existing memory
      await service.createMemory({
        content: "Barış prefers TypeScript for application development.",
        userId: "baris",
        memoryType: "user_preference"
      });

      // 2. Extractor returns the same memory
      mockAI.responseJson = {
        shouldRemember: true,
        memories: [
          {
            content: "Barış prefers TypeScript for application development.",
            memoryType: "user_preference",
            confidence: 0.92,
            action: "create"
          }
        ]
      };

      const result = await service.processConversationForMemories({
        currentMessage: "Just repeating that I prefer TypeScript.",
        userId: "baris"
      });

      expect(result.created).toHaveLength(0);
      expect(result.skippedDuplicates).toHaveLength(1);
      expect(result.skippedDuplicates[0]).toContain("TypeScript");

      // Firestore should still have only 1 record
      const allActive = await memoryRepo.listAllActive("baris");
      expect(allActive).toHaveLength(1);
    });

    it("supersedes older memory and marks status as superseded in Firestore and removes old from vector store", async () => {
      // 1. Initial memory: Uses Jenkins
      const initial = await service.createMemory({
        content: "The project uses Jenkins for CI/CD pipeline automation.",
        userId: "baris",
        memoryType: "project_fact"
      });

      expect(await vectorStore.count()).toBe(1);

      // 2. User switched to GitHub Actions: candidate indicates supersede
      mockAI.responseJson = {
        shouldRemember: true,
        memories: [
          {
            content: "The project migrated CI/CD pipeline automation to GitHub Actions.",
            memoryType: "project_fact",
            confidence: 0.96,
            action: "supersede",
            targetMemoryHint: "The project uses Jenkins for CI/CD pipeline automation."
          }
        ]
      };

      const result = await service.processConversationForMemories({
        currentMessage: "We have migrated from Jenkins to GitHub Actions for our CI/CD pipeline.",
        userId: "baris"
      });

      expect(result.created).toHaveLength(1);
      expect(result.superseded).toHaveLength(1);
      expect(result.superseded[0]!.oldMemoryId).toBe(initial.memoryId);

      // Check Firestore old record status
      const oldDoc = await memoryRepo.getMemoryRecordByMemoryId(initial.memoryId);
      expect(oldDoc?.status).toBe("superseded");
      expect(oldDoc?.supersededByMemoryId).toBe(result.created[0]!.memoryId);

      // Check new record references old record
      expect(result.created[0]!.supersedesMemoryId).toBe(initial.memoryId);

      // Active search should only return GitHub Actions, not Jenkins
      const activeMemories = await service.searchMemories("CI/CD pipeline automation", "baris");
      expect(activeMemories.length).toBeGreaterThan(0);
      expect(activeMemories[0]!.content).toContain("GitHub Actions");
      for (const m of activeMemories) {
        expect(m.content).not.toContain("Jenkins");
      }
    });

    it("retracts memory on explicit forget request", async () => {
      // 1. Initial memory
      const seeded = await service.createMemory({
        content: "Barış prefers tabs over spaces.",
        userId: "baris",
        memoryType: "user_preference"
      });

      expect(await vectorStore.count()).toBe(1);

      // 2. Forget action
      mockAI.responseJson = {
        shouldRemember: true,
        memories: [
          {
            content: "Barış prefers tabs over spaces.",
            memoryType: "user_preference",
            confidence: 0.99,
            action: "forget"
          }
        ]
      };

      const result = await service.processConversationForMemories({
        currentMessage: "Forget that I prefer tabs over spaces.",
        userId: "baris"
      });

      expect(result.retracted).toContain(seeded.memoryId);

      // Check Firestore status
      const updated = await memoryRepo.getMemoryRecordByMemoryId(seeded.memoryId);
      expect(updated?.status).toBe("retracted");

      // Check vector store
      expect(await vectorStore.count()).toBe(0);
    });

    it("strictly isolates user memories during extraction and retrieval", async () => {
      await service.createMemory({
        content: "User Alice prefers Dark Mode.",
        userId: "alice",
        memoryType: "user_preference"
      });

      const barisResults = await service.searchMemories("Dark Mode", "baris");
      expect(barisResults).toHaveLength(0);
    });

    it("rejects secrets and credentials at the privacy filter stage", async () => {
      mockAI.responseJson = {
        shouldRemember: true,
        memories: [
          {
            content: "Barış uses API key sk-proj-12345678901234567890123456 for production.",
            memoryType: "user_fact",
            confidence: 0.95,
            action: "create"
          }
        ]
      };

      const result = await service.processConversationForMemories({
        currentMessage: "Here is my key: sk-proj-12345678901234567890123456",
        userId: "baris"
      });

      expect(result.created).toHaveLength(0);
      expect(result.rejected).toHaveLength(1);
      expect(result.rejected[0]!.reason).toContain("sensitive pattern");
      expect(await memoryRepo.listAllActive("baris")).toHaveLength(0);
    });
  });

  describe("MemoryService write decisions (shared with production via memory-write-planner)", () => {
    // Against [1, 0]: A scores 0.6, B 0.8, SAME 1.0, FAR 0.
    const vectors: Record<string, number[]> = {
      "Barış uses Jenkins for CI.": [3, 4],
      "Barış uses CircleCI for CI.": [4, 3],
      "Barış migrated CI to GitHub Actions.": [1, 0],
      "Barış likes tea with lemon.": [0, 1],
      "Barış uses GitHub Actions for CI.": [1, 0],
      "Barış uses GitHub Actions for CI builds.": [0.9, 0.3]
    };
    let memoryRepo: InMemoryMemoryRepository;
    let vectorStore: InMemoryVectorStore;
    let mockAI: MockAIProvider;
    let service: MemoryService;

    const extraction = { enabled: true, minConfidence: 0.75, maxContextMessages: 4, timeoutMs: 1000 };
    const makeService = (embeddingProvider: IEmbeddingProvider) => new MemoryService({
      memoryRepo,
      vectorStore,
      embeddingProvider,
      extractor: new MemoryExtractor({ provider: mockAI, config: extraction }),
      // Retrieval disabled on purpose: write decisions no longer depend on it.
      config: { retrieval: { enabled: false, topK: 3, minScore: 0.05, timeoutMs: 1000 }, extraction }
    });

    const turn = (memories: Array<{ content: string; action: string }>) => {
      mockAI.responseJson = {
        shouldRemember: true,
        memories: memories.map((m) => ({ ...m, memoryType: "technical_preference", confidence: 0.95 }))
      };
      return service.processConversationForMemories({ currentMessage: "x", userId: "baris" });
    };

    beforeEach(() => {
      memoryRepo = new InMemoryMemoryRepository();
      vectorStore = new InMemoryVectorStore();
      mockAI = new MockAIProvider();
      service = makeService(new TableEmbeddingProvider(vectors));
    });

    it("supersedes the first active match >= 0.5 in repository order, not the best one", async () => {
      const jenkins = await service.createMemory({ content: "Barış uses Jenkins for CI.", userId: "baris" });
      await service.createMemory({ content: "Barış uses CircleCI for CI.", userId: "baris" });

      const result = await turn([{ content: "Barış migrated CI to GitHub Actions.", action: "supersede" }]);

      expect(result.superseded).toEqual([{ oldMemoryId: jenkins.memoryId, newMemoryId: result.created[0]!.memoryId }]);
      expect(result.created[0]!.supersedesMemoryId).toBe(jenkins.memoryId);
      expect((await memoryRepo.getMemoryRecordByMemoryId(jenkins.memoryId))?.status).toBe("superseded");
    });

    it("forget retracts the best active match, found in the repository even with retrieval disabled", async () => {
      await service.createMemory({ content: "Barış uses Jenkins for CI.", userId: "baris" });
      const circle = await service.createMemory({ content: "Barış uses CircleCI for CI.", userId: "baris" });

      const result = await turn([{ content: "Barış uses GitHub Actions for CI.", action: "forget" }]);

      expect(result.retracted).toEqual([circle.memoryId]);
      expect((await memoryRepo.getMemoryRecordByMemoryId(circle.memoryId))?.status).toBe("retracted");
    });

    it("uses the fixed 0.85 duplicate threshold, and a memory written earlier in the turn counts", async () => {
      const result = await turn([
        { content: "Barış uses GitHub Actions for CI.", action: "create" },
        { content: "Barış uses GitHub Actions for CI builds.", action: "create" }, // cos ~0.949
        { content: "Barış uses CircleCI for CI.", action: "create" } // cos 0.8: kept
      ]);

      expect(result.created.map((m) => m.content)).toEqual(["Barış uses GitHub Actions for CI.", "Barış uses CircleCI for CI."]);
      expect(result.skippedDuplicates).toEqual(["Barış uses GitHub Actions for CI builds."]);
    });

    it("a supersede candidate is never dropped as a duplicate", async () => {
      const old = await service.createMemory({ content: "Barış uses GitHub Actions for CI.", userId: "baris" });
      const result = await turn([{ content: "Barış uses GitHub Actions for CI.", action: "supersede" }]);
      expect(result.skippedDuplicates).toEqual([]);
      expect(result.superseded).toEqual([{ oldMemoryId: old.memoryId, newMemoryId: result.created[0]!.memoryId }]);
    });

    it("only compares memories embedded by the same model", async () => {
      await service.createMemory({ content: "Barış uses GitHub Actions for CI.", userId: "baris" });
      service = makeService(new TableEmbeddingProvider(vectors, "other-model"));

      const result = await turn([{ content: "Barış uses GitHub Actions for CI.", action: "create" }]);

      expect(result.skippedDuplicates).toEqual([]);
      expect(result.created).toHaveLength(1);
    });

    it("drops a candidate whose active-memory read fails instead of writing blind", async () => {
      memoryRepo.shouldFail = true;
      const result = await turn([{ content: "Barış likes tea with lemon.", action: "create" }]);
      expect(result.created).toEqual([]);
      memoryRepo.shouldFail = false;
      expect(await memoryRepo.listAllActive("baris")).toEqual([]);
    });
  });
});
