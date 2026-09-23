import { describe, it, expect } from "vitest";
import { MockEmbeddingProvider } from "../../src/ai/embedding/mock-embedding-provider.js";
import { OllamaEmbeddingProvider } from "../../src/ai/embedding/ollama-embedding-provider.js";
import { GeminiEmbeddingProvider } from "../../src/ai/embedding/gemini-embedding-provider.js";
import { cosineSimilarity } from "../../src/data/vector/cosine-similarity.js";


/** Request body the Gemini provider sends to :embedContent. */
interface GeminiEmbedContentBody {
  content: { parts: Array<{ text: string }> };
  outputDimensionality: number;
}

/** Request body the Gemini provider sends to :batchEmbedContents. */
interface GeminiBatchEmbedBody {
  requests: Array<{ outputDimensionality: number }>;
}

describe("Embedding Providers", () => {
  describe("MockEmbeddingProvider", () => {
    it("generates deterministic normalized vectors", async () => {
      const provider = new MockEmbeddingProvider({ dimension: 128 });
      const vec1 = await provider.embed("Barış prefers TypeScript");
      const vec2 = await provider.embed("Barış prefers TypeScript");

      expect(vec1).toHaveLength(128);
      expect(vec1).toEqual(vec2);

      // Verify L2 norm is ~1.0
      const norm = Math.sqrt(vec1.reduce((sum, v) => sum + v * v, 0));
      expect(norm).toBeCloseTo(1.0, 4);
    });

    it("gives high cosine similarity for semantically overlapping text", async () => {
      const provider = new MockEmbeddingProvider({ dimension: 256 });
      const doc = await provider.embed("Barış prefers TypeScript for application development");
      const relevantQuery = await provider.embed("What programming language does Barış prefer?");
      const irrelevantQuery = await provider.embed("How to bake a chocolate strawberry cake in Paris?");

      const simRelevant = cosineSimilarity(doc, relevantQuery);
      const simIrrelevant = cosineSimilarity(doc, irrelevantQuery);

      expect(simRelevant).toBeGreaterThan(simIrrelevant);
      expect(simRelevant).toBeGreaterThan(0.1);
    });

    it("rejects empty text", async () => {
      const provider = new MockEmbeddingProvider();
      await expect(provider.embed("   ")).rejects.toThrow("Cannot embed empty text");
    });

    it("embedBatch embeds multiple sentences", async () => {
      const provider = new MockEmbeddingProvider({ dimension: 64 });
      const batch = await provider.embedBatch(["Sentence one", "Sentence two"]);
      expect(batch).toHaveLength(2);
      expect(batch[0]).toHaveLength(64);
      expect(batch[1]).toHaveLength(64);
    });

    it("throws explicit error when shouldFail is true", async () => {
      const provider = new MockEmbeddingProvider({ shouldFail: true, failureMessage: "Provider offline" });
      await expect(provider.embed("Test")).rejects.toThrow("Provider offline");
    });
  });

  describe("OllamaEmbeddingProvider", () => {
    it("isConfigured returns true when baseUrl and model are present", () => {
      const provider = new OllamaEmbeddingProvider({
        config: {
          baseUrl: "http://127.0.0.1:11434",
          model: "nomic-embed-text"
        }
      });
      expect(provider.isConfigured()).toBe(true);
    });

    it("calls /api/embed and parses multi-input embeddings", async () => {
      const mockFetch: typeof fetch = async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            model: "nomic-embed-text",
            embeddings: [[0.1, 0.2, 0.3]]
          })
        } as unknown as Response;
      };

      const provider = new OllamaEmbeddingProvider({
        config: {
          baseUrl: "http://mock-ollama:11434",
          model: "nomic-embed-text",
          dimension: 3
        },
        fetchFn: mockFetch
      });

      const embedding = await provider.embed("Hello Alfred");
      expect(embedding).toEqual([0.1, 0.2, 0.3]);
    });

    it("handles Ollama API errors with descriptive exceptions", async () => {
      const mockFetch: typeof fetch = async () => {
        return {
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
          text: async () => "model 'missing' not found"
        } as unknown as Response;
      };

      const provider = new OllamaEmbeddingProvider({
        config: {
          baseUrl: "http://mock-ollama:11434",
          model: "missing"
        },
        fetchFn: mockFetch
      });

      await expect(provider.embed("Test")).rejects.toThrow();
    });
  });

  describe("GeminiEmbeddingProvider", () => {
    it("isConfigured returns false when apiKey is empty, true when set", () => {
      const unconfigured = new GeminiEmbeddingProvider({ apiKey: "" });
      expect(unconfigured.isConfigured()).toBe(false);

      const configured = new GeminiEmbeddingProvider({ apiKey: "test-gemini-key" });
      expect(configured.isConfigured()).toBe(true);
      expect(configured.dimension).toBe(768);
      expect(configured.id).toBe("gemini");
    });

    it("rejects empty text", async () => {
      const provider = new GeminiEmbeddingProvider({ apiKey: "test-gemini-key" });
      await expect(provider.embed("   ")).rejects.toThrow("Cannot embed empty text");
    });

    it("calls embedContent and parses 768-dim embedding", async () => {
      let capturedUrl = "";
      let capturedBody: GeminiEmbedContentBody | null = null as GeminiEmbedContentBody | null;

      const mockFetch: typeof fetch = async (url, init) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(init?.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            embedding: {
              values: [0.12, -0.34, 0.56]
            }
          })
        } as unknown as Response;
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: "test-gemini-key",
        model: "gemini-embedding-001",
        dimension: 3,
        fetchFn: mockFetch
      });

      const res = await provider.embed("Barış'ın tercihi TypeScript");
      expect(res).toEqual([0.12, -0.34, 0.56]);
      expect(capturedUrl).toContain("models/gemini-embedding-001:embedContent");
      expect(capturedUrl).toContain("key=test-gemini-key");
      expect(capturedBody?.content.parts[0].text).toBe("Barış'ın tercihi TypeScript");
      expect(capturedBody?.outputDimensionality).toBe(3);
    });

    it("calls batchEmbedContents and parses multiple embeddings", async () => {
      let capturedUrl = "";
      let capturedBody: GeminiBatchEmbedBody | null = null as GeminiBatchEmbedBody | null;
      const mockFetch: typeof fetch = async (url, init) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(init?.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            embeddings: [
              { values: [0.1, 0.2] },
              { values: [0.3, 0.4] }
            ]
          })
        } as unknown as Response;
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: "test-gemini-key",
        fetchFn: mockFetch
      });

      const res = await provider.embedBatch(["Birinci cümle", "İkinci cümle"]);
      expect(res).toEqual([[0.1, 0.2], [0.3, 0.4]]);
      expect(capturedUrl).toContain("models/gemini-embedding-001:batchEmbedContents");
      expect(capturedBody?.requests[0].outputDimensionality).toBe(768);
    });

    it("handles API error status gracefully", async () => {
      const mockFetch: typeof fetch = async () => {
        return {
          ok: false,
          status: 403,
          statusText: "Forbidden",
          text: async () => "API key invalid"
        } as unknown as Response;
      };

      const provider = new GeminiEmbeddingProvider({
        apiKey: "bad-key",
        fetchFn: mockFetch
      });

      await expect(provider.embed("Test")).rejects.toThrow("API key invalid");
    });
  });
});

