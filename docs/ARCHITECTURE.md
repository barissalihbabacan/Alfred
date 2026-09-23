# Architecture Principles — B.U.T.L.E.R. Alfred

This document defines the core architecture principles, directory boundaries, and separation of concerns for B.U.T.L.E.R. Alfred, and describes how the system actually runs in production today. Where a directory exists but is still an empty placeholder, it is marked **(planned)**.

Operational detail (commands, CI, secrets handling, which modules are shared with production) lives in `CLAUDE.md`; this document is about structure and invariants.

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
                                        MacBook Ollama over Tailscale        ◄── only if ALFRED_LLM_PROVIDER=ollama
                                            │  tool calls: get_current_time (the only tool offered;
                                            │  server access over SSH is not connected)
                                            ▼
                                        SSE stream back to the browser
                                        then memory extraction (≤ 10 s) → Firestore memory_vectors
```

- **One HTTP entry point.** Everything server-side runs in the `api` function. The web app is a static export with no route handlers or SSR.
- **`functions/index.js` is bundled with `src/`.** esbuild builds it into `functions/lib/index.js` together with the shared `src/` modules it imports: the system prompt and user profile, memory-extraction prompt and candidate validation, `PrivacyFilter`, cosine similarity, conversation titles, the `get_current_time` tool, and the embedding calls (`src/ai/embedding/embedding-client.ts`). The rest of `functions/index.js` (chiefly Firestore memory persistence) is still hand-written and separate from its `src/` counterparts.
- **Secrets** (`GROQ_API_KEY`, `GEMINI_API_KEY`) live only in Secret Manager and are bound to the function. The browser never sees or sends a key.

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
     - In production, the files are embedded at build time. `npm run generate:user-profile` writes `src/alfred/cognitive/context/user-profile.generated.ts`, and a unit test fails if it drifts from `users/*.md`. The profile block is rendered by the pure `renderUserProfileBlock()`.
     - Locally, `UserProfileLoader` reads the files from disk, falling back to the embedded copy.
     - Editing `users/*.md` reaches production on the next deploy.
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
- **`IEmbeddingProvider` (`types.ts`)**: Minimal contract: `embed(text) → number[]`, `embedBatch(texts) → number[][]`, `isConfigured()`.
- **`GeminiEmbeddingProvider` (`gemini-embedding-provider.ts`)**: The default. It uses `gemini-embedding-001` with `outputDimensionality` pinned to 768. Production calls the same model through `generateEmbedding()` in `embedding-client.ts` (Gemini, then Ollama `nomic-embed-text`, then an error), a pure module the functions bundle imports; both build the request with its `buildGeminiEmbedContentRequest()`.
- **`OllamaEmbeddingProvider` (`ollama-embedding-provider.ts`)**: Optional local alternative via Ollama's `/api/embed` (`nomic-embed-text`). Its configuration is separate from the chat model's.
- **`MockEmbeddingProvider` (`mock-embedding-provider.ts`)**: Deterministic, dependency-free embeddings using token/n-gram feature hashing for unit tests.
- **`getEmbeddingProvider()` (`factory.ts`)**: Embedding provider factory, selected by `EMBEDDING_PROVIDER` (default `gemini`).

#### Memory Data Flow & Autonomous Extraction

```
Conversation Exchange (User Message + Assistant Response)
                                ↓
        Extraction after the reply is complete (does not delay the reply)
                                ↓
        Isolated classification prompt (buildMemoryExtractionSystemPrompt)
                                ↓
                   Structured Candidate Memories (JSON)
                                ↓
   Validation (validateMemoryCandidate + PrivacyFilter, confidence ≥ 0.70)
                                ↓
             Deduplication & Supersession (cosine on embeddings)
      ┌─────────────────────────┼─────────────────────────┐
      │                         │                         │
[Duplicate Detected]    [Explicit Forget]        [Supersede / Create]
      │                         │                         │
(Skip / Suppress)        (Retract record)       (Mark old superseded, write new)
                                                          ↓
                                   Firestore memory_vectors record (with embedding)
```

- **Production timing:** The `api` function sends the `done` SSE event first, then awaits extraction inside a 10-second budget before closing the connection. It does not leave extraction running after the response: Cloud Run throttles CPU once a response ends, and that used to lose memories. The web app releases the composer on `done`, so the user never waits for this step.
- **Shared rules:** The candidate rules are shared between `src/` and production (`src/ai/prompts/memory-extraction.ts`):
  - trimmed content of at least 5 characters;
  - a finite confidence ≥ 0.70 (numeric strings accepted);
  - actions limited to `create` / `supersede` / `forget`, with anything else treated as `create`;
  - `memoryType` limited to the nine prompt types, with anything else stored as `general`;
  - invalid entries skipped without aborting the rest.
- **Persistence still differs:** Production writes inline to Firestore. `src/` uses `MemoryService`, which also indexes into the vector store.

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
  - the `users/*.md` profile (`=== CANONICAL USER PROFILE (GIT AUTHORITATIVE) ===`);
  - the Conversational Governor, which states the request pipeline for that provider;
  - the retrieved memories block (`=== RETRIEVED LONG-TERM MEMORIES (SEMANTIC CONTEXT) ===`), when there are any.
- **`UserProfileLoader` (`src/alfred/cognitive/context/user-profile-loader.ts`)**: Returns the raw profile files, reading from disk with a per-file fallback to the embedded copy.
- **`ContextBuilder` (`src/alfred/cognitive/context/context-builder.ts`)**: Assembles the same sections for `src/` callers. With the files unchanged and the same runtime, it produces exactly production's prompt. It also provides `buildChatMessages()`, which combines the system prompt, bounded recent history and the current message.
- **`MemoryService` (`src/alfred/cognitive/memory/memory-service.ts`)**: Orchestrates the `src/` memory pipeline:
  - create: embed → Firestore → vector index;
  - search: embed query → vector search → score threshold → top-K;
  - rebuild the index from Firestore (`reindexAll()`);
  - retract memories;
  - `processConversationForMemories()`: extraction, validation, privacy filtering, deduplication and supersession.
- **`MemoryExtractor` (`src/alfred/cognitive/memory/extractor/memory-extractor.ts`)**: Implements `IMemoryExtractor` with an `AIProvider`.
- **Conversational Governor**: A behavioural block enforcing:
  - intent-driven response length (1–3 sentences for casual banter, deep analysis for technical diagnosis);
  - restrained dry humour and firm first-principles pushback;
  - reasoning strictly from the known pipeline;
  - no corporate or customer-service boilerplate.
- **Spoken delivery**: Replies are read aloud by the browser. The persona therefore forbids markdown in ordinary dialogue (tables, code fences, headings, bullet or numbered lists) unless Barış asks for it (see `docs/persona/ALFRED_PERSONA.md`, Section 7, "Speech-Ready Formatting").

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
- **GitHub, Gmail, Calendar, Files, Browser, Terminal, Web Search, External APIs** (planned): Directories exist, but they are empty.

Production offers the model exactly one tool: `get_current_time`, shared with `src/ai/tools/time/` (its resolver folds Turkish and accented spellings and drops country suffixes).

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

- **Production voice:** The browser reads replies aloud with `speechSynthesis`, so there is no server-side TTS runtime. The local Kokoro/ONNX engine was removed.
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
- **Structured logs.** The `api` function emits JSON events to Cloud Logging: `llm_request`, `tool_call`, `memory_retrieval` and `memory_extraction`. They cover tokens, latency, time to first token, scores and outcomes, and never include API keys, ID tokens or user message text. Query them with `jsonPayload.event="llm_request"`.
