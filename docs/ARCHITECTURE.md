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
  Groq (Initial)          OpenAI (Planned)       Google (Planned)   Anthropic / Local
(LPU Inference & STT)
```

- **Initial Provider**: **Groq Cloud** (`src/ai/providers/groq/`) is configured as the initial provider, leveraging fast inference (`llama-3.3-70b-versatile` by default) and Whisper-based Speech-to-Text (`whisper-large-v3-turbo`).
- **Vendor Independence**: Neither Alfred's persona nor the control plane imports Groq directly. Any provider can be substituted or complemented via the `AI_PROVIDER` configuration variable or registry registration.

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
