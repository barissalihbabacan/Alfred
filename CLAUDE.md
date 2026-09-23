# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

B.U.T.L.E.R. Alfred — a personal AI executive-assistant/agent system for Barış (*Barış's Unified Task, Logic, Execution & Reasoning*). Alfred is a British-butler-persona cognitive agent: a vendor-agnostic TypeScript core (`src/`) handles LLM providers, long-term memory, voice and tool execution; the production front end is a Next.js app built as a static export (see **Front end** below). Deployed through Firebase.

## Commands

```bash
# Core library (src/)
npm run build              # tsc build of src/
npm run typecheck          # tsc --noEmit
npm run typecheck:tests    # tsc -p tsconfig.tests.json (tests/ + scripts/, which tsconfig.json excludes)
npm run lint               # eslint . (flat config: eslint.config.js)
npm test                   # vitest run (all tests)
npm run test:unit          # vitest run tests/unit
npm run test:integration   # vitest run tests/integration
npx vitest run tests/unit/memory-service.test.ts   # single test file
npx vitest run -t "test name substring"             # single test by name

# Provider / integration smoke tests (require real credentials in .env)
npm run test:groq
npm run test:ollama

# Long-term memory
npm run memory:reindex     # rebuild vector store from Firestore (source of truth)

# Canonical user profile (after editing users/*.md)
npm run generate:user-profile   # re-embed users/*.md into src/alfred/cognitive/context/user-profile.generated.ts
npx vitest run tests/unit/functions-system-prompt.test.ts -u   # refresh the production prompt fixture

# Web app (apps/web, Next.js static export -> apps/web/out)
npm run dev:web             # http://localhost:3000, hot reload; /api/** proxied to ALFRED_API_ORIGIN
npm run build:web           # static export to apps/web/out (what Hosting serves)
firebase serve --only hosting   # serve apps/web/out locally with firebase.json rewrites/headers

# Firebase Functions (functions/)
npm run build --prefix functions          # esbuild: functions/index.js + src/ -> functions/lib/index.js
npm run check:bundle --prefix functions   # node --check + import smoke test of the bundle
npm run deploy --prefix functions   # firebase deploy --only functions
```

As of the last check `npm run test:unit` is 548 passing tests across 45 files, `npm run typecheck`, `npm run typecheck:tests` and `npx tsc -p apps/web/tsconfig.json --noEmit` are clean, `npm run build:web` succeeds and `npm run lint` has 0 errors and 0 warnings — keep all of them green (CI runs them all). Every rule in `eslint.config.js` is an error, including `no-explicit-any` (use `unknown` plus narrowing, and `errorMessage()` from `src/core/errors` for caught errors), so any lint finding fails CI. There is no Prettier: formatting is not enforced, so don't mass-reformat files.

`tests/unit/*` run offline against in-memory repositories/stores; `tests/integration/*` and the `test:groq`/`test:ollama` scripts hit real providers and need `.env` populated (copy from `.env.example`).

## Architecture

Full detail lives in `docs/ARCHITECTURE.md` — read it before touching `src/alfred/` or `src/data/`. Summary of the invariants that matter most:

### Layout
- `src/alfred/` — Alfred's domain logic, split into three "planes": **cognitive** (context, memory — Alfred's understanding of state), **control-plane** (tool routing, permissions), **execution-plane** (capabilities Alfred can invoke). Kept as vendor-independent as possible.
- `src/ai/` — provider-agnostic LLM abstraction. Nothing outside `src/ai/providers/` should import a concrete provider directly; always go through `getAIProvider()` (`src/ai/providers/factory.ts`), switched via `ALFRED_LLM_PROVIDER` (`ollama` | `groq`).
- `src/ai/tools/` — tool definitions the model can call (`types.ts` defines `ITool`, `ToolDefinition`, `ToolCall`, `ToolResult`, `ToolExecutionContext`). Currently `ssh/` (connect, execute, list-directory tools; `ssh-tool-definitions` and `ssh-placeholder` shared with production) and `time/` (get-current-time, current-time, timezone-resolver; shared with production).
- `src/voice/` — STT (Groq Whisper) and TTS (`ITTSProvider` abstraction with mock/fallback, browser Web Speech used in frontend).
- `src/data/` — persistence abstractions: Firestore repositories, vector store, embedding providers. Always accessed through interfaces + factories (e.g. `getConversationRepository()`, `getVectorStore()`, `getEmbeddingProvider()`), each with an in-memory implementation used by unit tests.
- `src/core/` — cross-cutting config, errors and logging. `logging/` is a small JSON-to-stdout `StructuredLogger` (not wired into production; `functions/index.js` has its own `logEvent()` on `firebase-functions/logger`). `events/`, `types/`, `permissions/` are still empty placeholders.
- **Structured logs**: the `api` function emits `llm_request`, `tool_call`, `memory_retrieval` and `memory_extraction` events (tokens, latency, TTFT, scores, outcomes; never API keys, ID tokens or user message text). Query them in Cloud Logging with `jsonPayload.event="llm_request"`.
- `apps/web/` — see **Front end**.
- `functions/` — Firebase Cloud Functions backend (plain JS, separate `package.json`/deploy cycle). Not a thin layer: `functions/index.js` is ~1360 lines and carries its own tool wiring, request handling and two entry points (its chat system prompt now comes from `src/ai/prompts/alfred-system-prompt.ts`) — `api` (`onRequest`, behind the `/api/**` Hosting rewrite) and `alfredCallable` (`onCall`). It is being migrated to import from `src/` (bundled with esbuild, see **Functions bundle** below), but most of it is still hand-written: except for the modules listed there, changes to Alfred's behaviour often need to be made here **and** in `src/` — those parts are not shared code.
- `users/` — canonical, git-versioned, **read-only-at-runtime** profile of Barış (`USER_PROFILE.md`, `PREFERENCES.md`, `WORKING_STYLE.md`). Never written to by the running app. **Production uses these files**: `scripts/generate-user-profile-sources.mjs` embeds them as strings in the committed `src/alfred/cognitive/context/user-profile.generated.ts` (`USER_PROFILE_SOURCES`), and the pure `renderUserProfileBlock()` (`user-profile-renderer.ts`) renders them into the prompt's `CANONICAL USER PROFILE` block — in production from the embedded copy (nothing reads files at runtime in the bundle), in src/ from the files `UserProfileLoader` reads (falling back per file to the embedded copy). The renderer keeps the prose verbatim and strips only title/metadata/rules and bold/italic markers. Editing `users/*.md` therefore changes Alfred's live prompt after deploy: run `npm run generate:user-profile` (`tests/unit/user-profile-renderer.test.ts` fails if the embedded copy is stale; `functions/build.js` also regenerates it before bundling) and refresh the prompt fixture (see **Commands**).
- `docs/persona/ALFRED_PERSONA.md` — canonical behavioral/linguistic spec for Alfred (British-butler tone, pushback style, "sir" usage, response length rules). Consult this before changing anything under `src/alfred/persona/` or `src/ai/prompts/`.

### Front end — one Next.js app, built as a static export
- `apps/web/` (`app/`, `components/`, `lib/`) is the only front end. `next.config.mjs` sets `output: "export"`, so `npm run build:web` writes plain static files to `apps/web/out` and Firebase Hosting serves that directory. There is **no server runtime**: no route handlers (`app/api/*` was removed), no SSR, no middleware. Anything that needs a server belongs in `functions/index.js`.
- `components/VoiceChatPlayground.tsx` is the chat UI; `components/LoginScreen.tsx` is the auth gate; `app/page.tsx` only mounts the chat once Firebase has restored an allowed session.
- All backend calls go through `lib/api.ts` (`apiFetch`), which targets `/api/*` and adds the Firebase ID token (`Authorization: Bearer`) and the App Check token (`X-Firebase-AppCheck`). The `/chat` SSE stream is parsed by `lib/sse.ts`. Don't call `fetch("/api/...")` directly.
- `npm run dev:web` rewrites `/api/**` to `ALFRED_API_ORIGIN` (default: the Functions emulator, `http://127.0.0.1:5001/butler-alfred/us-central1/api`; use `https://butler-alfred.web.app/api` to hit production). The rewrite exists only in dev; the export uses the Hosting rewrite.
- Speech input is the browser Web Speech API (`SpeechRecognition`) and speech output is `speechSynthesis`. There is no server-side STT endpoint in production (the old Next `/api/stt` Groq Whisper route was unused by the UI and was removed with the other route handlers).
- The previous vanilla-JS front end (`apps/web/public/*.js`) was removed in favour of this app.

### Tool execution
`ToolRegistry` (`src/alfred/control-plane/tool-router/tool-registry.ts`, singleton via `getToolRegistry()`) holds `ITool` implementations; `ToolRouter` (`getToolRouter()`) dispatches model tool-calls to them. `PermissionManager` (`src/alfred/control-plane/permission-system/`) gates execution through `ToolExecutionContext extends PermissionContext`. Role policy (least privilege, a missing `userRole` counts as `guest`): `READ_ONLY` anyone; `SAFE_READ`/`WRITE` owner or admin; `EXECUTE` owner only; `DESTRUCTIVE` owner only and with `confirmed: true`. `tests/unit/permission-manager.test.ts` pins the full level × role matrix. This governs `src/` tools only; production tools in `functions/index.js` are single-user and protected by the ID-token gate.

SSH is the only real capability so far. `src/alfred/execution-plane/ssh/` holds the machinery: `ssh-client.interface.ts` with a real `ssh2-client.ts` and a `mock-ssh-client.ts` for tests, plus `ssh-connection-manager.ts`, `remote-command-executor.ts`, `command-registry.ts` (allow-list of runnable commands), `ssh-path-sandbox.ts` (path confinement) and `ls-parser.ts`. Hosts are referred to by alias (`home-server`), never raw credentials in tool arguments.

**Production does not use any of it.** `functions/index.js` never opens an SSH connection: for `ssh_connect` / `ssh_list_directory` / `ssh_execute` it returns canned results (`runPlaceholderSshTool` in `src/ai/tools/ssh/ssh-placeholder.ts`: a fixed 15-entry `Belgeler/` listing and fixed `df`/`pwd`/`whoami`/`uname` output). The three tool definitions and the argument rules both sides apply (default host `home-server`, default path `Belgeler`, the exact-match allow-list check and production's path deny-list — `..`, or a leading `/etc`, `/var`, `/home` — with their error text) live in `src/ai/tools/ssh/ssh-tool-definitions.ts`; the allow-list itself is `src/alfred/execution-plane/ssh/allowed-commands.ts`. The src tools run those checks first, so a call production refuses gets the same error, then add the real-SSH guards production has no use for (non-string host/path, registry lookup, `SSHPathSandbox`, realpath containment).

### Path aliases (tsconfig.json)
`@alfred/*`, `@ai/*`, `@voice/*`, `@data/*`, `@integrations/*`, `@core/*` all map to `src/*` subfolders. `apps/web/` has its own `tsconfig.json`, is a separate Next.js compilation unit, and **does not import from `src/` at all** (its tsconfig has no `src` aliases). With the Next.js route handlers gone, the only HTTP entry point for Alfred is `functions/index.js`, which pulls in selected `src/` modules through the functions bundle (see **Functions bundle**).

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
The `api` function's `POST /chat` (`functions/index.js`) streams SSE frames `data: {json}\n\n` with `type` = `start` (`conversationId`, `provider`, `model`), `thinking`, `chunk` (`text`), `tool_call`, `tool_result`, `done`, `error` (`error`). `chunk` text can contain `<think>` traces; the client strips them before rendering. After `done` the server keeps the connection open until the memory write finishes, so the UI releases the composer on `done` rather than on stream close, and a per-turn guard keeps a late-closing stream from resetting a newer turn. `tests/unit/web-sse-parser.test.ts` pins the frame format.

### Auth — single-user, Google only
The app is locked to one person. There is no sign-up, no password login and no SMS MFA (all removed in Sep 2026).

- **Google Sign-In only**, popup with an automatic fallback to redirect on `auth/internal-error`, `auth/popup-blocked` or `auth/cancelled-popup-request` (`apps/web/lib/auth.ts`).
- **UID allow-list**: any account whose `uid` is not the single allowed value is signed straight back out with `auth/unauthorized-uid` (popup, redirect result, and restored sessions via `subscribeAuthState`). The UID has exactly one definition per runtime:
  - **Web app** — `apps/web/lib/allowed-uid.ts` (`process.env.NEXT_PUBLIC_ALLOWED_UID || literal`; the `NEXT_PUBLIC_` value is inlined at build time, so it works in the static export), imported and re-exported by `apps/web/lib/auth.ts`.
  - **Cloud Functions** — `functions/index.js` (`process.env.ALLOWED_UID || literal`).

  Changing the UID therefore means editing those two places (or setting the env vars). The UID is not a secret; the client-side check is UX only, and real enforcement is server-side in `functions/index.js` (ID token + App Check).
- **App Check** (reCAPTCHA Enterprise) is still in place: initialised in `apps/web/lib/firebase.ts` (`getAppCheckToken()` feeds the `X-Firebase-AppCheck` header), verified server-side in `functions/index.js` alongside the Firebase ID token.
- **Server-side enforcement is what actually protects the data.** `functions/index.js` `api` rejects every request except `/` and `/health` without a valid Firebase ID token (401) or with a UID other than `ALLOWED_UID` (403). The user is always the token's UID; a client-supplied `userId` that differs is rejected, and a conversation owned by another `userId` returns 404. `alfredCallable` checks `request.auth.uid` the same way. The web app therefore mounts the chat UI (and loads conversations) only after Firebase has restored an allowed session, and `apiFetch` refuses authenticated calls without a signed-in user.
- `tests/unit/uid-whitelist.test.ts` (against a mocked Firebase Auth), `tests/unit/auth-error-messages.test.ts` and `tests/unit/web-api-client.test.ts` pin this behaviour — they will fail if the UID, the error contract or the auth headers change.

### Deployment — Firebase Hosting + Cloud Functions only
- `firebase.json` — Firestore rules/indexes, the `functions` codebase, and Hosting. Hosting serves `apps/web/out` (the Next.js static export — it must be built first), rewrites `/api/**` to the `api` function and everything else to `index.html`. `Cache-Control` is `no-cache` everywhere except the content-hashed `/_next/static/**`, which is cached for a year (the later, more specific header rule wins).
- There is no App Hosting and no server runtime for the web app (`apphosting.yaml` was removed). Production is the static export on Hosting plus the `api` / `alfredCallable` functions.
- **CI**: `.github/workflows/ci.yml` runs `npm ci`, `npm run lint`, `npm run typecheck`, `npm run typecheck:tests`, `npm run test:unit`, the functions bundle build/check, the `apps/web` typecheck and `npm run build:web` on every pull request (Node 22, no `.env`). `.github/workflows/deploy.yml` reuses it as a `test` job, then runs `npm ci`, `npm run build:web`, the functions bundle build and `firebase deploy --only hosting,functions`, on any push to `main` touching `apps/**`, `src/**`, `functions/**`, `firebase.json`, `.firebaserc`, `package.json`, `package-lock.json` or either workflow. A lint error, red typecheck, unit test or web build therefore blocks the deploy.
- **Rollback**: `firebase hosting:rollback` (or Hosting → Release history → Roll back in the console) restores the previous Hosting release without a rebuild.

### Functions bundle — `functions/` imports `src/` via esbuild
`functions/index.js` is the **source**, not what runs. `functions/build.js` bundles it with esbuild (ESM, `platform: node`, `target: node22`, `packages: "external"`) into `functions/lib/index.js`, which `functions/package.json` `"main"` points at. `functions/lib/` is gitignored and must be built before `firebase deploy` or the emulator: `firebase.json` runs `npm --prefix "$RESOURCE_DIR" run build` as the functions `predeploy` hook, and `deploy.yml` also builds explicitly. Only `functions/` is uploaded, so the bundle must be self-contained apart from npm packages.

- Import shared code with **relative paths** to the `.js` specifier of the `.ts` file (`import { x } from "../src/data/vector/cosine-similarity.js"`), same as inside `src/`. esbuild strips types; `npm run typecheck` is what type-checks `src/`.
- npm dependencies are **not** bundled. `build.js` fails if the bundle imports a package that is not in `functions/package.json` `dependencies`, or if it stops exporting `api` / `alfredCallable`. A `src/` module that needs a new package means adding it to `functions/package.json` too.
- Only migrate pure modules. Nothing bundled may read files at import time (e.g. `UserProfileLoader` reading `users/*.md` would break: those files are not uploaded — the bundle gets them through `user-profile.generated.ts` instead, and `build.js` fails if that module drops out of the bundle) or pull in `src/core/config`, whose modules import `dotenv` (a root-only dependency, so the build check rejects it) and call `dotenv.config()` at import time.
- `"gcp-build": ""` in `functions/package.json` is deliberate: Cloud Build would otherwise run the `build` script in the cloud, where `../src` does not exist. Don't remove it.
- **Shared so far** (anything changed here ships to production): `cosineSimilarity` (`src/data/vector/cosine-similarity.ts`); from `src/ai/prompts/memory-extraction.ts` the extraction system prompt (`buildMemoryExtractionSystemPrompt`), `buildMemoryExtractionUserPrompt`, `extractJsonPayload` and the candidate validation (`getMemoryExtractionCandidates` + `validateMemoryCandidate`, which never throws: a non-object entry (e.g. `null`) is skipped and the rest of the list still runs; trimmed content >= 5 chars; confidence must be a finite number or plain decimal string in [0, 1] and >= 0.70, anything else, including a missing value, is rejected; `action` is create/forget/supersede matched case-insensitively after trimming, anything else becomes `"create"` so the duplicate check applies; `memoryType` must be one of the prompt's types, anything else becomes `"general"`. The prompt no longer asks for `targetMemoryHint`, which production never read. `parseMemoryExtractionResponse` and `DEFAULT_EXTRACTION_MIN_CONFIDENCE` follow the same rules, so src and production accept identical candidates. Production tallies skipped candidates as `invalid` in the `memory_extraction` event); `generateDeterministicTitle` (`src/data/firestore/conversation-title.ts`, also used by the conversation repositories); the `get_current_time` tool definition and implementation (`GET_CURRENT_TIME_TOOL_DEFINITION` + `getCurrentTimeForCity` in `src/ai/tools/time/current-time.ts`, with `resolveTimezone` / `CITY_TIMEZONE_ALIASES` in `timezone-resolver.ts`; `GetCurrentTimeTool` wraps them). The resolver folds diacritics (İstanbul, Eskişehir, München), drops a country after a comma or at the end and a Turkish case suffix (`İstanbul'da` -> Istanbul), knows Turkish exonyms and major cities, and accepts Intl "Area/Location" names like `US/Eastern`; every input the original production resolver handled still resolves to the same zone (the contract test checks this over 3,000+ inputs); Alfred's chat system prompt (`buildAlfredSystemPrompt({ runtime, memories })` in `src/ai/prompts/alfred-system-prompt.ts`: `buildAlfredPersonaPrompt(runtime)` (persona, a `SPOKEN DELIVERY & FORMATTING` section — replies are read aloud by speechSynthesis, so no markdown unless explicitly asked; canonical wording in `docs/persona/ALFRED_PERSONA.md` §7 — and a capability line stating the live provider/model, which `functions/index.js` passes as `{ provider: activeProvider, model: currentModel }`) + `renderUserProfileBlock(USER_PROFILE_SOURCES)` (users/*.md, see `users/` above) + the Conversational Governor + `formatRetrievedMemoriesBlock()` (production's `RETRIEVED LONG-TERM MEMORIES (SEMANTIC CONTEXT)` wording; content whitespace collapsed and trimmed, empty memories skipped, `memoryType` tag kept as stored, e.g. `[user_preference]`). `getAlfredSystemPrompt()` / `ContextBuilder` use the same persona, renderer, governor and memory block, so with unchanged files and the same runtime src's prompt equals production's. `tests/unit/functions-system-prompt.test.ts` pins the full default (Groq) prompt against `tests/unit/fixtures/functions-alfred-system-prompt.txt` (`-u` regenerates it) plus targeted assertions); the SSH tools: the `ssh_connect` / `ssh_list_directory` / `ssh_execute` definitions and argument rules (`src/ai/tools/ssh/ssh-tool-definitions.ts`, used by `SSHConnectTool` / `SSHListDirectoryTool` / `SSHExecuteTool` too) and production's placeholder results (`isSshToolName` + `runPlaceholderSshTool` in `src/ai/tools/ssh/ssh-placeholder.ts`, see **Tool execution**); the embedding calls (`generateEmbedding` in `src/ai/embedding/embedding-client.ts`: Gemini `gemini-embedding-001` `:embedContent` with `outputDimensionality: 768` and the key as `?key=`, then Ollama `/api/embed` `nomic-embed-text`, then the `[Embedding] Neither Gemini nor Ollama…` error; 15 s `AbortSignal.timeout` on each call; returns `{ values, model }`. It takes keys, URL and fetch as parameters and has no config/dotenv import. Gemini failures are reported through `onGeminiError`, and `functions/index.js` `getEmbedding()` keeps emitting the `embedding_error` warnings itself. `isComparableEmbedding` is the former `karsilastirilabilir`. `GeminiEmbeddingProvider` / `OllamaEmbeddingProvider` build their `/embedContent` and `/api/embed` requests with the same `buildGeminiEmbedContentRequest` / `buildOllamaEmbedRequest`, but keep their own timeouts, errors and batch/legacy endpoints, and the src factory has no Gemini→Ollama fallback); and the secret filter `PrivacyFilter` (`src/alfred/cognitive/memory/privacy-filter.ts`, pinned by `tests/unit/privacy-filter.test.ts`: it rejects everything both former filters rejected plus Groq `gsk_`, Google `AQ.` keys and Turkish şifre/parola statements). `tests/unit/functions-shared-modules.test.ts`, `tests/unit/functions-memory-extraction-contract.test.ts`, `tests/unit/functions-time-tool-contract.test.ts` and `tests/unit/functions-ssh-tools-contract.test.ts` (differential tests against verbatim copies of the former inline code; the SSH one compares definitions byte for byte and results or thrown errors over ~9,500 inputs, and checks the src tools return production's error text wherever production refuses) pin their production contract.
- **Still duplicated, and diverged** (do not swap one for the other without deciding which behaviour wins): the memory *persistence* pipeline (production: inline Firestore dedup/supersede/forget in `extractAndPersistMemories`; src: `MemoryService`, which uses best-match rather than first-match supersede targets and a configurable dedup threshold, and whose `MemoryExtractor` short-circuits exact "don't remember this" messages and bounds context to `maxContextMessages`).
- CI (`ci.yml`, same `Typecheck & Unit Tests` job) installs `functions/` deps, builds the bundle and runs `check:bundle`, so a broken bundle blocks the deploy.

### Secrets — Groq/Gemini keys live only in Secret Manager
`GROQ_API_KEY` and `GEMINI_API_KEY` are never taken from the caller. There is no request-header path, and the browser neither stores nor sends keys.
- `functions/index.js` binds both through `defineSecret()`. `gizliOku()` falls back to `process.env` only when the secret isn't bound, e.g. in tests. The emulator reads `functions/.secret.local`, which is gitignored.
- `src/` and the local Next.js app read `process.env`, filled from `.env`.

`defineSecret` requires names that are valid environment variables, so the names are `GROQ_API_KEY` / `GEMINI_API_KEY` (not `groq-api-key`). Both secrets exist in `butler-alfred`. The CI deploy identity is `firebase-adminsdk-fbsvc@butler-alfred.iam.gserviceaccount.com`, and it has **Secret Manager Admin**. Admin, not just accessor, because the deploy grants the runtime service account access to each secret.

**Do not put `GROQ_API_KEY` / `GEMINI_API_KEY` in `functions/.env`.** The Firebase CLI deploys that file as plain env vars. Cloud Run then rejects the update with `Secret environment variable overlaps non secret environment variable`, which is exactly how the `api` function got stuck after an earlier manual deploy. If that error appears, remove the plain variable from the `api` Cloud Run service (console → Cloud Run → `api` → Edit → Variables & Secrets) and redeploy. Do not "fix" it by reverting to plain `process.env`.

## Notes for future sessions

- `.env.example` holds placeholders (`gsk_your_groq_api_key_here`), not real keys. The real Groq key lives in the gitignored `.env` and `functions/.env`. `functions/.env` is loaded by the Firebase CLI as plain function env vars on deploy, so once the `GROQ_API_KEY` secret exists, remove `GROQ_API_KEY` from that file or the deploy will reject the name clash. (The `AIzaSy…` literal in `apps/web/lib/firebase.ts` is the public Firebase web config key, not a secret.)
- Much of `src/` is still scaffolding. Implemented: `ai/providers`, `ai/embedding`, `ai/prompts`, `ai/tools`, `alfred/cognitive/context`, `alfred/cognitive/memory`, `alfred/control-plane/{tool-router,permission-system}`, `alfred/execution-plane/ssh`, `core/{config,errors,logging}`, `data/{firestore,vector}`, `voice/{stt,tts}`. Still empty `.gitkeep` placeholders: every other `execution-plane` capability (github, gmail, calendar, browser, terminal, files, web-search), `control-plane/{planner,scheduler,event-processor}`, `ai/{agents,middleware}`, all of `alfred/persona/*`, `core/{events,types,permissions}`, `data/{repositories,schemas,graphql}` and all of `integrations/*`. Check before assuming a capability exists.
- `README.md` and many code comments (notably `functions/index.js`) are in Turkish. The README's auth section and badges, and the `assets/readme/*.svg` art, describe the Google-only flow; keep them in sync if auth changes again.
- `.agents/skills/` holds a vendored `beautify-github-readme` skill (used for `assets/readme/` art); it is not application code.
- `dist/`, `audio_output/`, `.next/`, `.firebase/` and `functions/lib/` are generated and gitignored; `users/` and `assets/` are tracked on purpose.
