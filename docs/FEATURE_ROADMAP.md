# Feature Roadmap — B.U.T.L.E.R. Alfred

Everything except new capabilities is done:
- Security: ID-token gate, Secret Manager keys, locked Firestore rules, role policy.
- Memory: working, with shared validation and persistence decisions.
- Honesty: no placeholder tools.
- CI/CD: lint, typechecks, tests, bundle and web build gate every deploy.
- Shared code: production and `src/` share the prompt, memory, time and embedding modules.

This page lists the candidate features, what each one needs from Barış, and a suggested order. Pricing and quota notes are indicative and should be checked when a provider is chosen.

---

## How a new capability is added (the pattern every feature follows)

1. **Pure logic in `src/`:** tool definition, argument validation, response shaping. Unit-tested offline with a mocked `fetch`.
2. **Wired into `functions/index.js`:**
   - add the definition to `activeTools` (line ~845);
   - add a branch in the tool loop next to `get_current_time` (line ~1086);
   - emit the existing `tool_call` log event.

   At most 3 tool rounds per turn (`MAX_TURNS`).
3. **Credentials in Secret Manager**, via `defineSecret()` added to the `api` function's `secrets` list, never in `functions/.env`. New npm packages go into `functions/package.json`, because the bundle keeps npm deps external.
4. **Persona:** the capability line and tool rules in `src/ai/prompts/alfred-system-prompt.ts`. Remove the capability from the "Not yet connected" list, and never let the prompt promise a tool that isn't offered (see the SSH precedent).
5. **Tests:** a contract test for the tool, plus a prompt fixture update (`vitest -u`).

---

## Candidates

### 1. Web search — done (28 Sep 2026)
Implemented as `web_search` with Tavily (free plan: 1,000 basic searches a month, no card); see CLAUDE.md "Web search". The notes below are the original plan.

- **Value:** High. Current events and fact checks, which Alfred cannot do today.
- **Effort:** Small (about half a day).
- **Needs from Barış:** a provider choice and its API key:
  - Tavily: built for agents, returns summarised results with sources, free tier;
  - Brave Search API: independent index;
  - SerpAPI: Google results, mostly paid.
- **Shape:** one tool, `web_search(query)`, returning the top 3–5 results (title, url, snippet or summary). Alfred cites sources in speech-friendly prose.
- **Risk:** Low. The API is read-only. Prompt injection from web pages should be treated as data, not instructions: the prompt must say so.

### 2. Google Calendar (read-only first)
- **Value:** High for an executive assistant ("What's on tomorrow?").
- **Effort:** Medium (1–2 days).
- **Needs from Barış:**
  - a Google Cloud OAuth consent screen, as an internal or testing app with only his account;
  - a one-time consent in the browser;
  - the refresh token then stored in Secret Manager.
- **Shape:** `calendar_list_events(from, to)`, in read-only scope (`calendar.readonly`). Writing events (`calendar.events`) comes later, and would be a `WRITE`/confirmation-gated action.
- **Risk:** Medium. It touches personal data, so least scope and no event text in logs.

### 3. Gmail (read-only summaries)
- **Value:** High ("Summarise my unread mail").
- **Effort:** Medium to large.
- **Needs from Barış:** the same OAuth setup as Calendar with `gmail.readonly`. Gmail scopes are "restricted" in Google's policy; for a personal testing-mode app with one user this is workable, but it must stay unpublished.
- **Shape:** `gmail_list_unread(max)` → sender, subject, snippet; `gmail_get_message(id)` → plain text, truncated.
- **Risk:** High sensitivity. Never store mail content in long-term memory without an explicit request, and keep it out of logs.

### 4. Real SSH to the home server
- **Value:** Medium. Server diagnostics were the original intent of the SSH tools.
- **Effort:** Medium to large; it needs design.
- **Needs from Barış:**
  - a network path from Cloud Run to the home server: a Tailscale auth key for a userspace Tailscale client, or a small authenticated relay on the server;
  - an SSH key in Secret Manager;
  - agreement on the allow-list (the five existing read-only commands).
- **Shape:** the machinery already exists in `src/alfred/execution-plane/ssh/`: the ssh2 client, command registry, path sandbox and `ls` parser. Production would turn on `sshAvailable: true` in the prompt and re-add the three tool definitions.
- **Risk:** High. Remote execution means strict allow-list, `EXECUTE`/owner-only and audit logs.

### 5. Scheduled briefings (planner / scheduler, phase 1)
- **Value:** Medium to high, and it becomes more valuable once 1–3 exist, e.g. a morning brief with calendar, mail and news.
- **Effort:** Medium.
- **Needs from Barış:** the schedule and delivery channel. Options: a message waiting in the web app, email, or a push notification, which would need FCM and the web app registering a token.
- **Shape:** a scheduled Cloud Function (`onSchedule` from `firebase-functions/v2/scheduler`, already available in `firebase-functions` 6) runs a fixed prompt with the tools and writes the result as a new conversation.
- **Risk:** Low to medium; mainly cost and quota discipline.

### 6. Cloud text-to-speech voice
- **Value:** Medium. A consistent British butler voice instead of the browser/OS voice.
- **Effort:** Small to medium.
- **Needs from Barış:** a provider (ElevenLabs, OpenAI TTS, or Google Cloud TTS with an en-GB Neural2/Studio voice) and a key. It is paid per character.
- **Shape:** a new `POST /api/tts` in `functions/index.js` returning audio, played by the web app. (The browser `speechSynthesis` playback was removed on 27 Sep 2026 because Barış does not need read-aloud for now; the persona prompt would also need its formatting rule revisited for spoken replies.) `src/voice/tts` already has the `ITTSProvider` abstraction.
- **Risk:** Low; the main consideration is cost.

### 7. Multi-step planning (planner, phase 2)
- **Value:** High long term ("Check the server, summarise errors, add a review to my calendar").
- **Effort:** Large.
- **Needs:** at least two real tools first (1–4). Today's 3-round tool loop already chains simple steps, and a planner only pays off once there is something to plan over.

---

## Suggested order

1. ~~**Web search.**~~ Done (Tavily).
2. **Calendar (read-only).** It sets up the OAuth plumbing that Gmail reuses.
3. **Gmail (read-only).**
4. **Scheduled morning brief.** It combines 1–3.
5. **Real SSH, cloud TTS and the multi-step planner**, as priorities dictate.

## Decisions to bring to the session

- Whether to set up the Google OAuth consent screen now (Calendar and Gmail).
- The delivery channel for scheduled briefings.
- Whether to enable App Check enforcement: check `app_check` on recent `llm_request` logs first; if it is consistently `valid`, set `ENFORCE_APP_CHECK=true`.
