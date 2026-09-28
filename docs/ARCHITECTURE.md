# Architecture Principles — B.U.T.L.E.R. Alfred

This document defines the core architecture principles, directory boundaries, and separation of concerns for B.U.T.L.E.R. Alfred, and describes how the system actually runs in production today. Where a directory exists but is still an empty placeholder, it is marked **(planned)**.

Operational detail lives in `CLAUDE.md` (commands, CI, the rules) and `docs/PRODUCTION_INTERNALS.md` (the full production behaviour, secrets handling, and which modules are shared with production); this document is about structure and invariants.

---

## Production at a Glance

```
Browser — Next.js static export (apps/web/out)
   │  Google Sign-In (single allowed UID) + App Check
   │  POST /api/chat   Authorization: Bearer <Firebase ID token>
   ▼
Firebase Hosting ── /api/** rewrite ──►  Cloud Function 2nd Gen `api` (functions/index.js, Cloud Run)
                                            │  verifies ID token + UID, loads history (Firestore)
                                            │  embeds the message (Gemini) → cosine over memory_vectors
                                            │  builds the system prompt (shared src/ module)
                                            ▼
                                        Groq API (openai/gpt-oss-120b)      ◄── default
                                          ↓ unavailable, nothing streamed yet
                                        Gemini (gemini-3.8-flash) → OpenRouter (openai/gpt-oss-120b)
                                          (Cerebras gpt-oss-120b / qwen-3.8-27b configured but not in
                                           the default order: account returns 402 payment_required)
                                        MacBook Ollama over Tailscale        ◄── only if ALFRED_LLM_PROVIDER=ollama
                                            │  tool calls: get_current_time (the only tool offered;
                                            │  server access over SSH is not connected)
                                            ▼
                                        SSE stream back to the browser
                                        then memory extraction (≤ 10 s) → Firestore memory_vectors
```

- **One HTTP entry point.** Everything server-side runs in the `api` function. The web app is a static export with no route handlers or SSR.
- **`functions/index.js` is bundled with `src/`.** esbuild builds it into `functions/lib/index.js` together with the shared `src/` modules it imports: the system prompt and user profile, memory-extraction prompt and candidate validation, `PrivacyFilter`, cosine similarity, conversation titles, the `get_current_time` tool, the embedding calls (`src/ai/embedding/embedding-client.ts`), the memory extraction pipeline and its Groq → Gemini → Ollama calls (`extraction-pipeline.ts`, `extraction-providers.ts`, driven by `functions/memory-extraction.js`) and the memory write loop and decisions (`memory-write-loop.ts`, `memory-write-planner.ts`, driven by `functions/memory-persistence.js`). Only the Firestore storage layer and the logging around them are hand-written in `functions/`.
- **Secrets** (`GROQ_API_KEY`, `GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY`) live only in Secret Manager and are bound to the function. The browser never sees or sends a key.

---

## ALFRED

The `src/alfred/` directory contains Alfred's domain and cognitive architecture.

It should remain as vendor-independent as reasonably possible, shielding the core personality and reasoning logic from specific external provider APIs and vendor lock-in.

---

## Cognitive Layer

The Cognitive Layer (`src/alfred/cognitive/`) represents Alfred's understanding of:

- **Context** (implemented): Current operational environment, user state, and task scope.
- **Memory** (implemented): Durable semantic memories across interactions.
- **Projects** (planned): High-level initiatives, goals, and trackable milestones.
- **Decisions** (planned): Historical choices, rationale, and decision boundaries.
- **Dependencies** (planned): Prerequisites, blockers, and inter-task relationships.
- **Attention** (planned): Prioritization focus, interrupt handling, and relevance filtering.

### Canonical User Profile Layer (`users/`)
The `users/` directory represents Alfred's equivalent of a long-term local "disk" storing consciously authored, version-controlled knowledge about its primary user (Barış).

#### Tripartite Storage Model & Single Source of Truth (SSOT)
Alfred rigorously separates storage responsibilities across three distinct tiers:

1. **Git / Local Repository (`users/`) — Canonical Authored Truth**:
   - Contains stable, consciously authored, version-controlled baseline knowledge about Barış (`USER_PROFILE.md`), communication preferences (`PREFERENCES.md`), and working style (`WORKING_STYLE.md`).
   - **Runtime Status**: Read-only. Alfred never commits, rewrites, or mutates these files at runtime.
     - The system prompt carries a **reviewed digest** of the files, not the files verbatim: `src/alfred/cognitive/context/user-profile.digest.md`, hand-written from them (~620 tokens instead of ~2,000). The digest keeps the facts and rules that change Alfred's answers and leaves out what the persona and governor already say. Its header records the sha256 of each `users/*.md` file it was written from.
     - In production, the files and the digest are embedded at build time. `npm run generate:user-profile` writes `src/alfred/cognitive/context/user-profile.generated.ts`, and a unit test fails if it drifts from `users/*.md`.
     - Locally, `UserProfileLoader` reads the files from disk, falling back to the embedded copy. `ContextBuilder` uses the digest when the files are the committed ones. Other sources are rendered verbatim by `renderUserProfileBlock()`.
     - Editing `users/*.md` blocks the deploy until the digest is updated. The unit tests, `npm run generate:user-profile` and `functions/build.js` all fail while the digest's hashes are stale, and they print the new hash lines. Update the digest text, paste the hashes, and the edit reaches production on the next deploy.
   - **Authority**: Definitive baseline. Trumps vague conversational inferences.
2. **Firestore (`src/data/firestore/`) — Dynamic Operational State, Conversation History & Memory Source of Truth**:
   - Stores durable conversation records and messages across restarts and sessions:
     - `conversations/{conversationId}`: `userId`, `title`, `messageCount`, timestamps.
     - `conversations/{conversationId}/messages/{messageId}`: `role`, `content`, atomic `sequence` (1..N), `status` (`completed` | `interrupted` | `error`), provider/model metadata.
   - **Long-term Memory Historical Records**:
     - `memory_vectors/{memoryVectorId}`: `memoryId`, `userId`, `content`, `memoryType`, `sourceConversationId`, `sourceMessageIds`, `embeddingProvider`, `embeddingModel`, `embeddingDimension`, `embedding` (the vector itself), `vectorStore`, `vectorId`, `status` (`active` | `superseded` | `retracted`), `supersedesMemoryId`, `indexStatus` (`pending` | `indexed` | `failed`), timestamps.
     - Every memory has an authoritative Firestore record.
   - Provides transactional atomic sequence allocation, bounded context-window retrieval (last 10 messages), deterministic title generation, and user isolation. In production, every read and write is scoped to the ID token's UID.
   - **Authority**: Authoritative for runtime conversation history, long-term memory records, and operational state; non-authoritative for canonical user profile and persona rules.
3. **Vector Store (`src/data/vector/`) — Rebuildable Semantic Retrieval Index**:
   - Stores dense vector embeddings for semantic nearest-neighbour retrieval of long-term memories.
   - **Implementation**: `LocalFileVectorStore` is a self-hosted, persistent, JSON-backed local vector store with in-memory cosine similarity search. It is used by `src/`'s `MemoryService` locally. **Production does not use it**: the `api` function stores each embedding on its `memory_vectors` document and ranks active memories by cosine similarity directly (top 5, minimum score 0.35), comparing only vectors from the same embedding model.
   - **Architecture invariant**: The vector store is **never** the source of truth. It is a semantic index that can be purged and rebuilt at any time from Firestore historical records using `npm run memory:reindex`.
   - **Authority**: Purely non-authoritative search cache.

#### Data Layer Abstraction

**Conversation Persistence (`src/data/firestore/`)**:
- **`IConversationRepository` (`conversation-repository.interface.ts`)**: Pure abstract contract decoupling conversation persistence from database drivers.
- **`FirestoreConversationRepository` (`firestore-conversation-repository.ts`)**: Firestore implementation using transactions for atomic sequence numbers and subcollection ordering.
- **`InMemoryConversationRepository` (`in-memory-conversation-repository.ts`)**: In-memory repository so the unit suite runs with zero credentials and no emulator.
- **`generateDeterministicTitle` (`conversation-title.ts`)**: Conversation titles; shared with production.
- **`getConversationRepository()` (`factory.ts`)**: Repository factory detecting credentials/environment and providing the active repository singleton.

**Memory Persistence (`src/data/firestore/`)**:
- **`IMemoryRepository` (`memory-repository.interface.ts`)**: Contract isolating Firestore memory record persistence from business logic.
- **`FirestoreMemoryRepository` (`firestore-memory-repository.ts`)**: Persists canonical memory content, embedding metadata, and indexing status to the `memory_vectors` collection.
- **`InMemoryMemoryRepository` (`in-memory-memory-repository.ts`)**: In-memory repository for offline unit testing.
- **`getMemoryRepository()` (`memory-factory.ts`)**: Memory repository factory.

**Vector Store (`src/data/vector/`)**:
- **`IVectorStore` (`types.ts`)**: Minimal interface for upsert, search, delete, and count operations with mandatory user partitioning.
- **`InMemoryVectorStore` (`in-memory-vector-store.ts`)**: Dependency-free vector store for unit tests.
- **`LocalFileVectorStore` (`local-file-vector-store.ts`)**: Persistent JSON-backed vector store with atomic file writes for local development.
- **`cosineSimilarity` (`cosine-similarity.ts`)**: Shared with production. Vectors of different lengths score 0.
- **`getVectorStore()` (`factory.ts`)**: Vector store factory.

**Embedding Provider (`src/ai/embedding/`)**:
- **`IEmbeddingProvider` (`types.ts`)**: Minimal contract: `embed(text) → number[]`, `embedBatch(texts) → number[][]`, `isConfigured()`. It also has an optional `embedDetailed(text) → { values, model, provider }` for providers whose model can vary per call. Callers use `embedWithModel()`, which falls back to `embed` + the provider's static `model`. `MemoryService` records that real model on every write and compares only same-model vectors on searches and write planning.
- **`FallbackEmbeddingProvider` (`fallback-embedding-provider.ts`)**: What the factory returns for the default Gemini configuration. It wraps production's `generateEmbedding()`: Gemini first, then Ollama `nomic-embed-text` when `EMBEDDING_BASE_URL` / `OLLAMA_BASE_URL` is set, then an error. It falls back when Gemini returns non-OK, returns no values, throws or times out. `embedDetailed` reports which model answered.
- **`GeminiEmbeddingProvider` (`gemini-embedding-provider.ts`)**: The default. It uses `gemini-embedding-001` with `outputDimensionality` pinned to 768. Production calls the same model through `generateEmbedding()` in `embedding-client.ts` (Gemini, then Ollama `nomic-embed-text`, then an error), a pure module the functions bundle imports; both build the request with its `buildGeminiEmbedContentRequest()`.
- **`OllamaEmbeddingProvider` (`ollama-embedding-provider.ts`)**: Optional local alternative via Ollama's `/api/embed` (`nomic-embed-text`). Its configuration is separate from the chat model's.
- **`MockEmbeddingProvider` (`mock-embedding-provider.ts`)**: Deterministic, dependency-free embeddings using token/n-gram feature hashing for unit tests.
- **`getEmbeddingProvider()` (`factory.ts`)**: Embedding provider factory, selected by `EMBEDDING_PROVIDER` (default `gemini`). For `gemini` with the default model it returns `FallbackEmbeddingProvider` when a Gemini key or an Ollama URL is configured. A custom `EMBEDDING_MODEL` gets the plain `GeminiEmbeddingProvider`. When nothing is configured it returns the mock.

#### Memory Data Flow & Autonomous Extraction

```
Conversation Exchange (User Message + Assistant Response)
                                ↓
        Extraction after the reply is complete (does not delay the reply)
                                ↓
   Short-circuit: empty message or exact "don't remember this" → no model call
                                ↓
   Isolated classification prompt over the last 10 messages (planMemoryExtraction)
                                ↓
        Groq → Gemini → Ollama (callMemoryExtractionProviders)
                                ↓
                   Structured Candidate Memories (JSON)
                                ↓
   Validation (validateMemoryCandidate + PrivacyFilter, confidence ≥ 0.70)
                                ↓
   Embed candidate → re-read active memory_vectors → planMemoryWrite (shared)
      ┌─────────────────────────┼─────────────────────────┐
      │                         │                         │
[Duplicate Detected]    [Explicit Forget]        [Supersede / Create]
      │                         │                         │
(Skip / Suppress)        (Retract record)       (Mark old superseded, write new)
                                                          ↓
                                   Firestore memory_vectors record (with embedding)
```

- **Production timing:** The `api` function sends the `done` SSE event first, then awaits extraction inside a 10-second budget before closing the connection. It does not leave extraction running after the response: Cloud Run throttles CPU once a response ends, and that used to lose memories. The web app releases the composer on `done`, so the user never waits for this step.
- **Shared extraction pipeline:** `runMemoryExtraction` (`src/alfred/cognitive/memory/extractor/extraction-pipeline.ts`) is what production (`functions/memory-extraction.js`) and `MemoryExtractor` both run:
  - an empty user message, or exactly "don't remember this", "do not remember this", "bunu hatırlama" or "sakın kaydetme" (trimmed, lower-cased), is answered locally with nothing to remember. The prompt demands the same answer for these, so this only saves the call. Production logs it as `outcome: "nothing"` with `skip_reason`;
  - the prompt sees the last `maxContextMessages` messages (default 10: production's chat history window, so production passes its history unchanged; src used to default to 6);
  - the model call is `callMemoryExtractionProviders`: Groq `MEMORY_EXTRACTION_MODEL`, then Gemini `GEMINI_EXTRACTION_MODEL`, then Ollama `/api/chat`, with fetch, keys and URLs injected. An Ollama answer whose content is not a string counts as no answer (it used to throw);
  - the answer is parsed by `parseMemoryExtractionPayload` (`extractJsonPayload` → `JSON.parse` → `getMemoryExtractionCandidates`).
  - `tests/unit/memory-extraction-pipeline.test.ts` runs 8,000 randomized turns against a verbatim copy of the former production code. Every turn outside the two changes above must be identical: fetches, timeouts, logs, persist calls, result. A second test checks, on 3,000 turns, that `MemoryExtractor` sends the same requests as production and accepts the same candidates.
- **Shared rules:** The candidate rules are shared between `src/` and production (`src/ai/prompts/memory-extraction.ts`):
  - trimmed content of at least 5 characters;
  - a finite confidence ≥ 0.70 (numeric strings accepted);
  - actions limited to `create` / `supersede` / `forget`, with anything else treated as `create`;
  - `memoryType` limited to the nine prompt types, with anything else stored as `general`;
  - invalid entries skipped without aborting the rest.
- **Shared write decisions:** `runMemoryWriteLoop` (`src/alfred/cognitive/memory/memory-write-loop.ts`) walks the candidates for production (`functions/memory-persistence.js`) and `MemoryService` alike: validation, `PrivacyFilter`, embedding, a fresh read of the active memories, then `planMemoryWrite` (`src/alfred/cognitive/memory/memory-write-planner.ts`) decides, and the caller's storage ports carry it out. For every candidate the loop embeds the content and re-reads the user's active memories, so a memory written, superseded or retracted earlier in the same turn is (or no longer is) part of the next decision. Only memories whose stored embedding is non-empty and was made by the same model are compared (`isComparableEmbedding`):
  - `forget` retracts the **best** match (highest cosine, the earliest on ties) if it scores ≥ 0.5; otherwise nothing happens;
  - `create` and `supersede` are first skipped as a duplicate when **any** active memory, whatever model embedded it (or with no embedding at all), has exactly the same normalized content (`normalizeMemoryContent`: trimmed, whitespace collapsed, lower-cased). This is what catches a fact re-stated on a Gemini→Ollama fallback turn, whose vectors are not comparable. No cosine threshold is used here;
  - `create` is then skipped as a duplicate as soon as **any** comparable match scores ≥ 0.85;
  - `supersede` then marks the **best** comparable match scoring ≥ 0.5 (highest cosine; on ties the earliest in store order, i.e. Firestore document-id order) as `superseded` (`supersededByMemoryId`) and writes the new memory with `supersedesMemoryId`. There is deliberately no cosine dedup for supersede, because a legitimate update can be semantically very close to the fact it replaces. With no match it is a plain create.
  - Production's record is `buildMemoryVectorRecord` (`vectorStore: "firestore"`, `indexStatus: "indexed"`, one server timestamp for `createdAt` / `updatedAt` / `indexedAt`); the per-candidate outcomes feed the `memory_extraction` event (`stored`, `superseded`, `retracted`, `duplicate`, `rejected`, `invalid`, `failed`). `functions/memory-persistence.js` logs `memory_id`, `memory_type` and `content_length` (plus `match` / `score` for duplicates), never memory text.
  - `tests/unit/memory-write-planner.test.ts` has explicit tests for each rule. It also runs 8,000 randomized turns against a verbatim copy of the pre-fix inline loop: behaviour must be identical on every turn the fixes don't touch, and every turn must satisfy the fixed invariants. A second 8,000-turn run compares against a verbatim copy of `memory-persistence.js` from before the loop moved to src, with no exclusions. A third checks, on 2,000 turns, that `MemoryService` reaches the same tally, statuses and new records as production and logs no memory text.
- **Only the storage layer differs, on purpose.** Production keeps the vector inside the Firestore record. It writes the finished record as `indexed`, and on supersede it commits the old record's `superseded` update and the new record in **one batch**, so both land or neither does. `MemoryService` writes through `IMemoryRepository` (`indexStatus: "pending"` → `"indexed"`) and then indexes into a separate vector store, the rebuildable cache. The repository and the vector store can't share a transaction, so on supersede it writes the new record first and marks the old one afterwards. A failure in between leaves both active, a recoverable duplicate, but never loses the old fact. Timing also differs: production's 10 s budget covers extraction and persistence, while `MemoryExtractor`'s timeout covers only the model call.

#### Core Architectural Distinctions & Invariants

1. **Conversation History ≠ Long-Term Memory**:
   - Conversation history records everything that was said verbatim.
   - Long-term memory records only durable facts, preferences, constraints, workflows, and decisions that remain useful across future sessions. Chit-chat, greetings, questions, and transient statements are discarded.

2. **Memory Extraction ≠ Conversational Persona**:
   - The extraction subsystem operates on a dedicated classification prompt completely isolated from Alfred's persona.
   - Assistant (Alfred) statements are never attributed to the user.
   - The user never sees extraction prompts, reasoning, or metadata.

3. **Firestore ≠ Vector Store**:
   - Firestore is the sole authoritative source of truth. Every memory has a durable document in `memory_vectors`.
   - The vector store is a rebuildable semantic index. If corrupted or wiped, it can be regenerated at any time with `npm run memory:reindex`.

4. **Git Profile ≠ Runtime Memory**:
   - Files in `users/` are canonical, Git-versioned, and read-only at runtime.
   - Autonomous memory extraction never touches or rewrites Git files. Dynamic runtime memory lives strictly in Firestore.

5. **Secrets never become memories**:
   - `PrivacyFilter` rejects candidates containing credentials before anything is persisted. It covers API keys (including Groq `gsk_` and Google `AIza` / `AQ.` formats), GitHub/GitLab/Slack tokens, bearer tokens, JWTs, private keys, password or secret assignments, and Turkish şifre/parola statements.

**Failure Boundaries**:
- Embedding failure → no Firestore record, no vector created.
- Firestore failure → no vector created (no orphaned vectors).
- Vector indexing failure (`src/`) → Firestore record preserved with `indexStatus: "failed"`, re-indexable.
- Extraction failure or timeout → logged as a `memory_extraction` event; the reply the user already received is unaffected.
- Memory retrieval failure → the turn proceeds without memories.

#### Runtime Context Integration
- **System prompt (`src/ai/prompts/alfred-system-prompt.ts`)**: Production and `src/` both call `buildAlfredSystemPrompt({ runtime, memories })`. It joins, in order:
  - the persona, which states the provider and model answering the turn;
  - the `users/*.md` digest (`=== CANONICAL USER PROFILE (GIT AUTHORITATIVE) ===`);
  - the Conversational Governor, which states the request pipeline for that provider;
  - the retrieved memories block (`=== RETRIEVED LONG-TERM MEMORIES (SEMANTIC CONTEXT) ===`), when there are any.

  **Size.** The whole prompt is re-sent on every model call. A question that uses a tool makes two calls, and Groq's free tier for `openai/gpt-oss-120b` allows 8,000 tokens a minute. The static prompt is about 2,110 tokens (o200k_base; ~2,160 with web search): persona ~850 (including the Turkish-register rule), digest ~620, governor ~640. Before the Sep 2026 trim it was about 4,360, so one tool question could exceed the limit on its own; dropping the butler role-play later that month saved another ~230.

  `tests/unit/system-prompt-budget.test.ts` enforces a cap of 2,400 tokens static and 2,800 with five retrieved memories, counted with the `gpt-tokenizer` devDependency. It also lists the rules that must survive any trim.

  Each rule appears once, in the persona, the governor or the digest. The second call of a tool round re-sends the same messages plus the tool call and its result, without the tool definitions. There is nothing duplicated to drop: the memories appear only once, inside the system prompt.
- **`UserProfileLoader` (`src/alfred/cognitive/context/user-profile-loader.ts`)**: Returns the raw profile files, reading from disk with a per-file fallback to the embedded copy.
- **`ContextBuilder` (`src/alfred/cognitive/context/context-builder.ts`)**: Assembles the same sections for `src/` callers. With the files unchanged and the same runtime, it produces exactly production's prompt. It also provides `buildChatMessages()`, which combines the system prompt, bounded recent history and the current message.
- **`MemoryService` (`src/alfred/cognitive/memory/memory-service.ts`)**: Orchestrates the `src/` memory pipeline:
  - create: embed → Firestore → vector index;
  - search: embed query → vector search → score threshold → top-K;
  - rebuild the index from Firestore (`reindexAll()`);
  - retract memories;
  - `processConversationForMemories()`: extraction, then production's `runMemoryWriteLoop` against `memoryRepo.listAllActive()` (the repository, not the vector store), with its own writes and vector indexing as storage ports. The result carries production's `tally`.
- **`MemoryExtractor` (`src/alfred/cognitive/memory/extractor/memory-extractor.ts`)**: Implements `IMemoryExtractor` on the shared extraction pipeline. By default it calls production's Groq → Gemini → Ollama chain with keys from the environment; the `provider` option (an `AIProvider`) or `call` option replaces it.
- **Conversational Governor**: A behavioural block enforcing:
  - intent-driven response length (1–3 sentences for casual banter, deep analysis for technical diagnosis);
  - restrained dry humour and firm first-principles pushback;
  - reasoning strictly from the known pipeline;
  - no corporate or customer-service boilerplate.
- **Chat formatting**: Replies are rendered as markdown in the chat (not read aloud). The persona allows only what `apps/web/lib/markdown.ts` renders (bold, italic, inline code, code blocks, bulleted and numbered lists, http(s) links), keeps conversation as prose, and forbids headings and tables (see `docs/persona/ALFRED_PERSONA.md`, Section 7, "Chat Formatting").

---

## Control Plane

The Control Plane (`src/alfred/control-plane/`) is responsible for:

- **Tool routing** (implemented): `ToolRegistry` holds `ITool` implementations. `ToolRouter` resolves the tool, checks permissions, parses and validates arguments, and executes it.
- **Permissions** (implemented): `PermissionManager` enforces a least-privilege role policy; a missing role counts as `guest`:
  - `READ_ONLY`: anyone;
  - `SAFE_READ` / `WRITE`: owner or admin;
  - `EXECUTE`: owner only;
  - `DESTRUCTIVE`: owner only, and only with explicit confirmation.

  This governs `src/` tools. Production tools are single-user behind the ID-token gate.
- **Planning** (planned): Decomposition of goals into ordered, executable steps.
- **Scheduler** (planned): Recurring jobs, asynchronous timeouts, and cron schedules.
- **Event processing** (planned): Ingesting, filtering, and dispatching inbound events.

---

## Execution Plane

The Execution Plane (`src/alfred/execution-plane/`) contains capabilities Alfred can execute through tools and integrations:

- **SSH** (implemented): `ssh2`-based client with a mock for tests, connection manager, an allow-listed command registry (`list_directory`, `disk_usage`, `current_directory`, `identity`, `system_info`), path sandbox, and `ls` parser. Hosts are referred to by alias (`home-server`), never by raw credentials in tool arguments.
- **GitHub, Gmail, Calendar, Files, Browser, Terminal, External APIs** (planned): Directories exist, but they are empty.

Production offers the model `get_current_time`, and `web_search` (Tavily, `src/ai/tools/web/web-search.ts`) when a Tavily key is configured. `get_current_time` is shared with `src/ai/tools/time/` (its resolver folds Turkish and accented spellings and drops country suffixes).

**SSH is not connected in production.** The `api` function has no SSH connection. The `ssh_*` tools used to return canned output (a fixed `Belgeler/` listing, `df`, `pwd`, `whoami` and `uname` snapshots), which Alfred presented as real server state. They were therefore removed from the tool list:
- An unexpected `ssh_*` call gets `Tool … not recognized.`
- The persona tells Alfred to say plainly that server access is not connected, and never to invent connection results, listings, disk figures or command output.
- `buildAlfredSystemPrompt({ sshAvailable: true })` restores the SSH instructions for a caller that really executes them.

The SSH execution plane above (ssh2 client, host registry, `SSHPathSandbox`, `ls` parser) and the tool definitions in `src/ai/tools/ssh/ssh-tool-definitions.ts` stay available to the `src/` tools. Wiring real SSH into production (for example over Tailscale, with credentials in Secret Manager) is a separate design decision.

---

## AI Layer & Provider Abstraction

The `src/ai/` directory contains:

- **Tools** (implemented): Tool definitions, function schemas, and execution wrappers (`ssh/`, `time/`).
- **Prompts** (implemented): The shared system prompt, persona, and memory-extraction prompts.
- **Providers** (implemented, `src/ai/providers/`): Provider-agnostic abstractions and concrete implementations.
- **Embedding** (implemented, `src/ai/embedding/`): See above.
- **Agents** (planned): Autonomous agent loops and subagent orchestration.
- **Middleware** (planned): Rate limiting, token tracking, and guardrails.

*The AI layer should orchestrate Alfred rather than becoming Alfred's permanent state store.*

### Provider Architecture
Alfred's cognitive core interacts exclusively through the `AIProvider` and `AIChatProvider` interfaces (`src/ai/providers/types.ts`). Concrete providers are resolved via `getAIProvider()` (`src/ai/providers/factory.ts`), switched by `ALFRED_LLM_PROVIDER`:

```
Alfred Cognitive Core
         │
         ▼
  AI Provider Interface
         │
    ┌────┴─────────────────────────┬──────────────────────────┬──────────────────┐
    ▼                              ▼                          ▼                  ▼
  Groq (Default, Cloud)       Ollama (Optional)          OpenAI (Planned)   Anthropic / Google (Planned)
 openai/gpt-oss-120b         gemma4:12b-mlx on the
 + Whisper STT adapter       MacBook via Tailscale
```

- **Groq** (`src/ai/providers/groq/`):
  - The default provider (`ALFRED_LLM_PROVIDER=groq`, `GROQ_MODEL` defaults to `openai/gpt-oss-120b`), with streaming completions and tool calling.
  - Also carries a Whisper speech-to-text adapter (`whisper-large-v3-turbo`), which production does not use.
- **Ollama** (`src/ai/providers/ollama/`):
  - An optional local provider running `gemma4:12b-mlx` on the MacBook over the private Tailscale network.
  - Supports native chat completions, NDJSON streaming, parameter mapping and health diagnostics.
  - Only in the request path when `ALFRED_LLM_PROVIDER=ollama`.
- **Production chat fallback** (`src/ai/providers/chat-fallback/`, bundled into `functions/index.js`): Groq, Gemini (OpenAI-compatible endpoint), Cerebras (gpt-oss-120b, then qwen-3.8-27b; not in the default order `DEFAULT_CHAT_PROVIDER_ORDER` until its billing is set up) and OpenRouter all speak the OpenAI Chat Completions streaming format, so one request builder, one SSE parser and one tool loop serve them. A turn moves to the next provider only while nothing has been streamed to the user; it then restarts from the user's message with a system prompt that names the new provider. Details and the failover matrix are in `docs/PRODUCTION_INTERNALS.md` (**Chat provider fallback**). This path does not go through `getAIProvider()`; the `src/` Groq/Ollama providers are unchanged.
- **Vendor Independence & Unified Factory**: Neither Alfred's persona nor its callers import a concrete provider directly; everything goes through `getAIProvider()`. The system prompt states whichever provider and model is actually answering.

### Real-Time Streaming & "Thinking..." Architecture

```
Browser (VoiceChatPlayground, apps/web)
       │
       │ POST /api/chat { message, conversationId }  + Authorization: Bearer <ID token>
       ▼
Cloud Function `api` (functions/index.js)
       │
       │ SSE frames: data: {json}\n\n
       ▼
start (conversationId, provider, model)
thinking            ← shown as a subtle "Thinking..." state; no reasoning content is exposed
chunk (text)*       ← progressive rendering; <think> traces are stripped client-side
tool_call / tool_result (per tool round)
rate_limited (provider, waitMs) ← only when the server really waits on a 429
provider_fallback (from, to, model, reason) ← before the turn restarts on the next provider
done                ← composer released here
error (error)       ← surfaced to the user, never swallowed
```

- **Parser:** `apps/web/lib/sse.ts` parses the stream, and `tests/unit/web-sse-parser.test.ts` pins the frame format.
- **Latency:** On Groq, time to first token is typically about 0.7–1.2 s. The `llm_request` log event records latency, time to first token and token usage for every turn.
- **Client state machine:** `Idle` ➔ `Sending` ➔ `Thinking` ➔ `Streaming` ➔ `Idle`. A per-turn guard keeps a late-closing stream from resetting a newer turn, since the server keeps the connection open after `done` for memory extraction.
- **Interruption preservation:** On network interruption or abort, text already received is kept and saved as an `interrupted` message, rather than being wiped by a generic error.

---

## Voice Layer

The `src/voice/` directory contains speech recognition and synthesis infrastructure:

- **STT (`src/voice/stt/`)**: Speech-to-text service interfaces. The Groq Whisper adapter lives in the Groq provider. Production does not use server-side STT: speech input is the browser's Web Speech API (`SpeechRecognition`).
- **TTS (`src/voice/tts/`)**: Text-to-speech abstraction.
  - `types.ts`: Normalized `AudioData`, `ITTSProvider`, `VoiceProfile`, and streaming `TTSChunk` definitions.
  - `service.ts`: The `TTSService` facade, coordinating profiles, engine dispatch, and OS-level audio playback (`paplay`, `aplay`, `afplay`).
  - `profiles/alfred.ts`: `ALFRED_DEFAULT_VOICE_PROFILE` (en-GB, British, formal butler, calm, restrained).
  - `providers/mock/`: A deterministic mock provider.
- **Audio (`src/voice/audio/`)**: Audio data structures and 16-bit PCM WAV encoding utilities.

### TTS Provider Abstraction
Alfred does not couple to any specific speech engine. The persona defines *how Alfred speaks* (voice profile and speech-ready phrasing); the engine defines *how text becomes audio*:

```
Alfred Persona / Output Channel
              │
              ▼
   VoiceProfile (ALFRED_DEFAULT)
              │
              ▼
      TTSService Facade
              │
              ▼
     ITTSProvider Interface
              │
    ┌─────────┴──────────────────────┬──────────────────────┬─────────────┐
    ▼                                ▼                      ▼             ▼
Mock / Local (Testing)          ElevenLabs (Planned)    OpenAI (Planned)   Azure (Planned)
```

- **Production voice:** Voice input only (browser `SpeechRecognition`). Replies are not read aloud: the browser `speechSynthesis` playback was removed on 27 Sep 2026, and there is no server-side TTS runtime (the local Kokoro/ONNX engine was removed earlier).
- **Pluggable:** `ITTSProvider` allows a cloud TTS service to be added later without touching the persona.

---

## Data Layer

The `src/data/` directory represents persistence and data-access abstractions:

- **Firestore** (implemented): The remote document store and source of truth for conversations and memories.
- **Vector** (implemented): The local, rebuildable vector store for `src/`.
- **GraphQL, Repositories, Schemas** (planned): Directories exist, but they are empty.

*Keep persistence implementation details separated from Alfred's domain logic.*

---

## Integrations

The `src/integrations/` directory is reserved for external-service clients, authentication, and provider-specific adapters. Its subdirectories (`firestore`, `github`, `gmail`, `google-calendar`, `graphql`, `web`) are currently empty **(planned)**. Integrations translate generic execution requests into vendor-specific API calls.

---

## Security & Observability

- **Single user.** Google Sign-In only, and any account other than the allowed UID is signed out. Server-side, every `/api` endpoint except `/` and `/health` requires a valid Firebase ID token for that UID:
  - no token or an invalid token → 401;
  - wrong UID → 403;
  - a conversation owned by another user → 404.

  App Check (reCAPTCHA Enterprise) tokens are attached to requests and verified when present.
- **Structured logs.** The `api` function emits JSON events to Cloud Logging: `llm_request` (with `fallback_from` / `attempted_providers`), `llm_provider_fallback`, `llm_rate_limited`, `tool_call`, `memory_retrieval` and `memory_extraction`. They cover tokens, latency, time to first token, scores and outcomes, and never include API keys, ID tokens or user message text. Query them with `jsonPayload.event="llm_request"`.
