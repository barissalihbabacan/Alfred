# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

B.U.T.L.E.R. Alfred — a personal AI executive-assistant/agent system for Barış (*Barış's Unified Task, Logic, Execution & Reasoning*). Alfred is a British-butler-persona cognitive agent: a vendor-agnostic TypeScript core (`src/`) handles LLM providers, long-term memory, voice and tool execution; two separate front ends sit on top of it (see **Front ends** below). Deployed through Firebase.

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

No lint script is configured. As of the last check `npm run test:unit` is 264 passing tests across 31 files and `npm run typecheck` is clean — keep both green.

`tests/unit/*` run offline against in-memory repositories/stores; `tests/integration/*` and the `test:groq`/`test:ollama`/`test:tts` scripts hit real providers and need `.env` populated (copy from `.env.example`).

## Architecture

Full detail lives in `docs/ARCHITECTURE.md` — read it before touching `src/alfred/` or `src/data/`. Summary of the invariants that matter most:

### Layout
- `src/alfred/` — Alfred's domain logic, split into three "planes": **cognitive** (context, memory — Alfred's understanding of state), **control-plane** (tool routing, permissions), **execution-plane** (capabilities Alfred can invoke). Kept as vendor-independent as possible.
- `src/ai/` — provider-agnostic LLM abstraction. Nothing outside `src/ai/providers/` should import a concrete provider directly; always go through `getAIProvider()` (`src/ai/providers/factory.ts`), switched via `ALFRED_LLM_PROVIDER` (`ollama` | `groq`).
- `src/ai/tools/` — tool definitions the model can call (`types.ts` defines `ITool`, `ToolDefinition`, `ToolCall`, `ToolResult`, `ToolExecutionContext`). Currently `ssh/` (connect, execute, list-directory) and `time/` (get-current-time, timezone-resolver).
- `src/voice/` — STT (Groq Whisper) and TTS (`ITTSProvider` → Kokoro-82M ONNX, fully local/offline) behind the same vendor-abstraction pattern as `src/ai/`.
- `src/data/` — persistence abstractions: Firestore repositories, vector store, embedding providers. Always accessed through interfaces + factories (e.g. `getConversationRepository()`, `getVectorStore()`, `getEmbeddingProvider()`), each with an in-memory implementation used by unit tests.
- `src/core/` — cross-cutting config and errors. `logging/`, `events/`, `types/`, `permissions/` are still empty placeholders.
- `apps/web/` — see **Front ends**.
- `functions/` — Firebase Cloud Functions backend (plain JS, separate `package.json`/deploy cycle). Not a thin layer: `functions/index.js` is ~1550 lines and carries its own system prompt, tool wiring and two entry points — `api` (`onRequest`, behind the `/api/**` Hosting rewrite) and `alfredCallable` (`onCall`). Changes to Alfred's behaviour often need to be made here **and** in `src/` — the two are not shared code.
- `users/` — canonical, git-versioned, **read-only-at-runtime** profile of Barış (`USER_PROFILE.md`, `PREFERENCES.md`, `WORKING_STYLE.md`). Loaded by `UserProfileLoader` and injected into the system prompt by `ContextBuilder`. Never written to by the running app.
- `docs/persona/ALFRED_PERSONA.md` — canonical behavioral/linguistic spec for Alfred (British-butler tone, pushback style, "sir" usage, response length rules). Consult this before changing anything under `src/alfred/persona/` or `src/ai/prompts/`.

### Front ends — there are two, and only one is served by Hosting
- **Next.js app** (`apps/web/app/`, `apps/web/components/`, `apps/web/lib/`): pages plus `/api/chat`, `/api/stt`, `/api/health` route handlers. `VoiceChatPlayground.tsx` (~1400 lines) is the main UI. Run locally with `npm run dev:web`.
- **Vanilla JS front end** (`apps/web/public/`: `index.html`, `app.js`, `firebase-app.js`, `styles.css`). `firebase.json` points Hosting at `apps/web/public`, so **this is what Firebase Hosting serves**; `/api/**` is rewritten to the `api` Cloud Function.

Behaviour changed in one front end does not appear in the other. Check which one a task is about before editing.

### Tool execution
`ToolRegistry` (`src/alfred/control-plane/tool-router/tool-registry.ts`, singleton via `getToolRegistry()`) holds `ITool` implementations; `ToolRouter` (`getToolRouter()`) dispatches model tool-calls to them. `PermissionManager` (`src/alfred/control-plane/permission-system/`) gates execution through `ToolExecutionContext extends PermissionContext`.

SSH is the only real capability so far. `src/alfred/execution-plane/ssh/` holds the machinery: `ssh-client.interface.ts` with a real `ssh2-client.ts` and a `mock-ssh-client.ts` for tests, plus `ssh-connection-manager.ts`, `remote-command-executor.ts`, `command-registry.ts` (allow-list of runnable commands), `ssh-path-sandbox.ts` (path confinement) and `ls-parser.ts`. Hosts are referred to by alias (`home-server`), never raw credentials in tool arguments.

### Path aliases (tsconfig.json)
`@alfred/*`, `@ai/*`, `@voice/*`, `@data/*`, `@integrations/*`, `@core/*` all map to `src/*` subfolders. `apps/web/` has its own `tsconfig.json`, is a separate Next.js compilation unit, and **does not import from `src/` at all** — it reimplements what it needs. Same warning as the two front ends: shared-looking logic is duplicated, not shared.

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

### Auth — single-user, Google only
The app is locked to one person. There is no sign-up, no password login and no SMS MFA (all removed in Sep 2026).

- **Google Sign-In only**, popup with an automatic fallback to redirect on `auth/internal-error`, `auth/popup-blocked` or `auth/cancelled-popup-request` (`apps/web/lib/auth.ts`).
- **UID allow-list**: any account whose `uid` is not the single allowed value is signed straight back out with `auth/unauthorized-uid`. The UID literal is currently repeated in **five** places — `apps/web/lib/auth.ts`, `apps/web/app/api/chat/route.ts`, `apps/web/public/firebase-app.js`, `apps/web/public/app.js`, `functions/index.js` (the last two read `process.env.ALLOWED_UID` first). Change all five together, and prefer moving new call sites to the env var.
- **App Check** (reCAPTCHA Enterprise) is still in place: initialised in `apps/web/lib/firebase.ts` and `apps/web/public/firebase-app.js`, verified server-side in `functions/index.js` alongside the Firebase ID token.
- `tests/unit/uid-whitelist.test.ts` and `tests/unit/auth-error-messages.test.ts` pin this behaviour — they will fail if the UID or the error contract changes.

### Deployment — two configs, know which one you are changing
- `firebase.json` — Firestore rules/indexes, the `functions` codebase, and Hosting. Hosting serves `apps/web/public`, rewrites `/api/**` to the `api` function and everything else to `index.html`, with `no-cache` on all paths.
- `apphosting.yaml` — Firebase **App Hosting** runConfig (0–2 instances, concurrency 10, 2 CPU, 2 GiB) and the production env: `AI_PROVIDER=groq`, `GROQ_MODEL=llama-3.3-70b-versatile`, `GROQ_STT_MODEL=whisper-large-v3-turbo`, `TTS_PROVIDER=kokoro`, `TTS_VOICE=bm_george`, and `GROQ_API_KEY` from the `groq-api-key` secret.

## Notes for future sessions

- **`.env.example` is committed and contains real-looking secrets**, not placeholders: a `gsk_…` Groq key and an `AIzaSy…` Firebase web API key. Treat both as compromised, never reuse them, and flag them for rotation if asked to touch env/secrets config. (`.env` itself is correctly gitignored.)
- Much of `src/` is still scaffolding. Implemented: `ai/providers`, `ai/embedding`, `ai/prompts`, `ai/tools`, `alfred/cognitive/context`, `alfred/cognitive/memory`, `alfred/control-plane/{tool-router,permission-system}`, `alfred/execution-plane/ssh`, `core/{config,errors}`, `data/{firestore,vector}`, `voice/{stt,tts}`. Still empty `.gitkeep` placeholders: every other `execution-plane` capability (github, gmail, calendar, browser, terminal, files, web-search), `control-plane/{planner,scheduler,event-processor}`, `ai/{agents,middleware}`, all of `alfred/persona/*`, `core/{logging,events,types,permissions}`, `data/{repositories,schemas,graphql}` and all of `integrations/*`. Check before assuming a capability exists.
- `dist/`, `audio_output/`, `.next/` and `.firebase/` are generated and gitignored; `users/` and `assets/` are tracked on purpose.
