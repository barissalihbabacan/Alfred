import { describe, it, expect, vi, afterEach } from "vitest";
import { FallbackEmbeddingProvider } from "../../src/ai/embedding/fallback-embedding-provider.js";
import { MockEmbeddingProvider } from "../../src/ai/embedding/mock-embedding-provider.js";
import { embedWithModel } from "../../src/ai/embedding/types.js";
import { getEmbeddingProvider, setEmbeddingProvider } from "../../src/ai/embedding/factory.js";
import { GeminiEmbeddingProvider } from "../../src/ai/embedding/gemini-embedding-provider.js";
import {
  EMBEDDING_UNAVAILABLE_MESSAGE,
  GEMINI_EMBEDDING_MODEL,
  OLLAMA_EMBEDDING_MODEL,
  type EmbeddingFetch,
  type GeminiEmbeddingError
} from "../../src/ai/embedding/embedding-client.js";
import { MemoryService } from "../../src/alfred/cognitive/memory/memory-service.js";
import { MemoryExtractor } from "../../src/alfred/cognitive/memory/extractor/memory-extractor.js";
import { InMemoryMemoryRepository } from "../../src/data/firestore/in-memory-memory-repository.js";
import { InMemoryVectorStore } from "../../src/data/vector/in-memory-vector-store.js";
import { InMemoryPendingEmbeddingStore } from "../../src/data/vector/in-memory-pending-embedding-store.js";
import type { AIProvider, ChatCompletionResponse } from "../../src/ai/providers/types.js";

// Deliberately different values per provider (so tests see which one
// answered)... except where a test needs identical numbers from both models
// to prove they are still never compared: see SAME_NUMBERS.
const GEMINI_VECTOR = [1, 0, 0];
const OLLAMA_VECTOR = [0, 1, 0];
const SAME_NUMBERS = { gemini: [0, 0, 1], ollama: [0, 0, 1] };

type Mode = "ok" | "http500" | "novalues" | "throw" | "hang";

/**
 * Fake fetch: Gemini answers per `state.gemini`, Ollama per `state.ollama`.
 * Records every call's host so tests can see which provider was hit.
 */
function fakeFetch(state: { gemini: Mode; ollama: Mode; vectors?: { gemini: number[]; ollama: number[] } }) {
  const calls: string[] = [];
  const respond = (mode: Mode, okBody: unknown, signal?: AbortSignal | null): Promise<Response> => {
    switch (mode) {
      case "ok": return Promise.resolve(new Response(JSON.stringify(okBody), { status: 200 }));
      case "http500": return Promise.resolve(new Response("boom", { status: 500 }));
      case "novalues": return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
      case "throw": return Promise.reject(new Error("network down"));
      case "hang": return new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("aborted")));
      });
    }
  };
  const fetchFn: EmbeddingFetch = (url, init) => {
    if (url.startsWith("https://generativelanguage.googleapis.com/")) {
      calls.push("gemini");
      return respond(state.gemini, { embedding: { values: state.vectors?.gemini ?? GEMINI_VECTOR } }, init.signal);
    }
    calls.push("ollama");
    return respond(state.ollama, { embeddings: [state.vectors?.ollama ?? OLLAMA_VECTOR] }, init.signal);
  };
  return { fetchFn, calls };
}

function provider(state: { gemini: Mode; ollama: Mode; vectors?: { gemini: number[]; ollama: number[] } }, ollamaUrl: string | null = "http://ollama:11434") {
  const f = fakeFetch(state);
  const geminiErrors: GeminiEmbeddingError[] = [];
  const p = new FallbackEmbeddingProvider({
    geminiApiKey: "test-key",
    ollamaUrl,
    fetchFn: f.fetchFn,
    timeoutMs: 20,
    onGeminiError: (e) => geminiErrors.push(e)
  });
  return { p, calls: f.calls, geminiErrors };
}

afterEach(() => {
  vi.unstubAllEnvs();
  setEmbeddingProvider(null);
});

describe("FallbackEmbeddingProvider (src mirror of production's Gemini -> Ollama path)", () => {
  it("uses Gemini when it answers, and records gemini-embedding-001", async () => {
    const { p, calls, geminiErrors } = provider({ gemini: "ok", ollama: "ok" });
    expect(await p.embedDetailed("Barış prefers tea.")).toEqual({ values: GEMINI_VECTOR, model: GEMINI_EMBEDDING_MODEL, provider: "gemini" });
    expect(calls).toEqual(["gemini"]);
    expect(geminiErrors).toEqual([]);
    expect(await p.embed("Barış prefers tea.")).toEqual(GEMINI_VECTOR);
  });

  for (const mode of ["http500", "throw", "hang", "novalues"] as const) {
    it(`falls back to Ollama when Gemini ${mode === "hang" ? "times out" : mode}, and records nomic-embed-text`, async () => {
      const { p, calls, geminiErrors } = provider({ gemini: mode, ollama: "ok" });
      expect(await p.embedDetailed("Barış prefers tea.")).toEqual({ values: OLLAMA_VECTOR, model: OLLAMA_EMBEDDING_MODEL, provider: "ollama" });
      expect(calls).toEqual(["gemini", "ollama"]);
      // Missing values fall back silently, as in production; failures are reported.
      expect(geminiErrors.map((e) => e.kind)).toEqual(mode === "novalues" ? [] : [mode === "http500" ? "http" : "exception"]);
    });
  }

  it("throws when Gemini and Ollama both fail", async () => {
    const { p, calls } = provider({ gemini: "http500", ollama: "http500" });
    await expect(p.embedDetailed("Barış prefers tea.")).rejects.toThrow(EMBEDDING_UNAVAILABLE_MESSAGE);
    expect(calls).toEqual(["gemini", "ollama"]);
  });

  it("throws without trying Ollama when no Ollama URL is configured", async () => {
    const { p, calls } = provider({ gemini: "http500", ollama: "ok" }, null);
    await expect(p.embedDetailed("Barış prefers tea.")).rejects.toThrow(EMBEDDING_UNAVAILABLE_MESSAGE);
    expect(calls).toEqual(["gemini"]);
  });

  it("isConfigured needs a Gemini key or an Ollama URL; empty text is rejected", async () => {
    expect(new FallbackEmbeddingProvider().isConfigured()).toBe(false);
    expect(new FallbackEmbeddingProvider({ ollamaUrl: "http://placeholder" }).isConfigured()).toBe(false);
    expect(new FallbackEmbeddingProvider({ ollamaUrl: "http://ollama:11434" }).isConfigured()).toBe(true);
    expect(new FallbackEmbeddingProvider({ geminiApiKey: " k " }).isConfigured()).toBe(true);
    await expect(provider({ gemini: "ok", ollama: "ok" }).p.embedDetailed("  ")).rejects.toThrow("empty text");
  });

  it("embedWithModel uses the static id/model for providers without embedDetailed", async () => {
    const mock = new MockEmbeddingProvider({ dimension: 8 });
    const e = await embedWithModel(mock, "Barış prefers tea.");
    expect(e).toEqual({ values: await mock.embed("Barış prefers tea."), model: "alfred-mock-embed-v1", provider: "mock" });
  });
});

describe("getEmbeddingProvider (live mode)", () => {
  const live = () => {
    vi.stubEnv("USE_LIVE_EMBEDDING_IN_TESTS", "true");
    vi.stubEnv("EMBEDDING_PROVIDER", "gemini");
    vi.stubEnv("EMBEDDING_MODEL", "");
    vi.stubEnv("EMBEDDING_BASE_URL", "");
    vi.stubEnv("OLLAMA_BASE_URL", "");
    vi.stubEnv("GEMINI_API_KEY", "");
    setEmbeddingProvider(null);
  };

  it("returns the Gemini -> Ollama fallback provider for the default Gemini model", () => {
    live();
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("OLLAMA_BASE_URL", "http://ollama:11434");
    expect(getEmbeddingProvider()).toBeInstanceOf(FallbackEmbeddingProvider);
  });

  it("uses the fallback provider with only Ollama configured, and mock with neither", () => {
    live();
    vi.stubEnv("OLLAMA_BASE_URL", "http://ollama:11434");
    expect(getEmbeddingProvider()).toBeInstanceOf(FallbackEmbeddingProvider);
    live();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getEmbeddingProvider()).toBeInstanceOf(MockEmbeddingProvider);
  });

  it("keeps the plain Gemini provider (no fallback) for a custom EMBEDDING_MODEL", () => {
    live();
    vi.stubEnv("GEMINI_API_KEY", "k");
    vi.stubEnv("EMBEDDING_MODEL", "models/some-other-embedding");
    expect(getEmbeddingProvider()).toBeInstanceOf(GeminiEmbeddingProvider);
  });
});

describe("MemoryService records the model that really produced each vector", () => {
  function setup(state: { gemini: Mode; ollama: Mode; vectors?: { gemini: number[]; ollama: number[] } }) {
    const { p } = provider(state);
    const memoryRepo = new InMemoryMemoryRepository();
    const vectorStore = new InMemoryVectorStore();
    const extraction = { enabled: true, minConfidence: 0.7, maxContextMessages: 4, timeoutMs: 1000 };
    let extractorResponse: unknown = { shouldRemember: false, memories: [] };
    const ai: AIProvider = {
      id: "mock-ai",
      name: "Mock AI",
      isConfigured: () => true,
      getSupportedModels: () => ({ chat: ["m"] }),
      chat: async (): Promise<ChatCompletionResponse> => ({ id: "x", content: JSON.stringify(extractorResponse), model: "m", role: "assistant" })
    } as AIProvider;
    const service = new MemoryService({
      memoryRepo,
      vectorStore,
      embeddingProvider: p,
      pendingStore: new InMemoryPendingEmbeddingStore(),
      extractor: new MemoryExtractor({ provider: ai, config: extraction }),
      config: { retrieval: { enabled: true, topK: 3, minScore: 0.1, timeoutMs: 1000 }, extraction }
    });
    const turn = (memories: Array<{ content: string; action: string }>) => {
      extractorResponse = { shouldRemember: true, memories: memories.map((m) => ({ ...m, memoryType: "user_preference", confidence: 0.95 })) };
      return service.processConversationForMemories({ currentMessage: "x", userId: "baris" });
    };
    return { service, memoryRepo, vectorStore, state, turn };
  }

  it("a createMemory served by the Ollama fallback is stored and indexed as nomic-embed-text", async () => {
    const { service, memoryRepo, vectorStore } = setup({ gemini: "http500", ollama: "ok" });
    const record = await service.createMemory({ userId: "baris", content: "Barış prefers tea." });

    expect(record).toMatchObject({ embeddingProvider: "ollama", embeddingModel: OLLAMA_EMBEDDING_MODEL, embeddingDimension: 3, embedding: OLLAMA_VECTOR });
    expect(await memoryRepo.getMemoryRecordByMemoryId(record.memoryId)).toMatchObject({ embeddingModel: OLLAMA_EMBEDDING_MODEL });
    expect((await vectorStore.get(record.vectorId))?.metadata).toMatchObject({ embeddingProvider: "ollama", embeddingModel: OLLAMA_EMBEDDING_MODEL });
  });

  it("search only compares vectors from the query's model (vector store and Firestore fallback)", async () => {
    const { service, vectorStore, state } = setup({ gemini: "http500", ollama: "ok", vectors: SAME_NUMBERS });
    const ollamaRecord = await service.createMemory({ userId: "baris", content: "Barış prefers tea." });

    // Ollama query: same model, found.
    expect((await service.searchMemories("tea?", "baris")).map((m) => m.memoryId)).toEqual([ollamaRecord.memoryId]);

    // Gemini back: the query vector is Gemini's, the stored one Ollama's.
    // Their numbers are identical (cosine 1.0) yet they must not be compared,
    // neither in the vector store nor in the Firestore fallback.
    state.gemini = "ok";
    expect(await service.searchMemories("tea?", "baris")).toEqual([]);
    const geminiRecord = await service.createMemory({ userId: "baris", content: "Barış drinks coffee." });
    expect(geminiRecord.embeddingModel).toBe(GEMINI_EMBEDDING_MODEL);
    expect((await service.searchMemories("tea?", "baris")).map((m) => m.memoryId)).toEqual([geminiRecord.memoryId]);
    await vectorStore.clear();
    expect((await service.searchMemories("tea?", "baris")).map((m) => m.memoryId)).toEqual([geminiRecord.memoryId]);
  });

  it("extraction plans against the real model: an Ollama vector never cosine-dedups against Gemini ones", async () => {
    const { service, memoryRepo, state, turn } = setup({ gemini: "ok", ollama: "ok", vectors: SAME_NUMBERS });
    await service.createMemory({ userId: "baris", content: "Barış prefers green tea." });

    // Identical numbers: a cosine duplicate (1.0) if the models were ignored.
    state.gemini = "http500";
    const result = await turn([{ content: "Barış likes green tea a lot.", action: "create" }]);
    expect(result.skippedDuplicates).toEqual([]);
    expect(result.created.map((m) => m.embeddingModel)).toEqual([OLLAMA_EMBEDDING_MODEL]);
    expect((await memoryRepo.listAllActive("baris")).map((m) => m.embeddingModel).sort()).toEqual([GEMINI_EMBEDDING_MODEL, OLLAMA_EMBEDDING_MODEL]);
  });
});
