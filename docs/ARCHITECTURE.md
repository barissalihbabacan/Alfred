# Architecture Principles — B.U.T.L.E.R. Alfred

This document defines the core architecture principles, directory boundaries, and separation of concerns for B.U.T.L.E.R. Alfred.

---

## ALFRED

The `src/alfred/` directory contains Alfred's domain and cognitive architecture.

It should remain as vendor-independent as reasonably possible, shielding the core personality and reasoning logic from specific external provider APIs and vendor lock-in.

---

## Cognitive Layer

The Cognitive Layer (`src/alfred/cognitive/`) represents Alfred's understanding of:

- **Context**: Current operational environment, user state, and task scope.
- **Memory**: Episodic, semantic, and working memories across interactions.
- **Projects**: High-level initiatives, goals, and trackable milestones.
- **Decisions**: Historical choices, rationale, and decision boundaries.
- **Dependencies**: Prerequisites, blockers, and inter-task relationships.
- **Attention**: Prioritization focus, interrupt handling, and relevance filtering.

### Canonical User Profile Layer (`users/`)
The `users/` directory represents Alfred's equivalent of a long-term local "disk" storing consciously authored, version-controlled knowledge about its primary user (Barış).

#### Tripartite Storage Model & Single Source of Truth (SSOT)
Alfred rigorously separates storage responsibilities across three distinct tiers:

1. **Git / Local Repository (`users/`) — Canonical Authored Truth**:
   - Contains stable, consciously authored, version-controlled baseline knowledge about Barış (`USER_PROFILE.md`), communication preferences (`PREFERENCES.md`), and working style (`WORKING_STYLE.md`).
   - **Runtime Status**: Strictly read-only (`fs.readFileSync`). Alfred never commits, rewrites, or mutates these files at runtime.
   - **Authority**: Definitive baseline. Trumps vague conversational inferences.
2. **Firestore (`src/data/firestore/`) — Dynamic Operational State & Persistent Conversation History**:
   - Stores durable conversation records and messages across restarts and sessions:
     - `conversations/{conversationId}`: `userId`, `title`, `messageCount`, timestamps.
     - `conversations/{conversationId}/messages/{messageId}`: `role`, `content`, atomic `sequence` (1..N), `status` (`completed` | `interrupted` | `error`), provider/model metadata.
   - Provides transactional atomic sequence allocation, bounded context window retrieval (`MAX_CONTEXT_MESSAGES = 10`), deterministic title generation, and user isolation.
   - **Authority**: Authoritative for runtime conversation history and operational state; non-authoritative for canonical user profile and persona rules.
3. **Vector Database (Future Milestone) — Semantic Retrieval Index**:
   - Stores searchable embeddings across documents and past conversations for semantic nearest-neighbor retrieval.
   - **Authority**: Purely non-authoritative search cache. Can be purged and rebuilt at any time without data loss.

#### Data Layer Abstraction (`src/data/firestore/`)
- **`IConversationRepository` (`conversation-repository.interface.ts`)**: Pure abstract contract decoupling conversation persistence from database drivers.
- **`FirestoreConversationRepository` (`firestore-conversation-repository.ts`)**: Production implementation leveraging Firestore transactions for atomic sequence numbers and subcollection ordering.
- **`InMemoryConversationRepository` (`in-memory-conversation-repository.ts`)**: In-memory test repository ensuring full unit test suite passes with zero credentials and zero emulator dependencies.
- **`getConversationRepository()` (`factory.ts`)**: Dynamic repository factory detecting credentials/environment and providing the active repository singleton.

#### Runtime Context Integration
- **`UserProfileLoader` (`src/alfred/cognitive/context/user-profile-loader.ts`)**: Resolves and parses markdown profile files with safe fallbacks if files are missing or unreadable.
- **`ContextBuilder` (`src/alfred/cognitive/context/context-builder.ts`)**: Injects the canonical profile into Alfred's system prompt using explicit markdown boundaries (`=== CANONICAL USER PROFILE (GIT AUTHORITATIVE) ===`), ensuring Alfred internalizes user context naturally without parroting instructions. Also provides `buildChatMessages()` combining system prompt, bounded recent history from Firestore, and current user message.
- **Conversational Governor**: A behavioral governance block synthesized by `ContextBuilder` (`formatGovernorBlock()`) enforcing intent-driven response length (1–3 sentences for casual banter vs. deep technical diagnosis), restrained dry humour, firm First Principles pushback, and the elimination of corporate/customer-service boilerplate.

---

## Control Plane

The Control Plane (`src/alfred/control-plane/`) is responsible for:

- **Planning**: Decomposition of goals into ordered, executable steps.
- **Tool routing**: Determining appropriate execution channels and tool selection.
- **Scheduler**: Managing recurring jobs, asynchronous timeouts, and cron schedules.
- **Event processing**: Ingesting, filtering, and dispatching inbound events.
- **Permissions**: Enforcing security boundaries, user approval gates, and authority tiers.

---

## Execution Plane

The Execution Plane (`src/alfred/execution-plane/`) contains capabilities Alfred can execute through tools and integrations:

- **GitHub**: Repository management, pull requests, issue tracking, and actions.
- **Gmail**: Email triage, drafting, reading, and inbox management.
- **Calendar**: Event scheduling, conflict detection, and agenda management.
- **Files**: Local workspace filesystem interaction and document processing.
- **Browser**: Automated web interaction, navigation, and page inspection.
- **Terminal**: Shell command execution and script invocation.
- **Web Search**: Information discovery and web queries.
- **External APIs**: Third-party API invocations and REST/GraphQL interactions.

---

## AI Layer & Provider Abstraction

The `src/ai/` directory contains:

- **Agents**: Autonomous agent loops and subagent orchestration.
- **Tools**: Tool definitions, function schemas, and tool execution wrappers.
- **Prompts**: System instructions, persona guidelines, and templated prompts.
- **Providers (`src/ai/providers/`)**: Provider-agnostic abstractions and concrete implementations.
- **Middleware**: Rate limiting, token tracking, logging, and guardrails.

*The AI layer should orchestrate Alfred rather than becoming Alfred's permanent state store.*

### Provider Architecture
Alfred's cognitive core interacts exclusively through the `AIProvider` and `AIChatProvider` interfaces (`src/ai/providers/types.ts`). Concrete providers are resolved dynamically via the `providerRegistry` and `getAIProvider()` factory (`src/ai/providers/factory.ts`):

```
Alfred Cognitive Core
         │
         ▼
  AI Provider Interface
         │
    ┌────┴────────────────────────┬──────────────────────┬─────────────┐
    ▼                             ▼                      ▼             ▼
  Ollama (Local Default)     Groq (Cloud / STT)     OpenAI (Planned)   Anthropic / Google
(gemma4:12b-mlx via Tailscale) (LPU Inference & Whisper)
```

- **Supported Providers**:
  - **Ollama Provider** (`src/ai/providers/ollama/`): Default local LLM provider running `gemma4:12b-mlx` over private Tailscale network (`http://100.64.0.53:11434`), supporting native chat completions, real-time NDJSON streaming, parameter mapping, and health diagnostics.
  - **Groq Cloud** (`src/ai/providers/groq/`): Cloud provider leveraging fast LPU inference (`llama-3.3-70b-versatile`), streaming completions, and Whisper-based Speech-to-Text (`whisper-large-v3-turbo`).
- **Vendor Independence & Unified Factory**: Neither Alfred's persona nor API routes import providers directly. All components depend on `AIProvider` through `getAIProvider()` (`src/ai/providers/factory.ts`), switchable via `ALFRED_LLM_PROVIDER=ollama` or `ALFRED_LLM_PROVIDER=groq`.

### Real-Time Streaming & "Thinking..." Architecture
B.U.T.L.E.R. Alfred incorporates a real-time text streaming pipeline supporting progressive token rendering and transparent reasoning states:

```
Browser (Playground UI)
       │
       │ POST /api/chat { message, history, stream: true }
       ▼
Server-Sent Events (SSE) Route (`apps/web/app/api/chat/route.ts`)
       │
       │ AsyncIterable<ChatStreamChunk>
       ▼
AIProvider.streamChat() (Ollama / Groq)
       │
       ├─► Gemma 4 internal reasoning tokens (message.thinking)
       │     └─► SSE Event: { "type": "thinking" } (NO internal thoughts exposed)
       │           └─► UI State: "Thinking..." (subtle pulsing indicator)
       │
       └─► First content token arrives (TTFT ~25s after thinking phase)
             └─► SSE Event: { "type": "chunk", "text": "..." }
                   └─► UI State: "Streaming" (instant transition, progressive rendering)
```

- **Thinking Isolation**: Gemma 4 models emit internal reasoning chains (via `message.thinking` or `<thought>` structures). The pipeline guarantees zero leakage: internal thoughts are strictly trapped, filtered out, and used solely to drive the subtle "Thinking..." UI state.
- **Client State Machine**: `Idle` ➔ `Sending` ➔ `Thinking` (pulsing indicator in chat bubble) ➔ `Streaming` (progressive markdown rendering) ➔ `Idle` (completion).
- **Interruption Preservation**: In case of network interruption or stream abortion, previously received text is retained (`[Response interrupted]`) rather than wiped out with a generic error dialog.
- **Safe Markdown Rendering**: Incomplete markdown tokens (e.g. unclosed `**` or code fences) gracefully render as plain text until the closing boundary arrives, ensuring no broken syntax or layout thrashing.

---

## Voice Layer & Local TTS Architecture

The `src/voice/` directory contains speech recognition and synthesis infrastructure:

- **STT (`src/voice/stt/`)**: Speech-to-Text service interfaces and provider adapters (e.g., bridging Groq Whisper).
- **TTS (`src/voice/tts/`)**: Local and cloud Text-to-Speech synthesis pipeline.
  - `types.ts`: Normalized `AudioData`, `ITTSProvider`, `VoiceProfile`, and streaming `TTSChunk` definitions.
  - `service.ts`: `TTSService` facade coordinating profiles, engine dispatch, and OS-level audio playback (`paplay`, `aplay`, `afplay`).
  - `profiles/alfred.ts`: Decoupled `ALFRED_DEFAULT_VOICE_PROFILE` (en-GB, British, formal-butler, calm, restrained).
  - `providers/kokoro/`: Local offline neural TTS powered by Kokoro-82M ONNX runtime.
- **Audio (`src/voice/audio/`)**: Audio stream capturing, buffering, and device input/output (planned).

### TTS Provider Abstraction
Alfred does not couple directly to Kokoro. The high-level persona defines *how Alfred speaks* (voice profile), while the TTS engine defines *how text converts into audio waveforms*:

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
 Kokoro-82M (Local, Initial)    ElevenLabs (Planned)    OpenAI (Planned)   Azure (Planned)
(100% Offline, q8 ONNX)
```

- **Initial Local Model**: **Kokoro-82M** (`onnx-community/Kokoro-82M-v1.0-ONNX`) running locally via ONNX Runtime CPU.
- **Selected Voice**: **`bm_george`** — British English (en-GB) mature male Received Pronunciation with a calm, dignified, and restrained butler cadence.
- **Streaming Design**: `synthesizeStream` supports token/sentence chunking (`TextSplitterStream`) for future real-time LLM streaming speech synthesis.
- **Zero Cloud Dependence**: Requires no paid API keys or internet connection once the ONNX weights (~85MB) are cached locally.

---

## Data Layer

The `src/data/` directory represents persistence and data-access abstractions:

- **Firestore**: Remote document store for persistent cloud synchronization.
- **Vector**: Local vector database for semantic search and memory embeddings.
- **GraphQL**: Structured data queries and type schemas.
- **Repositories**: Abstract repository pattern implementations decoupling data access from business logic.
- **Schemas**: Data contracts, validation rules, and entity types.

*Keep persistence implementation details separated from Alfred's domain logic.*

---

## Integrations

The `src/integrations/` directory contains external-service clients, authentication, API adapters, and provider-specific implementation details. Integrations translate generic execution requests into vendor-specific API calls.
