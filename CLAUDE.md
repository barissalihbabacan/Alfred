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
npm run test:integration   # vitest run tests/integration (real services; each suite skips when its prerequisite is missing)
npm run test:integration:offline   # same with ALFRED_OFFLINE=1: no network, every service-dependent suite skipped (what CI runs)
npx vitest run tests/unit/memory-service.test.ts   # single test file
npx vitest run -t "test name substring"             # single test by name

# Provider / integration smoke tests (require real credentials in .env)
npm run test:groq
npm run test:ollama

# Long-term memory
npm run memory:reindex     # rebuild vector store from Firestore (source of truth)
npm run backup:firestore -- --out backup.json   # JSON dump of every collection (needs ADC; CI runs it weekly, encrypted)

# Canonical user profile (after editing users/*.md)
# 1. update src/alfred/cognitive/context/user-profile.digest.md by hand to reflect the edit
npm run generate:user-profile   # re-embed users/*.md + digest; prints the new sha256 lines for the digest (exit 1 until pasted)
npx vitest run tests/unit/functions-system-prompt.test.ts -u   # refresh the production prompt fixture

# Web app (apps/web, Next.js static export -> apps/web/out)
npm run dev:web             # http://localhost:3000, hot reload; /api/** proxied to ALFRED_API_ORIGIN
npm run build:web           # static export to apps/web/out (what Hosting serves)
firebase serve --only hosting   # serve apps/web/out locally with firebase.json rewrites/headers

# Firebase Functions (functions/)
npm run build --prefix functions          # esbuild: functions/index.js + src/ -> functions/lib/index.js
npm run check:bundle --prefix functions   # node --check + import smoke test of the bundle
npm run deploy --prefix functions   # firebase deploy --only functions

# Production alerting (Cloud Monitoring; see docs/OPERATIONS.md). Dry-run unless --apply.
./scripts/monitoring/setup-alerts.sh --project butler-alfred --email <owner email> [--apply]
./scripts/monitoring/teardown-alerts.sh --project butler-alfred [--apply] [--delete-channels]
```

As of the last check `npm run test:unit` is 907 passing tests across 67 files, `npm run typecheck`, `npm run typecheck:tests` and `npx tsc -p apps/web/tsconfig.json --noEmit` are clean, `npm run build:web` succeeds and `npm run lint` has 0 errors and 0 warnings — keep all of them green (CI runs them all). Every rule in `eslint.config.js` is an error, including `no-explicit-any` (use `unknown` plus narrowing, and `errorMessage()` from `src/core/errors` for caught errors), so any lint finding fails CI. There is no Prettier: formatting is not enforced, so don't mass-reformat files.

`tests/unit/*` run offline against in-memory repositories/stores. `tests/integration/*` and the `test:groq`/`test:ollama` scripts hit real services and need `.env` populated (copy from `.env.example`). Gating lives in `tests/integration/prerequisites.ts`: with `ALFRED_OFFLINE=1` every service-dependent suite is `describe.skipIf`-skipped regardless of credentials; without it each suite skips when its own prerequisite is absent, and the SSH/Ollama tests call the test context's `skip()` (reported as skipped, not passed) when the host is unreachable. Any new integration test that needs a service must be gated on `OFFLINE` too.

| File | Needs | With `ALFRED_OFFLINE=1` (CI) |
|---|---|---|
| `groq.integration.test.ts` | `GROQ_API_KEY`, live Groq | skipped |
| `ollama.integration.test.ts` | Ollama at `OLLAMA_BASE_URL` (default Tailscale MacBook) | skipped |
| `production-chat-regression.test.ts` | production API; authenticated part also `ALFRED_TEST_ID_TOKEN` or `GOOGLE_APPLICATION_CREDENTIALS` | skipped (CI never hits production) |
| `ssh-home-server.integration.test.ts` | SSH to home-server over Tailscale + key | skipped |
| `ssh-list-directory.integration.test.ts` | path-sandbox test: nothing (runs, with a client factory that refuses to connect); the rest: SSH to home-server, symlink test also runs on home-server itself | sandbox test runs, rest skipped |

## Architecture

Three documents go deeper than this file; read the relevant one before changing the area it covers:
- `docs/ARCHITECTURE.md` — structure and invariants. Read it before touching `src/alfred/` or `src/data/`.
- `docs/PRODUCTION_INTERNALS.md` — how production behaves in detail: SSE contract, Groq 429 policy, chat provider fallback, auth, CI/deploy, the functions bundle and **every module it shares with `src/`**, secrets. Read the matching section before changing `functions/` or any shared module.
- `docs/OPERATIONS.md` — alert policies, thresholds and the Turkish runbook.

Planned capabilities and the pattern for adding a tool to production are in `docs/FEATURE_ROADMAP.md`; the web app is described in `docs/web/ALFRED_PLAYGROUND.md`.

### Layout
- `src/alfred/` — domain logic in three "planes": **cognitive** (context, memory), **control-plane** (tool routing, permissions), **execution-plane** (capabilities Alfred can invoke). Kept vendor-independent.
- `src/ai/` — provider-agnostic LLM layer. Nothing outside `src/ai/providers/` imports a concrete provider; go through `getAIProvider()` (`src/ai/providers/factory.ts`, `ALFRED_LLM_PROVIDER` = `ollama` | `groq`). Production's chat path is the separate fallback chain in `src/ai/providers/chat-fallback/`. `src/ai/tools/` holds `ssh/` (not offered in production) and `time/` (shared with production).
- Path aliases `@alfred/*`, `@ai/*`, `@voice/*`, `@data/*`, `@integrations/*`, `@core/*` map to `src/*` subfolders (`tsconfig.json`).
- `src/data/` — Firestore repositories, vector store, embedding providers, always through interfaces + factories (`getConversationRepository()`, `getVectorStore()`, `getEmbeddingProvider()`), each with an in-memory implementation for unit tests.
- `src/core/` — config, errors (`errorMessage()`), a `StructuredLogger` that production does not use (`functions/index.js` has its own `logEvent()`).
- `functions/` — the backend: plain JS, own `package.json`, ~1000-line `functions/index.js` with two entry points, `api` (`onRequest`, behind the `/api/**` Hosting rewrite) and `alfredCallable` (`onCall`). Parts of it import `src/` through the bundle (see **Functions bundle**); the rest is hand-written, so a behaviour change outside the shared modules often has to be made here **and** in `src/`.
- `users/` — canonical, git-versioned profile of Barış, **read-only at runtime**. The prompt carries a hand-written digest of it (`src/alfred/cognitive/context/user-profile.digest.md`, which records each file's sha256), not the files. Editing `users/*.md` means updating the digest, pasting the hashes `npm run generate:user-profile` prints and refreshing the prompt fixture (see **Commands**); tests and `functions/build.js` fail until the hashes match.
- `docs/persona/ALFRED_PERSONA.md` — canonical behavioural spec for Alfred (tone, pushback, "sir", response length). Consult it before changing `src/alfred/persona/` or `src/ai/prompts/`.
- **Structured logs**: `api` emits `llm_request`, `llm_provider_fallback`, `llm_rate_limited`, `llm_stream_error`, `tool_call`, `memory_retrieval`, `memory_extraction`, `embedding_error` and `app_check` events (never API keys, ID tokens or user message text). The Cloud Monitoring alerts filter on these event names and fields: `tests/unit/monitoring-config.test.ts` fails if one disappears; when renaming, update `scripts/monitoring/metrics/*.json` and re-run the setup script (the owner applies it; CI never touches Monitoring).

### Front end — one Next.js app, built as a static export
- `apps/web/` is the only front end: Next.js 16 (App Router, React 19, Turbopack for dev and build). `output: "export"`: **no server runtime** (no route handlers, SSR or middleware); anything needing a server goes in `functions/index.js`. It has its own `tsconfig.json` and **does not import from `src/`**.
- `apps/web/next-env.d.ts` is generated and gitignored: `next dev` and `next build` rewrite it with different contents. The web typecheck in CI runs before the build, so it passes without the file; code that needs its types (e.g. image imports) would need the build first.
- `components/VoiceChatPlayground.tsx` is the chat UI, `components/LoginScreen.tsx` the auth gate; `app/page.tsx` mounts the chat only after Firebase restores an allowed session.
- All backend calls go through `lib/api.ts` (`apiFetch`, adds the ID token and App Check headers); the `/chat` SSE stream is parsed by `lib/sse.ts`. Don't call `fetch("/api/...")` directly. **Firebase Hosting buffers `/api/**` responses** (measured: every event of a turn arrived in the same millisecond), so `POST /chat` passes `stream: true` and goes straight to the function (`STREAM_API_BASE`: `https://us-central1-butler-alfred.cloudfunctions.net/api` in a production build, `/api` under `next dev`, `NEXT_PUBLIC_STREAM_API_BASE` overrides). It also escapes Hosting's 60 s request timeout. Everything else still goes through `/api`.
- `npm run dev:web` proxies `/api/**` to `ALFRED_API_ORIGIN` (default the Functions emulator; `https://butler-alfred.web.app/api` for production, which needs the App Check debug token registered or requests get 401).
- Voice input is browser-only (`SpeechRecognition`); there is no server STT endpoint. Replies are not read aloud: the `speechSynthesis` "Seslendir" button was removed on 27 Sep 2026.
- **Styling is Tailwind CSS 4.** Use classes, not `style={{…}}` (inline styles can't be overridden by media queries, which is what broke the phone layout); inline styles only for truly dynamic values. There is no `tailwind.config.ts`: the theme (colours `chat-*` / `butler-*` / `gold-*`, fonts, animations) is the `@theme` block in `app/globals.css`, and `postcss.config.mjs` only loads `@tailwindcss/postcss`. Custom variants `mobile:` (max-width 768px, must match `MOBILE_QUERY` in `VoiceChatPlayground.tsx`) and `touch:` are `@custom-variant`s there; full-height layouts use the `h-screen-safe` / `min-h-screen-safe` `@utility`s. v4 renamed parts of the scale (v3 `rounded` = v4 `rounded-sm`, `outline-none` = `outline-hidden`, important is a suffix: `hover:bg-x!`), and `hover:` only applies on devices that can hover. Tailwind only sees complete class names, so conditional classes must be whole literals, never concatenated fragments. Turbopack evaluates `postcss.config.mjs` with a wrong `import.meta.url`, so don't derive paths from it; `globals.css` sets the scan root with `@import "tailwindcss" source("..")`. `globals.css` otherwise keeps only base rules, CSS variables and the classes of `renderMarkdown()` output.

### Tool execution
`ToolRegistry` / `ToolRouter` (`src/alfred/control-plane/tool-router/`) dispatch model tool calls; `PermissionManager` gates them (a missing `userRole` counts as `guest`; `READ_ONLY` anyone, `SAFE_READ`/`WRITE` owner or admin, `EXECUTE` owner, `DESTRUCTIVE` owner with `confirmed: true`; pinned by `tests/unit/permission-manager.test.ts`). This governs `src/` tools only.

SSH (`src/alfred/execution-plane/ssh/`: allow-list, path sandbox, hosts by alias only) is not offered in production: `functions/index.js` sends `get_current_time`, plus `web_search` when a Tavily key is configured (see below), and the persona (`sshAvailable: false`) says server access is not connected and forbids inventing server state. Wiring real SSH into production is a separate design decision.

### Storage model — three tiers, one source of truth
1. **Git (`users/`)** — authored baseline about Barış, read-only at runtime.
2. **Firestore** — authoritative for conversation history (`conversations/{id}/messages/{id}`, atomic `sequence`) and long-term memory (`memory_vectors/{id}`).
3. **Vector store** (`LocalFileVectorStore`) — a rebuildable cache, never the source of truth (`npm run memory:reindex`).

Preserve when editing memory code:
- Conversation history (verbatim) ≠ long-term memory (durable facts/preferences only).
- Extraction uses an isolated classification prompt (`src/ai/prompts/memory-extraction.ts`), never the persona; assistant text is never attributed to the user. It runs on its own model (`MEMORY_EXTRACTION_MODEL`, Groq limits are per model) with a Groq → Gemini → Ollama chain, and never waits on a 429.
- `PrivacyFilter` rejects candidate memories containing secrets before persistence.
- Failures don't cascade: embedding failure → no record; Firestore failure → no vector; indexing failure → record kept as `indexStatus: "failed"`; extraction failure never affects the live reply (it runs after the response).

### Production chat path
- `POST /chat` streams SSE frames (`start`, `thinking`, `chunk`, `tool_call`, `tool_result`, `rate_limited`, `provider_fallback`, `done`, `error`); `lib/sse.ts` drops unknown types, so new ones are safe for old clients. The assistant message is persisted before `done` (one transaction with the next sequence and `messageCount`, interrupted replies too), and the server keeps the connection open after `done` for the memory write, so the UI releases the composer on `done`. Frame format pinned by `tests/unit/web-sse-parser.test.ts`.
- Provider order is **Groq → Gemini → OpenRouter** (`DEFAULT_CHAT_PROVIDER_ORDER`; `CHAT_FALLBACK_ORDER` overrides). Cerebras is configured but left out because the account returns 402; add `"cerebras", "cerebras_secondary"` back before `"openrouter"` once billing is set up. Failover happens **only before any `chunk` was sent**, and restarts the whole turn on the next provider. Groq's request body must stay byte-for-byte the former payload (a test compares the JSON string).
- Groq 429s: `src/ai/providers/groq/rate-limit.ts` waits the **real** requested time (never clamped down) only if it fits the 25 s per-turn budget, gives up at once on daily limits, and turns give-ups into a short Turkish error.
- **Token budget:** the system prompt is re-sent on every model call and Groq's free tier allows 8,000 tokens/minute. `tests/unit/system-prompt-budget.test.ts` fails above 2,400 tokens static / 2,800 with five memories. Each rule is stated once (persona, governor or digest); don't reintroduce duplicates. `tests/unit/functions-system-prompt.test.ts` pins the full prompt against a fixture (`-u` regenerates it).
- Replies are rendered as markdown in the chat, so the persona allows exactly what `apps/web/lib/markdown.ts` renders (bold, italic, code, lists, http(s) links; no headings or tables) and keeps conversation as prose (`ALFRED_PERSONA.md` §7). Adding a markdown feature to the renderer means updating that rule too.

### Auth — single-user, Google only
- Google Sign-In only; any other UID is signed straight out (`auth/unauthorized-uid`). The allowed UID is defined once per runtime: `apps/web/lib/allowed-uid.ts` and `functions/index.js` (both overridable by env). The client check is UX only.
- Real enforcement is server-side in `functions/index.js`: every request except `/` and `/health` needs a valid Firebase ID token (401) with the allowed UID (403), plus an App Check token (enforced; off in the emulator, `ENFORCE_APP_CHECK=false` disables it). The user is always the token's UID; a mismatched `userId` is rejected and another user's conversation is a 404.
- Pinned by `tests/unit/uid-whitelist.test.ts`, `auth-error-messages.test.ts` and `web-api-client.test.ts`.

### Deployment
- Firebase Hosting serves `apps/web/out` (build it first), rewrites `/api/**` to `api` and everything else to `index.html`. No App Hosting, no server runtime.
- `.github/workflows/ci.yml` runs every check listed under **Commands** plus the functions bundle build/check on each PR (Node 22, no `.env`; `.nvmrc` pins the same major for `nvm use` locally). `deploy.yml` reuses it, then builds and runs `firebase deploy --only hosting,functions,firestore:rules,firestore:indexes` on pushes to `main`, so any red check blocks the deploy.
- Rollback: `firebase hosting:rollback`.
- `.github/workflows/preview.yml` deploys each PR's web app to the fixed Hosting channel `preview` and comments the URL (UI only: `/api/**` there is the production function and data). Its domain must be in Firebase Auth's authorized domains and the reCAPTCHA key (`docs/OPERATIONS.md`, "Preview channel").
- `.github/workflows/backup.yml` dumps Firestore every Sunday, encrypts it with the `BACKUP_PASSPHRASE` secret and keeps it as a 90-day artifact (`docs/OPERATIONS.md`, "Firestore backups"). The dump script must never print document content: workflow logs are public once the repo is.

### Functions bundle — `functions/` imports `src/` via esbuild
`functions/index.js` is the **source**; `functions/build.js` bundles it with the `src/` modules it imports into `functions/lib/index.js` (gitignored; built by the `predeploy` hook). Only `functions/` is uploaded.
- Import shared code by **relative path** to the `.js` specifier of the `.ts` file (`../src/data/vector/cosine-similarity.js`).
- npm packages are not bundled: a `src/` module needing a new package means adding it to `functions/package.json` (`build.js` fails otherwise).
- Only bundle pure modules: nothing may read files at import time or pull in `src/core/config` (it imports `dotenv`). That's why the profile reaches the bundle through the committed `user-profile.generated.ts`.
- `"gcp-build": ""` in `functions/package.json` is deliberate (Cloud Build has no `../src`). Don't remove it.
- **Anything changed in a shared module ships to production.** Shared today: the `web_search` tool (`src/ai/tools/web/web-search.ts`), the system prompt and user-profile digest, the memory-extraction prompt/validation/pipeline and its provider calls, `PrivacyFilter`, the memory write planner and loop, cosine similarity, conversation titles, the `get_current_time` tool and timezone resolver, the embedding client, the Groq rate-limit policy, the chat fallback and the `/health` answer (`health-status.ts`, which resolves providers exactly like `/chat`). The full list with exact semantics is in `docs/PRODUCTION_INTERNALS.md`. Many are pinned by differential tests against verbatim copies of the former production code in `tests/unit/fixtures/` (`legacy-*.js`); **do not edit those fixtures**.
- The one intended difference is storage: production keeps the vector inside the Firestore record and commits a supersede in one batch; `MemoryService` writes the repository and a separate vector store, new record first, so a failure leaves a duplicate rather than a lost fact.

### Web search (`web_search`)
- `src/ai/tools/web/web-search.ts` (bundled): Tavily `POST /search`, basic depth (1 credit; free plan 1,000/month), at most 5 http(s) results trimmed to 400 characters, errors as short `{ error }` strings that never contain the key. Each `/chat` request gets one `createTurnWebSearch` session: a repeated query (case, spacing and ı/i ignored) is answered from the first result, and after 1 search further calls get the same results back (`reused`), so the provider fallback's turn restarts spend no new credits (before this, one question spent 6 searches across three providers). The round after a `web_search` offers no tools (`finalRoundAfter: ["web_search"]` in `runChatTurnWithFallback`), so the model answers from the results: a second search round resent the prompt with both result sets and broke Groq's 8,000 tokens/min on a single question (live, 28 Sep). The chat turn awaits async tools (`runTool` may return a promise; a throw becomes `{ error }`).
- Offered only when `TAVILY_API_KEY` is usable (`isUsableApiKey`; `unset` leaves it out). The prompt follows the same flag (`buildAlfredSystemPrompt({ webSearchAvailable })`), so it never promises a tool that is not offered; its rules say results are untrusted data and sources must be named. The web variant is the production prompt fixture and sits right at the 2,400-token budget (2,394–2,398 across providers): any addition to the persona now needs a matching trim.
- The web app shows "Web'de aranıyor…" while it runs (`apps/web/lib/tools.ts`).

### Secrets — LLM keys live only in Secret Manager
- `GROQ_API_KEY`, `GEMINI_API_KEY`, `CEREBRAS_API_KEY`, `OPENROUTER_API_KEY` and `TAVILY_API_KEY` (web search) are bound with `defineSecret()` and never taken from the caller or the browser. A deploy fails if a bound secret doesn't exist; create it first (`firebase functions:secrets:set NAME`, value `unset` if there is no key yet, which makes the fallback skip that provider).
- **Never put these keys in `functions/.env`:** it is deployed as plain env vars, and Cloud Run then rejects the update ("Secret environment variable overlaps non secret environment variable"). Fix by removing the plain variable from the `api` Cloud Run service and redeploying, not by reverting to `process.env`.
- `src/` and the local Next.js app read `process.env` from `.env`; the emulator reads `functions/.secret.local`.

## Notes for future sessions

- Env files: the root `.env.example` (placeholders, e.g. `gsk_your_groq_api_key_here`) is for `src/`, scripts and integration tests only; `apps/web/.env.example` holds the optional Next.js overrides (Next reads env files from `apps/web/`, not the root); the Functions emulator reads keys from `functions/.secret.local` and other settings from `functions/.env`. The real Groq key lives in the gitignored root `.env`; `functions/.env` must not contain `GROQ_API_KEY` / `GEMINI_API_KEY` (see **Secrets**). The `AIzaSy…` literal in `apps/web/lib/firebase.ts` is the public Firebase web config key, not a secret. There is no App Check debug token in the repository: `lib/app-check-debug.ts` enables debug mode only on localhost / `next dev`, with `NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN` from `apps/web/.env.local` or an SDK-generated per-browser token; don't reintroduce a committed fallback or a production `?debug_token=true` switch.
- Much of `src/` is still scaffolding. Implemented: `ai/providers`, `ai/embedding`, `ai/prompts`, `ai/tools`, `alfred/cognitive/context`, `alfred/cognitive/memory`, `alfred/control-plane/{tool-router,permission-system}`, `alfred/execution-plane/ssh`, `core/{config,errors,logging}`, `data/{firestore,vector}`, `voice/{stt,tts}`. Still empty `.gitkeep` placeholders: every other `execution-plane` capability (github, gmail, calendar, browser, terminal, files, web-search), `control-plane/{planner,scheduler,event-processor}`, `ai/{agents,middleware}`, all of `alfred/persona/*`, `core/{events,types,permissions}`, `data/{repositories,schemas,graphql}` and all of `integrations/*`. Check before assuming a capability exists.
- `README.md` and many code comments (notably `functions/index.js`) are in Turkish. The README's hero (`assets/readme/hero.svg`) quotes two real production replies from 24 Sep 2026, its "Canlıda doğrulanan davranışlar" table lists only behaviour seen in production logs, and `assets/readme/architecture.svg` draws the request path (browser → `api` → Groq/Gemini/OpenRouter → SSE) plus prompt, time tool and memory; keep both in sync when the provider chain, auth or tools change.
- `docs/history/` holds dated milestone reports (5–6 Sep 2026) kept for the record; each starts with a "then vs now" table. They do not describe the current system; `docs/ARCHITECTURE.md`, `docs/PRODUCTION_INTERNALS.md` and this file do.
- `.agents/skills/` holds a vendored `beautify-github-readme` skill (used for `assets/readme/` art); it is not application code.
- `dist/`, `audio_output/`, `.next/`, `.firebase/` and `functions/lib/` are generated and gitignored; `users/` and `assets/` are tracked on purpose.
