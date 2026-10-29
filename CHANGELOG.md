# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-29

First public release. A personal AI assistant for exactly one person, deployed into that person's own Firebase project.

### Added

- **Conversation:** English and Turkish replies in the user's language, streamed over Server-Sent Events, rendered as Markdown with linked sources; a Next.js 16 static-export web app that installs as a PWA, with browser voice input.
- **Provider failover:** EVREN → Groq → Gemini. A rate limit or error before the first streamed token restarts the whole turn on the next provider; after the first token the provider is fixed. Groq 429s wait the real requested time only within a 25 s turn budget.
- **Long-term memory:** after each reply, an isolated extraction step stores durable facts and preferences, never attributes the assistant's words to the user and rejects anything that looks like a secret. Memories can be reviewed, added and retracted in the app; each project workspace has its own memory.
- **Tools**, offered only when configured: `web_search` (Tavily, one search per question), `read_url`, `github` (read-only), `google_calendar`, `google_tasks`, `gmail` (including drafts and sending), `get_current_time` (several cities per call), and whitelisted commands on a home server through a Firestore relay with no open ports.
- **Morning briefing** every day at 09:00 (Europe/Istanbul) as a push notification.
- **Alfred Setup** (`crates/alfred-setup`): a Rust terminal wizard for project, billing account, Firestore region, owner name and Google account, API keys and a live deploy, in English and Turkish. API keys go to Secret Manager and never into the provisioning script. The README's **Launch Alfred Setup** button opens it in Google Cloud Shell through a custom image (`.cloudshell/`); `npm run setup -- --demo` runs it locally without deploying.
- **Owner name from the profile:** prompts and the morning briefing address the owner by the name in `users/USER_PROFILE.md`, set by `npm run profile:init -- --name … --full-name …`; prompts refer to the user with neutral pronouns.

### Security

- Google Sign-In for a single owner, enforced on the server with a verified ID token and App Check; authorization fails closed when no owner is configured, and a verified e-mail is accepted when no UID is set.
- LLM, search and OAuth keys live only in Secret Manager. Structured logs never contain message text, keys or tokens; Cloud Monitoring alerts are built on them.
- Firestore rules deny all client access. Gitleaks, CodeQL and Dependabot run on the repository.

### Changed

- The repository is a project-neutral template: no Firebase project, deploy workflow, profile or infrastructure of the original owner. `.firebaserc` and `functions/.env.<projectId>` stay local (`functions/.env.example` documents the keys), the weekly Firestore backup workflow is opt-in, and the hosting predeploy hook checks the web config against the deploy target.
- Ollama is used only when `OLLAMA_BASE_URL` is set; the SSH home-server host comes from `SSH_HOME_SERVER_HOSTNAME` (or `SSH_HOSTS_JSON`).
- Fresh installs start with `ENFORCE_APP_CHECK=false` until a reCAPTCHA key is configured.

### Removed

- The browser-based setup UI and its local server, replaced by the terminal wizard.

[Unreleased]: https://github.com/barissalihbabacan/Alfred/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/barissalihbabacan/Alfred/releases/tag/v0.1.0
