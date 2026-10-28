<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="Alfred: Open-source, self-hosted personal AI butler and software engineering partner.">
</p>

<p align="center">
  <a href="https://github.com/barissalihbabacan/Alfred/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="MIT License"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-98.8%25-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 98.8%"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-22+-43853D?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 22+"></a>
  <a href="https://firebase.google.com/"><img src="https://img.shields.io/badge/Firebase-Hosting%20%26%20Functions-FFCA28?style=flat-square&logo=firebase&logoColor=black" alt="Firebase"></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/Self--Hosted-Privacy--First-10B981?style=flat-square" alt="Self-Hosted"></a>
</p>

<p align="center">
  <b>English</b> · <a href="./README.tr.md">Türkçe</a>
</p>

<p align="center">
  <a href="#what-alfred-does">What It Does</a> ·
  <a href="#live-verified-behaviors">Live Proof</a> ·
  <a href="#how-it-works">Architecture</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#development">Development</a> ·
  <a href="#documentation">Documentation</a>
</p>

---

**Alfred** is an open-source, single-user, self-hosted **personal AI butler and software engineering partner**. It talks like an experienced peer—concise, technically rigorous, and honest—automatically extracts and retains persistent preferences across conversations, and directly objects to destructive or risky engineering choices (such as dropping production databases or bypassing tests) with reasoned alternatives.

> **Why just Alfred?**  
> *"Because I love BATMAN and I am BATMAN."* 🦇

---

## What Alfred Does

- **Bilingual fluency (English & Turkish).** Responds in whichever language you address it in, with natural conversational cadence and native voice input (microphone) support.
- **Multi-tier LLM failover chain.** Seamlessly switches across providers before streaming tokens: **Groq (`gpt-oss-120b`) → Gemini (`gemini-3.8-flash`) → Local Ollama** (supports regional national models like TÜBİTAK EVREN LLM as well; see [Türkçe](./README.tr.md)).
- **Autonomous long-term vector memory.** Silently extracts preferences and durable facts post-turn via an independent classification pipeline, scrubs secrets (API keys, passwords, tokens), embeds vectors via Gemini, and commits atomic deduplications/supersessions to Firestore.
- **Reasoned objection.** Rejects reckless operations without sycophancy: explains the concrete failure mode and presents a safe, production-grade alternative.
- **Live web search with factual citations.** Integrates Tavily search with automatic news indexing (`topic: "news"`), prunes stale SEO/clickbait, and embeds clickable markdown links (`[source](url)`) for every factual assertion.
- **Multi-city timezone engine.** Accurately resolves local time and Daylight Saving Time (DST) offsets for up to six global cities in a single tool call.
- **Zero hallucinations.** If an external integration (calendar, email, home server) is not connected, it states so plainly instead of fabricating mock data.

---

## Live-Verified Behaviors

All core behaviors are pinned in production with real conversation logs and automated regression suites:

| User Input | Alfred's Verified Behavior &amp; Response |
| :--- | :--- |
| *Should we drop the production database?* | **Direct Objection**: "No. Dropping the production database causes irreversible data loss and downtime; take a verified snapshot backup first…" |
| *What time is it in London, Tokyo, and Sydney?* | **Single Tool Call** (`["London","Tokyo","Sydney"]`): "London 14:03, Tokyo 22:03, and Sydney 23:03." |
| *Remember that I love green apple juice.* | **Autonomous Vector Memory**: `"User loves green apple juice" (user_preference)` |
| *Beşiktaş transfer news.* | **Tavily Web Search**: Auto-selects the verified news index, prunes stale seasons, and presents clickable citations. |

---

## How It Works

<p align="center">
  <img src="./assets/readme/architecture.svg" width="100%" alt="Alfred End-to-End Architecture Diagram: Next.js frontend, Cloud Functions gateway, EVREN/Groq/Gemini/Ollama failover chain, and background intelligence services.">
</p>

1. **Client (Web):** `apps/web` is a Next.js 16 (App Router) frontend statically exported to Firebase Hosting. It authenticates users via Google Sign-In and attaches Firebase App Check attestation tokens to every request.
2. **Security Gateway:** `functions/index.ts` (Cloud Functions 2nd Gen) serves as the sole backend gateway. It enforces strict dual-layer authorization (`ALLOWED_EMAIL` + `ALLOWED_UID` whitelist) and validates App Check tokens. All API keys live strictly within Google Secret Manager.
3. **Intelligent Failover Chain:**
   - **1. Groq** (`gpt-oss-120b`): Ultra-low latency global inference.
   - **2. Google Gemini** (`gemini-3.8-flash`): Cloud fallback tier.
   - **3. Local Ollama** (`gemma4:12b`): On-premise private offline fallback.
   *(Turkish citizens can also enable TÜBİTAK's EVREN LLM with 15M free tokens/day; see [Türkçe README](./README.tr.md)).*
   *If a provider encounters rate limits (HTTP 429) or timeouts before token streaming begins, the entire turn fails over cleanly to the next provider.*
4. **Real-Time Streaming (SSE):** Replies stream chunk-by-chunk via Server-Sent Events, surfacing reasoning thoughts, tool calls, and model handovers live in the UI.

---

## Quick Start

### ⚡ 1-Click Launch with Google Cloud Shell & Setup-UI

No local tools, Node.js, or SDK installations required! You can deploy your personal Alfred instance directly from your browser using Google Cloud Shell and our interactive **Rust + WebAssembly Setup-UI**:

[![Open in Cloud Shell](https://gstatic.com/cloudsdk/images/open-in-cloudshell.svg)](https://ssh.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/barissalihbabacan/Alfred&cloudshell_tutorial=.cloudshell/tutorial.md)

1. Click **Open in Cloud Shell** above to clone the repository into a pre-configured Google Cloud environment.
2. Launch the interactive setup wizard in the Cloud Shell terminal:
   ```bash
   npm run setup:ui
   ```
3. Click **Web Preview &rarr; Preview on port 8080** in the top-right corner of Cloud Shell.
4. Enter your Project ID, single-user Google account, and API keys. The **Rust + WebAssembly** engine validates all credentials client-side and provisions Google Secret Manager, Firestore, and Firebase Hosting in one click!

---

### Local Installation

### Prerequisites
- **Node.js**: v22+
- **Firebase CLI**: `npm install -g firebase-tools`
- **Model API Keys (Any combination)**:
  - [Groq Console](https://console.groq.com/)
  - [Google AI Studio (Gemini)](https://aistudio.google.com/)
  - [Tavily](https://tavily.com/) (For real-time web search)
  - *(Optional)* [TÜBİTAK BİLGEM EVREN API](https://evren-llmapi.ssyz.org.tr/) (For TR users via e-Devlet)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/barissalihbabacan/Alfred.git
cd Alfred
npm install
```

### 2. Initialize Your User Profile

Alfred dynamically injects your personal profile (`users/*.md`) into its system prompt. Generate your profile from templates in 60 seconds:

```bash
npm run profile:init
```

This interactive generator scaffolds `users/USER_PROFILE.md`, `users/PREFERENCES.md`, and `users/WORKING_STYLE.md` with your name, domain expertise, and engineering values.

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your authorization whitelist and API keys:

```env
ALLOWED_EMAIL="owner@example.invalid"
ALLOWED_UID="your_firebase_auth_uid"
GROQ_API_KEY="gsk_..."
GEMINI_API_KEY="AIzaSy..."
TAVILY_API_KEY="tvly-..."
# EVREN_API_KEY="evren_..."  # Optional: Turkish national LLM API
```

### 4. Run Locally

Launch the Next.js web application (`http://localhost:3000`):

```bash
npm run dev:web
```

To connect your local UI to a live deployed Cloud Function:

```bash
ALFRED_API_ORIGIN=https://<your-project>.web.app/api npm run dev:web
```

---

## Development

The codebase is engineered with strict type safety (**98.8% TypeScript**) and backed by 968 unit tests:

| Command | Purpose |
| :--- | :--- |
| `npm run test:unit` | Executes 968 unit tests across 72 files completely offline with zero mock leaks |
| `npm run typecheck` | Strict compiler typecheck across `src/` (`tsc --noEmit`) |
| `npm run typecheck:tests` | Typecheck across `tests/` and `scripts/` (`tsc -p tsconfig.tests.json`) |
| `npm run lint` | ESLint 9 verification (0 warnings, 0 errors permitted) |
| `npm run profile:init` | Compiles personalized profile files from Markdown templates |
| `npm run build:web` | Compiles the Next.js frontend to static files in `apps/web/out` |
| `npm run build --prefix functions` | Bundles `functions/index.ts` and core dependencies using esbuild |
| `npm run check:bundle --prefix functions` | Verifies export contracts of the bundled backend |
| `npm run test:integration:offline` | Runs offline integration tests as required by GitHub Actions CI |

---

## Project Structure

```text
Alfred/
├── apps/
│   └── web/                   # Next.js 16 App Router (static export frontend)
├── functions/                 # Firebase Cloud Functions 2nd Gen API (TypeScript)
│   ├── index.ts               # Cloud Function entrypoint wrapper
│   ├── api.ts                 # Chat, SSE streaming, and briefing handlers
│   ├── memory-extraction.ts   # Post-turn autonomous memory extraction pipeline
│   └── memory-persistence.ts  # Firestore atomic batch vector memory persistence
├── src/                       # Shared TypeScript core libraries
│   ├── ai/                    # LLM providers (EVREN, Groq, Gemini, Ollama), tools (Tavily, Time)
│   ├── alfred/                # Cognitive architecture, memory loop, privacy filters
│   └── data/                  # Firestore schemas and vector similarity functions
├── templates/                 # Dynamic templates for user profiles and persona
├── users/                     # Your active profile sources (compiled into prompt digest)
└── tests/                     # 968 unit tests and differential regression suites
```

---

## Documentation

- 🧠 [Assistant & Persona Specification](docs/persona/ALFRED_PERSONA.md): Tone, honesty, objection mechanics, and conciseness rules.
- 🏛️ [System Architecture](docs/ARCHITECTURE.md): Multi-tier storage, failure domains, and data flows.
- 🗺️ [Feature Roadmap](docs/FEATURE_ROADMAP.md): Milestones, upcoming capabilities, and operational targets.
- 💻 [Web Application Architecture](docs/web/ALFRED_PLAYGROUND.md): UI component breakdown, API endpoints, and state machines.
- 🛡️ [Operations & Runbook](docs/OPERATIONS.md): Cloud Monitoring alerts, rate limit thresholds, and runbooks.

---

## Community & Contributing

We welcome contributions! Please review our community guidelines before submitting a pull request:

- 🤝 [Contributing Guide](CONTRIBUTING.md): Workflow, typecheck requirements, and branch conventions.
- 📜 [Code of Conduct](CODE_OF_CONDUCT.md): Standards for a respectful and inclusive environment.
- 🔒 [Security Policy](SECURITY.md): Vulnerability reporting procedures and defense-in-depth model.

---

## License

This project is licensed under the [MIT License](LICENSE). © 2026 Barış Salih Babacan.
