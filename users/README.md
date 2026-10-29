# Canonical User Profile Layer — B.U.T.L.E.R. Alfred

> **Layer Status**: Canonical Reference Layer  
> **Authority**: Git Version-Controlled Repository (SSOT for Authored Knowledge)  
> **Target Consumer**: Alfred Cognitive Core (`src/alfred/cognitive/context/`) & Context Builder

---

## 1. Executive Purpose

The `users/` directory establishes Alfred's **canonical user profile layer** — the version-controlled "local disk" containing consciously authored, stable information about its user.

The committed `USER_PROFILE.md`, `PREFERENCES.md` and `WORKING_STYLE.md` are a **neutral example** ("Alex Doe"), rendered from `templates/` by `npm run profile:init -- --defaults --date 2026-10-29`. Each installation renders its own with `npm run profile:init` (interactive, or `--name`, `--full-name`, `--role`, …), which also rewrites the digest the system prompt carries and `user-profile.generated.ts`.

This directory serves as the definitive baseline that shapes Alfred's conversational demeanor, technical depth, pushback threshold, and collaboration dynamic.

---

## 2. Core Architectural Principles: Tripartite Storage Model

Alfred strictly separates storage tiers according to ownership, volatility, and authority. The three tiers must never compete as conflicting sources of truth for the same data.

| Dimension | Git Repository (`users/`) | Firestore Database (Future) | Vector Database (Future) |
| :--- | :--- | :--- | :--- |
| **Role** | **Canonical Authored Baseline** | **Dynamic Operational Memory** | **Semantic Retrieval Index** |
| **Authority** | **Authoritative (SSOT)** for authored profile & preferences | **Authoritative (SSOT)** for conversation history & learned state | **Authoritative for NOTHING** (pure index) |
| **Volatility** | Low (Static, version-controlled, deliberate commits) | High (Dynamic, continuously updated per session) | Reconstructible (Ephemeral index derived from SSOTs) |
| **Content** | Baseline identity, preferences, working style, boundaries | Past session turns, episodic events, evolving preferences | High-dimensional embeddings over canonical & dynamic texts |
| **Modification** | **Human-authored only** (Alfred never mutates these files) | Programmatic append/mutation by Alfred cognitive runtime | Programmatic upsert/re-indexing; safe to purge anytime |

---

## 3. Data Flow & Context Synthesis

### Current Baseline Architecture
```
Git Repository (`users/`)
  ├── USER_PROFILE.md   (Identity, background, capabilities)
  ├── PREFERENCES.md    (Communication style, pushback thresholds)
  └── WORKING_STYLE.md  (Incremental progression, engineering principles)
             │
             ▼
    UserProfileLoader (`src/alfred/cognitive/context/`)
             │
             ▼
      ContextBuilder
             ├── Alfred Persona Prompt (`src/ai/prompts/alfred-persona.ts`)
             ├── Canonical User Profile Context (`users/`)
             └── Current Conversation History (Ephemeral turns)
             │
             ▼
       LLM Engine (Ollama Gemma 4 / Groq LPU)
```

### Future Unified Context Architecture
```
Git Repository (Canonical)    Firestore (Dynamic State)    Vector DB (Semantic Index)
        ↓                                 ↓                             ↓
 Canonical User Profile           Dynamic Memories & History     Retrieved Chunks
        └─────────────────────────────────┼─────────────────────────────┘
                                          ↓
                                   ContextBuilder
                                          ↓
                                 LLM Working Context
```

> [!IMPORTANT]
> **SSOT Invariant**: The Vector Database is an acceleration index, never an authority. If the vector database is completely purged or corrupted, the system reconstructs the index from the Git canonical files and Firestore records with zero loss of truth.

---

## 4. Single Source of Truth (SSOT) Ownership Rules

1. **Git is exclusively authoritative for:**
   - Alfred's persona, linguistic register, and behavioral boundaries (`docs/persona/ALFRED_PERSONA.md`).
   - The user's baseline identity, technical background, and broad engineering philosophy (`users/USER_PROFILE.md`).
   - Consciously authored interaction preferences and pushback protocols (`users/PREFERENCES.md`).
   - Stable development methodology and working patterns (`users/WORKING_STYLE.md`).

2. **Firestore will be exclusively authoritative for:**
   - Ephemeral and long-term conversation logs and transcripts.
   - Dynamically learned episodic memories (e.g. past decisions, ongoing project specifics).
   - Evolving runtime state, active tasks, and session checkpoints.

3. **Vector DB is authoritative for NOTHING:**
   - It acts purely as a semantic lookup mechanism over existing text documents.
   - It possesses zero independent authority to declare or override user facts.

---

## 5. Security & Trust Boundary

- **Authored Configuration, Not Raw Dialogue**: Files in `users/` represent trusted application metadata authored by the system owner. They must contain structured facts, preferences, and guidelines.
- **No Embedded Instructions or Code**: The profile files must never contain prompt injection vectors, shell snippets, or executable directives disguised as user attributes.
- **Strict Privacy**: No secrets, passwords, API tokens, session keys, private Tailscale IPs, or ephemeral credentials are ever committed to `users/`.
- **Runtime Immutability**: Alfred's runtime code operates with **read-only** access to `users/`. The system possesses no tools, endpoints, or background routines to edit, rewrite, or commit changes to this directory.
