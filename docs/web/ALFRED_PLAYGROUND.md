# B.U.T.L.E.R. Alfred — Web Voice & Chat Front End

> **Document Status**: Current production architecture (Next.js static export), checked against the code on 24 Sep 2026
> **Target Audience**: Developers, Operators
> **Repository Target**: `apps/web/`
> **Firebase Project**: `butler-alfred` (Display: `BUTLER Alfred`)

---

## 1. Summary

`apps/web/` is the only front end for Alfred. It is a Next.js 14 App Router app built with `output: "export"`: `npm run build:web` writes plain static files to `apps/web/out`, and Firebase Hosting serves that directory. There is no server runtime for the web app — no route handlers, no SSR, no middleware. Every backend operation goes to the `api` Cloud Function in `functions/index.js` through the Hosting rewrite `/api/** → api`.

It replaced the earlier vanilla-JS front end (`apps/web/public/index.html`, `app.js`, `firebase-app.js`, `styles.css`), which has been removed.

---

## 2. Architecture & Data Flow

```
Browser
  │  apps/web/out (static HTML/JS from Firebase Hosting, /_next/static cached 1y)
  │
  │  1. Firebase Auth: Google Sign-In (popup, redirect fallback)
  │     └─ UID != allowed UID → signed out, "auth/unauthorized-uid"
  │  2. App Check (reCAPTCHA Enterprise) token
  │
  │  apiFetch() adds:  Authorization: Bearer <Firebase ID token>
  │                    X-Firebase-AppCheck: <App Check token>
  ▼
Firebase Hosting rewrite  /api/**  →  Cloud Function `api` (functions/index.js)
  │   GET    /api/health                        (public)
  │   GET    /api/chat?userId=…                  conversation list
  │   GET    /api/chat?conversationId=…          conversation messages
  │   DELETE /api/chat?conversationId=…          delete conversation
  │   POST   /api/chat  (SSE)                    chat turn
  ▼
Groq openai/gpt-oss-120b → Gemini gemini-3.8-flash → OpenRouter  (fallback chain)
Firestore (conversations, memory_vectors)
```

Speech input uses the browser Web Speech API (`SpeechRecognition`, TR/EN selectable in the top bar); speech output uses `window.speechSynthesis` via the "Seslendir" button on each Alfred message. No audio is sent to the server.

### Key files

| File | Role |
| :--- | :--- |
| `app/page.tsx` | Auth gate: spinner while Firebase restores the session, `LoginScreen` when signed out, `VoiceChatPlayground` once an allowed user is present. |
| `components/LoginScreen.tsx` | Google sign-in (popup + "Doğrudan Yönlendirme ile Giriş"), Turkish error banner, Firebase console hints. |
| `components/VoiceChatPlayground.tsx` | Chat UI: conversation list, streaming messages, mic, speech output, settings and account modals. |
| `lib/auth.ts` | Google sign-in, redirect fallback, UID allow-list, `getAuthErrorDetails()` Turkish error messages. |
| `lib/AuthContext.tsx` | React context around `lib/auth.ts`; also surfaces redirect-result and unauthorized-UID errors. |
| `lib/firebase.ts` | Firebase config, App Check init, `getAppCheckToken()`. |
| `lib/api.ts` | `apiFetch()` — the only way the UI calls the backend. |
| `lib/sse.ts` | Parser for the `/chat` SSE stream. |

---

## 3. Auth contract

- Every `api` endpoint except `/` and `/health` requires `Authorization: Bearer <Firebase ID token>` of the allowed user. The user id is taken from the token; a `userId` in the query/body must match it.
- `VoiceChatPlayground` mounts only after Firebase has restored an allowed session, so its first requests already carry a token. `apiFetch()` refuses (locally, with a 401 `ApiError`) any authenticated call made without a signed-in user.
- The client-side UID check (`lib/auth.ts`) only keeps other Google accounts on the gate; the real check is server-side in `functions/index.js`.
- **App Check is enforced** on every endpoint except `/` and `/health`. A missing or invalid `X-Firebase-AppCheck` token gets a 401 with a Turkish message and `code: "app_check_missing"` / `"app_check_invalid"`. A browser whose reCAPTCHA Enterprise script is blocked (e.g. by an ad blocker) therefore cannot chat.

---

## 4. `/chat` SSE stream

`POST /api/chat` with `{ message, conversationId?, userId? }` answers with `text/event-stream` (the endpoint is SSE-only; a `stream` field in the body is ignored). Each event is one `data: <json>\n\n` frame:

| `type` | Fields | UI effect |
| :--- | :--- | :--- |
| `start` | `conversationId`, `provider`, `model` | Stores the conversation id (`localStorage["alfred_conversation_id"]`), refreshes the list, updates the model label. |
| `thinking` | — | "Düşünüyor..." bubble, status `Thinking`. |
| `chunk` | `text` | Appends text, status `Streaming`. `<think>…</think>` traces are stripped before rendering. |
| `tool_call` / `tool_result` | `tool`, … | Status stays `Thinking`. The only tool is `get_current_time`, called once with every city (`{"cities": [...]}`). |
| `rate_limited` | `provider`, `waitMs`, `attempt` | Sent just before the server waits out a 429; the bubble shows a countdown ("Groq sınırına ulaşıldı, ~15 sn bekleniyor…"). |
| `provider_fallback` | `from`, `to`, `model`, `reason` | The turn restarts on the next provider (only before any text was streamed); the bubble says e.g. "Groq sınıra ulaştı, Gemini'ye geçiliyor…" and the model label changes. |
| `done` | — | Finalises the message and **releases the composer**. The server may keep the connection open for a few seconds while it writes long-term memory; the UI does not wait for the close. |
| `error` | `error`, and on a rate limit `code: "rate_limited"`, `limitType`, `retryAfterMs` | Shows the error banner and keeps any partial text. Rate-limit messages name the real limit and wait (e.g. "Groq'un günlük token limiti doldu. Lütfen yaklaşık 3 dakika sonra tekrar deneyin."). An empty model answer is an error too, never a silent success. |

Errors before the stream starts (400/401/403/404/500) come back as JSON `{ error }` and are shown in the same banner. A per-turn guard ensures a stream that closes late (after `done`) cannot reset the state of a newer turn.

---

## 5. UI states

| State | Indicator | Description |
| :--- | :--- | :--- |
| **Ready** (`Idle`) | Green dot | Waiting for input. |
| **Listening** | Red pulsing dot | Web Speech recognition is active. |
| **Thinking** | Blue pulsing dot | Request sent / model reasoning / tool running. |
| **Streaming** | Gold pulsing dot | Response text is arriving. |
| **Speaking** | Green pulsing dot | `speechSynthesis` is reading a message aloud. |
| **Error** | Red dot | Error banner shown; cleared on the next message. |

Keyboard: `Enter` sends, `Shift+Enter` inserts a newline, `Cmd/Ctrl+K` starts a new conversation.

---

## 6. Local development

```bash
npm ci

# Hot-reload dev server on http://localhost:3000.
# /api/** is proxied to ALFRED_API_ORIGIN (dev only; the export has no rewrites).
npm run dev:web                                                     # → Functions emulator (default)
ALFRED_API_ORIGIN=https://butler-alfred.web.app/api npm run dev:web  # → production API

# Production build (static export to apps/web/out) and a local preview with
# the real firebase.json rewrites and headers:
npm run build:web
firebase serve --only hosting
```

The default `ALFRED_API_ORIGIN` is `http://127.0.0.1:5001/butler-alfred/us-central1/api` (start it with `firebase emulators:start --only functions`; App Check is not enforced in the emulator). Sign-in needs `localhost` in Firebase Auth → Authorized domains. On `localhost` (or with `?debug_token=true`) the App Check debug token is used, so **against the production API that debug token must be registered in the Firebase console** (App Check → Apps → Manage debug tokens), otherwise every call gets 401.

Web-only variables (`NEXT_PUBLIC_*`, `ALFRED_API_ORIGIN`) are read by Next.js from `apps/web/`, not from the repository root: copy `apps/web/.env.example` to `apps/web/.env.local` if you need to override them. The committed defaults in `lib/firebase.ts` / `lib/allowed-uid.ts` are what production uses.

Checks that CI runs on every PR:

```bash
npm run lint
npm run typecheck
npm run typecheck:tests
npm run test:unit
npm run build --prefix functions && npm run check:bundle --prefix functions
npx tsc -p apps/web/tsconfig.json --noEmit
npm run build:web
```

---

## 7. Deployment

- `firebase.json` → `hosting.public: "apps/web/out"`, rewrites `/api/** → api` and `** → /index.html`; `Cache-Control: no-cache` everywhere except `/_next/static/**` (`public, max-age=31536000, immutable`).
- `.github/workflows/deploy.yml` runs on pushes to `main` that touch app code (`apps/`, `src/`, `functions/`, Firebase config, package files or the workflows): the CI job above must pass, then it runs `npm ci`, `npm run build:web`, the functions bundle build and `firebase deploy --only hosting,functions,firestore:rules,firestore:indexes`.
- Manual deploy: `npm run build:web && npx firebase-tools deploy --only hosting,functions,firestore:rules,firestore:indexes`.
- Rollback: `firebase hosting:rollback`, or Firebase console → Hosting → Release history → Roll back. This restores the previous static release without a rebuild; the Cloud Function is not affected.

---

## 8. Known gaps

- **No server-side STT.** The removed Next.js `/api/stt` route (Groq Whisper) was not used by either UI; speech input is browser-only, so it depends on Web Speech support (Chrome/Edge/Safari; not Firefox).
- **No reCAPTCHA action token.** The vanilla front end also sent an `x-recaptcha-token` header from `grecaptcha.enterprise.execute()`; the `api` function never verified it, so it was dropped. App Check still covers the requests.
- **Provider is server-controlled.** The settings modal shows the active engine from `/api/health`; the old, disabled Ollama URL field is gone. Which provider actually answered a turn arrives in `start` / `provider_fallback`.
- **Committed App Check debug token.** `lib/firebase.ts` falls back to a hard-coded debug token when `NEXT_PUBLIC_APPCHECK_DEBUG_TOKEN` is unset. If that token is registered in the Firebase console, anyone with the repository can pass App Check; keep it unregistered, or register only a private token set through `apps/web/.env.local`.
