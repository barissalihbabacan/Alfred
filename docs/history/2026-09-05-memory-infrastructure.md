# B.U.T.L.E.R. Alfred — Long-Term Memory Milestone Report

> [!WARNING]
> **Historical report (5 Sep 2026), kept for the record. It does not describe the current system.** For how memory works today, read [ARCHITECTURE.md → Memory Data Flow & Autonomous Extraction](../ARCHITECTURE.md#memory-data-flow--autonomous-extraction) and the memory invariants in [CLAUDE.md](../../CLAUDE.md).
>
> What changed since this report:
>
> | Then | Now (24 Sep 2026) |
> | :--- | :--- |
> | Memory retrieval in the Next.js route `apps/web/app/api/chat/route.ts` | That route was removed (#15). Production memory runs in the `api` Cloud Function (`functions/index.js`), which bundles the shared `src/` modules. |
> | `OllamaEmbeddingProvider` (`nomic-embed-text`) | Gemini `gemini-embedding-001`, 768 dimensions (#6); Ollama is only a fallback. |
> | "No autonomous extraction" | Done: see the [6 Sep report](2026-09-06-autonomous-memory-extraction.md); later on its own model `gpt-oss-20b` with a Gemini fallback (#40, #47). |
> | Next steps: dedup and supersession | Done, with one shared planner and an atomic supersede (#36, #38). |
> | Next step: memory management UI | Not built yet. |
> | "No commits have been made" | Committed in 84aca3e. |

> **Milestone**: Embeddings & Vector Database Infrastructure
> **Status**: ✅ Complete — awaiting review
> **Date**: 2026-09-05

---

## Verification Summary

| Check | Status |
|-------|--------|
| Unit Tests (14 files, 115 tests) | ✅ All passing |
| TypeScript Typecheck (`tsc --noEmit`) | ✅ Clean |
| Production Build (`build:web`) | ✅ Clean |
| `.gitignore` updated (`.data/`) | ✅ |
| `docs/ARCHITECTURE.md` updated | ✅ |
| `.env.example` updated | ✅ |

---

## Architecture

```mermaid
graph TD
    subgraph "Cognitive Layer"
        MS["MemoryService"]
        CB["ContextBuilder"]
    end

    subgraph "Data Layer"
        FR["FirestoreMemoryRepository"]
        VS["LocalFileVectorStore"]
    end

    subgraph "AI Layer"
        EP["OllamaEmbeddingProvider"]
    end

    API["/api/chat POST"] --> MS
    MS --> EP
    MS --> FR
    MS --> VS
    MS --> CB
    CB --> |"system prompt with memories"| API

    style FR fill:#4285f4,color:#fff
    style VS fill:#34a853,color:#fff
    style EP fill:#fbbc05,color:#000
```

**Invariant**: Firestore = source of truth. Vector DB = rebuildable index.

---

## Files Created (25 new)

### Core Infrastructure
| File | Purpose |
|------|---------|
| [memory.config.ts](../../src/core/config/memory.config.ts) | Embedding, vector store, retrieval configuration |
| [embedding/types.ts](../../src/ai/embedding/types.ts) | `IEmbeddingProvider` interface |
| [ollama-embedding-provider.ts](../../src/ai/embedding/ollama-embedding-provider.ts) | Ollama `/api/embed` + `/api/embeddings` fallback |
| [mock-embedding-provider.ts](../../src/ai/embedding/mock-embedding-provider.ts) | Deterministic token+3-gram feature hashing |
| [embedding/factory.ts](../../src/ai/embedding/factory.ts) | Embedding provider factory |
| [embedding/index.ts](../../src/ai/embedding/index.ts) | Barrel exports |
| [vector/types.ts](../../src/data/vector/types.ts) | `IVectorStore`, `VectorRecord`, search types |
| [cosine-similarity.ts](../../src/data/vector/cosine-similarity.ts) | Cosine similarity math utility |
| [in-memory-vector-store.ts](../../src/data/vector/in-memory-vector-store.ts) | In-memory vector store (test/runtime) |
| [local-file-vector-store.ts](../../src/data/vector/local-file-vector-store.ts) | Persistent JSON vector store with atomic writes |
| [vector/factory.ts](../../src/data/vector/factory.ts) | Vector store factory |
| [vector/index.ts](../../src/data/vector/index.ts) | Barrel exports |
| [memory.types.ts](../../src/data/firestore/memory.types.ts) | `MemoryVectorDocument`, `MemoryType`, `MemoryStatus` |
| [memory-repository.interface.ts](../../src/data/firestore/memory-repository.interface.ts) | `IMemoryRepository` interface |
| [in-memory-memory-repository.ts](../../src/data/firestore/in-memory-memory-repository.ts) | In-memory test repository |
| [firestore-memory-repository.ts](../../src/data/firestore/firestore-memory-repository.ts) | Firestore `memory_vectors` collection |
| [memory-factory.ts](../../src/data/firestore/memory-factory.ts) | Memory repository factory |

### Cognitive Memory Service
| File | Purpose |
|------|---------|
| [memory/types.ts](../../src/alfred/cognitive/memory/types.ts) | `CreateMemoryInput`, `RetrievedMemory`, search options |
| [memory-service.ts](../../src/alfred/cognitive/memory/memory-service.ts) | Full pipeline: create, search, reindex, retract |
| [memory/index.ts](../../src/alfred/cognitive/memory/index.ts) | Barrel exports |

### Operational Script
| File | Purpose |
|------|---------|
| [reindex-memories.ts](../../scripts/reindex-memories.ts) | `npm run memory:reindex` — rebuild vector index from Firestore |

### Tests (4 new test files, 40 tests)
| File | Tests | Status |
|------|-------|--------|
| [vector-store.test.ts](../../tests/unit/vector-store.test.ts) | 11 | ✅ |
| [embedding-provider.test.ts](../../tests/unit/embedding-provider.test.ts) | 8 | ✅ |
| [memory-service.test.ts](../../tests/unit/memory-service.test.ts) | 15 | ✅ |
| [context-builder-memory.test.ts](../../tests/unit/context-builder-memory.test.ts) | 6 | ✅ |

---

## Files Modified (10)

| File | Change |
|------|--------|
| [.env.example](../../.env.example) | +12 memory/embedding/vector env vars |
| [.gitignore](../../.gitignore) | Added `.data/` |
| route.ts *(removed in #15)* | Memory retrieval step in POST handler (non-blocking) |
| [context-builder.ts](../../src/alfred/cognitive/context/context-builder.ts) | `formatMemoriesBlock()` + inject into system prompt |
| [config/index.ts](../../src/core/config/index.ts) | Export memory config |
| [firestore/factory.ts](../../src/data/firestore/factory.ts) | Export `hasFirestoreCredentials()` |
| [firestore/index.ts](../../src/data/firestore/index.ts) | Memory exports |
| [src/index.ts](../../src/index.ts) | Memory/vector/embedding barrel exports |
| [package.json](../../package.json) | `memory:reindex` script |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | Full memory system documentation |

---

## Failure Boundaries

| Failure | Behavior |
|---------|----------|
| Embedding provider down | `createMemory()` throws; no Firestore record created |
| Firestore down | No vector record created; no orphaned vectors |
| Vector store down | `searchMemories()` returns `[]`; chat continues normally |
| Vector index corrupt | `npm run memory:reindex` rebuilds entirely from Firestore |

---

## Known Limitations

> [!NOTE]
> - **Embedding model not pulled**: `nomic-embed-text` is configured but not yet installed on the Ollama server. Until pulled (`ollama pull nomic-embed-text`), the system uses `MockEmbeddingProvider` in tests only.
> - **No autonomous extraction**: This milestone delivers the infrastructure and programmatic `createMemory()` API. Automatic memory extraction from conversations is a future milestone.
> - **Mock similarity ceiling**: `MockEmbeddingProvider` uses feature hashing — cosine similarity between semantically related but differently-worded text peaks around ~0.19. Test thresholds are set accordingly.

---

## Next Steps (Future Milestones)

1. Pull `nomic-embed-text` on Ollama server and test real embeddings end-to-end
2. Implement autonomous memory extraction from conversations
3. Add memory management UI (view, retract, search memories)
4. Implement memory deduplication and supersession logic

