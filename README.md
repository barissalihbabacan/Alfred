# B.U.T.L.E.R. Alfred

Barış's Unified Task, Logic, Execution & Reasoning

An AI-powered personal cognitive operations and executive assistant.

---

## Project Purpose

B.U.T.L.E.R. Alfred is designed to serve as a personal executive assistant and autonomous operations manager. Rooted in a calm, formal, and discreet British butler persona, Alfred orchestrates complex workflows, monitors ongoing projects, manages schedules and communications, and assists with cognitive load management across personal and technical domains.

---

## High-Level Architecture

The system is organized into modular layers ensuring vendor independence, strict separation of concerns, and clean boundary definitions:

- **Persona Layer (`src/alfred/persona/`)**: Governs conversational tone, British butler mannerisms, formal discretion, and dry humor.
- **Cognitive Layer (`src/alfred/cognitive/`)**: Manages Alfred's internal world model, tracking context, long-term and working memory, projects, decisions, dependencies, and attention priorities.
- **Control Plane (`src/alfred/control-plane/`)**: Coordinates planning, tool routing, task scheduling, asynchronous event processing, and security/permission enforcement.
- **Execution Plane (`src/alfred/execution-plane/`)**: Standardized execution capabilities for interacting with tools, systems, and external services.
- **AI Layer (`src/ai/`)**: Model-agnostic orchestration containing agent definitions, prompt templates, tool schemas, middleware, and a pluggable AI provider architecture (`src/ai/providers/`).
- **Voice Layer (`src/voice/`)**: Audio processing pipelines including Speech-to-Text (STT) and local Text-to-Speech (TTS) synthesis (`src/voice/tts/`).
- **Data Layer (`src/data/`)**: Persistence abstractions spanning Cloud Firestore, local vector databases, GraphQL, repositories, and data schemas.
- **Integrations (`src/integrations/`)**: External client adapters for GitHub, Google Workspace (Gmail, Calendar), web search, and communication services.
- **Web App (`apps/web/`)**: User interface dashboard for interaction, status visualization, and executive controls.

---

## Local TTS & Alfred Voice System

Alfred's voice is powered by a 100% offline, local neural TTS provider using **Kokoro-82M**:

- **Model**: `onnx-community/Kokoro-82M-v1.0-ONNX` (quantized `q8`, ~85MB).
- **Selected Voice**: **`bm_george`** — A calm, formal British English (en-GB) male butler voice with refined Received Pronunciation (RP), measured pacing, and restrained energy.
- **Voice Profile Abstraction**: `ALFRED_DEFAULT_VOICE_PROFILE` decouples persona vocal traits from engine specifics, allowing future provider replacement (OpenAI, ElevenLabs, Azure, local alternative models) without altering Alfred's speech persona.
- **Audio Output**: 24,000 Hz, 16-bit mono PCM formatted into standard RIFF/WAV files.
- **Streaming Ready**: `synthesizeStream` interface supports sentence/chunk streaming (`TextSplitterStream`) for low-latency conversational LLM piping.
- **Local Playback**: Automatic detection and playback through system tools (`paplay`, `aplay`, `afplay`).

### Running the TTS Verification Utility
```bash
# Synthesize all 6 canonical Alfred butler phrases to audio_output/alfred/
npm run test:tts

# Synthesize and play audio on available system output devices
npm run test:tts -- --play
```

---

## AI Provider Infrastructure (Groq Integration)

Alfred utilizes a provider-agnostic abstraction layer (`src/ai/providers/`). Application and cognitive logic interface with standard `AIProvider` contracts, enabling dynamic swapping or complementation of model backends without refactoring domain code.

- **Initial Provider**: **Groq Cloud** is integrated as the initial provider (`src/ai/providers/groq/`), offering ultra-fast inference:
  - Default Chat Model: `llama-3.3-70b-versatile` (configurable via `GROQ_MODEL`)
  - Speech-to-Text Model: `whisper-large-v3-turbo` (configurable via `GROQ_STT_MODEL`)
- **Future Providers**: Prepared for OpenAI, Google, Anthropic, and local model backends.

---

## Implementation Status

### Implemented
- **Repository Architecture & Directory Scaffolding**: Standardized hierarchy across cognitive, control, execution, voice, ai, data, and web layers.
- **TypeScript Configuration & Build**: Strong typing, ES modules, path mappings (`@alfred/*`, `@ai/*`, `@voice/*`, `@core/*`).
- **Security & Hygiene**: Protected `.gitignore` excluding secrets, environment files, `.onnx` models, and generated audio files.
- **Local TTS System (Kokoro-82M)**: 100% local neural speech synthesis with `bm_george` British butler voice, WAV audio encoding, streaming chunking, and system playback detection.
- **Voice Profile Architecture**: Decoupled `VoiceProfile` mapping and `TTSService` facade.
- **AI Provider Abstraction**: Strongly typed `AIProvider`, `AIChatProvider`, and `AISpeechToTextProvider` interfaces, provider registry, and factory resolution.
- **Groq Provider Integration**: Groq SDK client provider (`src/ai/providers/groq/`) with chat completion, Whisper audio transcription, error sanitization, and model configuration.
- **Automated Tests & Dev Verification**: Unit tests for both Groq AI provider and Kokoro TTS provider, plus dev utilities (`npm run test:groq`, `npm run test:tts`).
- **Firebase & Cloud Infrastructure Setup**: Google Cloud / Firebase project linkage (`butler-alfred`), Firestore initial configuration.
- **Private GitHub Repository**: Initialized Git repository linked to the private `B.U.T.L.E.R.-Alfred` GitHub remote.

### Planned
- **Full Voice Assistant Pipeline**: End-to-end real-time microphone stream input -> STT -> LLM response -> TTS audio playback.
- **Cognitive Graph & Memory System**: Working memory buffers, episodic vector storage, and dependency tracking graphs.
- **Control Plane Engines**: Autonomous task planner, event bus, cron scheduler, and hierarchical permission gating.
- **Service Integrations**: Live adapters for GitHub API, Gmail API, Google Calendar API, and web browsing.
- **Web Interface**: Interactive dashboard built in `apps/web/`.
