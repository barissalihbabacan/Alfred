# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

B.U.T.L.E.R. Alfred — a personal AI executive-assistant/agent system for Barış (*Barış's Unified Task, Logic, Execution & Reasoning*). Alfred is a British-butler-persona cognitive agent: a Next.js web playground (`apps/web/`) sits on top of a vendor-agnostic TypeScript core (`src/`) that handles LLM providers, long-term memory, voice, and (planned) tool execution. Deployed via Firebase Hosting + Cloud Functions.

## Commands

```bash
# Core library (src/)
npm run build              # tsc build of src/
npm run typecheck          # tsc --noEmit
npm test                   # vitest run (all tests)
npm run test:unit          # vitest run tests/unit
npm run test:integration   # vitest run tests/integration
npx vitest run tests/unit/memory-service.test.ts   # single test file
npx vitest run -t "test name substring"             # single test by name

# Provider / integration smoke tests (require real credentials in .env)
npm run test:groq
npm run test:ollama
npm run test:tts

# Long-term memory
npm run memory:reindex     # rebuild vector store from Firestore (source of truth)

# Web app (apps/web, Next.js)
npm run dev:web             # http://localhost:3000, hot reload
npm run build:web
npm run start:web

# Firebase Functions (functions/)
npm run deploy --prefix functions   # firebase deploy --only functions
```

No lint script is configured. `tests/unit/*` run offline against in-memory repositories/stores; `tests/integration/*` and the `test:groq`/`test:ollama`/`test:tts` scripts hit real providers and need `.env` populated (copy from `.env.example`).

## Architecture

Full detail lives in `docs/ARCHITECTURE.md` — read it before touching `src/alfred/` or `src/data/`. Summary of the invariants that matter most:

### Layout
- `src/alfred/` — Alfred's domain logic, split into three "planes": **cognitive** (context, memory, projects, decisions — Alfred's understanding of state), **control-plane** (planning, tool routing, permissions, scheduling), **execution-plane** (SSH, GitHub, Gmail, calendar, browser, terminal — capabilities Alfred can invoke). Kept as vendor-independent as possible.
- `src/ai/` — provider-agnostic LLM abstraction. Nothing outside `src/ai/providers/` should import a concrete provider directly; always go through `getAIProvider()` (`src/ai/providers/factory.ts`), switched via `ALFRED_LLM_PROVIDER` (`ollama` | `groq`).
- `src/voice/` — STT (Groq Whisper) and TTS (`ITTSProvider` → Kokoro-82M ONNX, fully local/offline) behind the same vendor-abstraction pattern as `src/ai/`.
- `src/data/` — persistence abstractions: Firestore repositories, vector store, embedding providers. Always accessed through interfaces + factories (e.g. `getConversationRepository()`, `getVectorStore()`, `getEmbeddingProvider()`), each with an in-memory implementation used by unit tests.
- `src/core/` — cross-cutting config, errors, logging.
- `apps/web/` — the Next.js playground: `app/` (pages + `/api/chat`, `/api/stt`, `/api/health` routes), `components/`, `lib/` (Firebase client, auth). `apps/web/public/` also holds a separate vanilla JS/HTML/CSS front end (`app.js`, `firebase-app.js`, `index.html`, `styles.css`) that Firebase Hosting serves directly.
- `functions/` — Firebase Cloud Functions backend (plain JS, separate `package.json`/deploy cycle from the root project).
- `users/` — canonical, git-versioned, **read-only-at-runtime** profile of Barış (`USER_PROFILE.md`, `PREFERENCES.md`, `WORKING_STYLE.md`). Loaded by `UserProfileLoader` and injected into the system prompt by `ContextBuilder`. Never written to by the running app.
- `docs/persona/ALFRED_PERSONA.md` — canonical behavioral/linguistic spec for Alfred (British-butler tone, pushback style, "sir" usage, response length rules). Consult this before changing anything under `src/alfred/persona/` or `src/ai/prompts/`.

### Path aliases (tsconfig.json)
`@alfred/*`, `@ai/*`, `@voice/*`, `@data/*`, `@integrations/*`, `@core/*` all map to `src/*` subfolders. `apps/web/` has its own `tsconfig.json` and is a separate Next.js compilation unit — it does not currently import from `src/` via these aliases.

### Storage model — three tiers, one source of truth
1. **Git (`users/`)** — canonical authored baseline about Barış. Read-only at runtime, authoritative over vague inference.
2. **Firestore (`src/data/firestore/`)** — authoritative for conversation history (`conversations/{id}/messages/{id}`, atomic `sequence`) and long-term memory records (`memory_vectors/{id}`). If the vector store is wiped, it is rebuilt entirely from here via `npm run memory:reindex`.
3. **Vector store (`src/data/vector/`, `LocalFileVectorStore`)** — a purely rebuildable semantic search cache, never the source of truth.

Key distinctions to preserve when editing memory code:
- Conversation history (verbatim) ≠ long-term memory (durable facts/preferences only — chit-chat is discarded).
- Memory extraction runs on an isolated classification prompt (`src/ai/prompts/memory-extraction.ts`), completely separate from Alfred's conversational persona; assistant text is never attributed to the user.
- `PrivacyFilter` (`src/alfred/cognitive/memory/privacy-filter.ts`) rejects candidate memories containing secrets (API keys, passwords, tokens) before persistence.
- Failure boundaries are intentionally non-cascading: embedding failure → no Firestore record; Firestore failure → no vector created; vector indexing failure → Firestore record kept with `indexStatus: "failed"` (re-indexable); extraction failure never affects the live chat response (it runs as a non-blocking background task).

### Streaming chat
`apps/web/app/api/chat/route.ts` proxies to `AIProvider.streamChat()` over SSE. Provider "thinking" tokens (Gemma reasoning traces) are filtered server-side and only ever surface to the client as a `{"type":"thinking"}` marker — never as raw reasoning content. Client state machine: `Idle → Sending → Thinking → Streaming → Idle`.

### Auth
Firebase Auth with SMS MFA + App Check (reCAPTCHA Enterprise) gates the web playground; see `apps/web/lib/auth.ts`, `apps/web/lib/AuthContext.tsx`, `apps/web/public/firebase-app.js`, and `functions/index.js` for the App Check token verification on the backend.

## Notes for future sessions

- Most subdirectories under `src/` are scaffolded with `.gitkeep` placeholders (e.g. `src/ai/agents/`, `src/alfred/control-plane/scheduler/`, `src/integrations/github/`) and have no implementation yet — check before assuming a capability exists.
- `.env.example` is committed to git and currently contains a live-looking `GROQ_API_KEY` value rather than a placeholder — treat it as compromised and do not reuse it; flag for rotation if asked to touch env/secrets config.
