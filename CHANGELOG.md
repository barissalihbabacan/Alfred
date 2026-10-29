# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- Removed: browser-based Setup-UI and its local server; the setup wizard moves to a terminal UI.

### Added

- **Setup-UI Hardening & Zero-Touch Provisioning Wizard**:
  - Bound setup server strictly to `127.0.0.1` (loopback) with session token protection (`X-Setup-Token`).
  - Disallowed client-supplied scripts; bash generation is performed server-side by the Rust Wasm engine (`crates/setup-core`).
  - Implemented POSIX shell escaping (`shell_quote`) and secret-free script generation passing keys via Secret Manager stdin.
  - Isolated script execution in temporary directories (`fs.mkdtempSync`) with `0700` permissions.
  - 5-step wizard with real-time log streaming, billing account selector, Firestore region selection, and Post-Deployment Checklist.
- **Fail-Closed Authorization & Zero-Touch Onboarding**:
  - Added `verifyUserAuthorization` in `src/core/permissions/authorization.ts` enforcing strict fail-closed access.
  - Zero-touch onboarding: allows verified email sign-in when `ALLOWED_UID` is unconfigured.
  - Dynamic Firebase client SDK configuration and project ID resolution without hardcoded defaults.
- **CI Hardening**:
  - Added `rust-toolchain.toml` and GitHub Actions CI steps for `cargo test` and `cargo clippy -- -D warnings`.

### Changed

- **Project-neutral template**: the repository no longer carries a Firebase project. `.firebaserc` and `functions/.env.<projectId>` are gitignored (each instance runs `firebase use <id>` / `--project <id>`; `functions/.env.example` documents the keys), the owner-specific `deploy.yml` and `preview.yml` workflows are removed, `backup.yml` is opt-in (`FIREBASE_SERVICE_ACCOUNT` + `BACKUP_PASSPHRASE`), the hosting predeploy hook validates the web config against the deploy target, and the Google OAuth fallback redirect is derived from the function's project.
- **No owner infrastructure defaults**: production uses Ollama only when `OLLAMA_BASE_URL` is set (unset skips the embedding / extraction fallback and the `/health` probe); `src/` defaults to `http://localhost:11434`; the SSH `home-server` alias resolves through `SSH_HOME_SERVER_HOSTNAME` / `_USERNAME` (default: the alias itself and `$USER`), the second machine and owner host aliases are gone (use `SSH_HOSTS_JSON`); the system prompt says "self-hosted Ollama".
- **Example profile from `templates/`**: `users/*.md` and the profile digest are now the neutral `npm run profile:init -- --defaults --date 2026-10-29` output ("Alex Doe"). `profile:init` renders the digest from `templates/user-profile.digest.template.md` (it used to keep the previous digest body and only swap the hashes) and no longer overwrites `docs/persona/ALFRED_PERSONA.md`.
- **Owner name from the profile**: the system prompt, the memory-extraction prompt and the morning-briefing push name the owner from `users/USER_PROFILE.md` (`PROFILE_OWNER` in `src/alfred/cognitive/context/profile-owner.ts`, so `profile:init --name` sets it) instead of a hard-coded name; tool descriptions say "the user"; the web app's description is neutral and the chat export uses the signed-in Google name.

## [0.1.0] - 2026-10-28

### Added

- **Cognitive Architecture & Senior Persona**: Honest, technically disciplined conversational partner with reasoned objection logic against destructive commands (dropping production databases, skipping tests, arbitrary execution).
- **Multi-Tier Model Failover Chain**: Zero-downtime turn-level failover:
  - Global stack: Groq (`gpt-oss-120b`) → Google Gemini (`gemini-3.8-flash`) → Local Ollama (`gemma4:12b`).
  - Turkish national stack: TÜBİTAK BİLGEM EVREN LLM (`qwen3.8-flash-next`, 15M free tokens/day).
- **Autonomous Long-Term Vector Memory**: Post-turn autonomous fact extraction pipeline with Gemini 768-dimensional embeddings, regex/heuristic secret scrubbers, and atomic Firestore batch deduplication/supersession.
- **Fact-Checked Web Search & Tools**:
  - Live Tavily search integration with automated news topic routing and clickable markdown citations.
  - Multi-city timezone and Daylight Saving Time (DST) calculation tool (up to 6 cities per call).
- **Web Application & Voice UI (`apps/web`)**: Next.js 16 App Router frontend with voice input (microphone), dark-mode butler theme, Server-Sent Events (SSE) streaming with live thought disclosure, and PWA capabilities.
- **Enterprise Security & Zero Trust**:
  - Dual-whitelist gateway authorization (`ALLOWED_EMAIL` + `ALLOWED_UID`).
  - Firebase App Check attestation token enforcement.
  - Zero-trust Firestore security rules (`allow read, write: if false;`).
  - Gitleaks automated credential/secret scanner and CodeQL static application security testing (SAST).
  - Dependabot automated weekly dependency vulnerability patching.
- **Community & Governance Infrastructure**:
  - Contributor Covenant Code of Conduct (`CODE_OF_CONDUCT.md`).
  - Comprehensive contributing guide (`CONTRIBUTING.md`).
  - Coordinated vulnerability disclosure policy (`SECURITY.md`).
  - Structured GitHub Issue Forms for bug reports and feature requests.
  - Pull request template with comprehensive pre-merge verification checklist.
  - GitHub branch protection on `main` enforcing 1 review and `Typecheck & Unit Tests` passing.
- **Testing & Verification**: 72 test suites, 968 unit tests, and differential regression invariants. 100% strict TypeScript (98.8% TS, 0% JS, 0% Python on GitHub).
