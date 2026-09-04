# B.U.T.L.E.R. Alfred — Web Voice & Chat Playground

> **Document Status**: Production Milestone Documentation  
> **Target Audience**: Developers, Evaluators, Operators  
> **Repository Target**: `apps/web/`  
> **Firebase Project**: `butler-alfred` (Display: `BUTLER Alfred`)

---

## 1. Executive Summary & Objective

The **Web Voice & Chat Playground** represents the first end-to-end interactive vertical slice of **B.U.T.L.E.R. Alfred** (*Barış's Unified Task, Logic, Execution & Reasoning*).

Its primary objective is enabling real-time human interaction with Alfred through dual input modalities (keyboard text and live microphone speech), grounded cognitive reasoning via the canonical British butler persona specification, and acoustic feedback synthesized using local neural Text-to-Speech (Kokoro-82M).

---

## 2. Architecture & Data Flow

```
                     ┌───────────────────────────────────┐
                     │       User / Web Browser          │
                     └─────────────────┬─────────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                     │
           [Keyboard Text Input]                 [Microphone Audio]
                    │                                     │
                    │                             MediaRecorder (WebM)
                    │                                     │
                    │                             POST /api/stt
                    │                                     │
                    │                            Groq Whisper STT
                    │                       (whisper-large-v3-turbo)
                    │                                     │
                    └──────────────────┬──────────────────┘
                                       │
                                Transcribed Text
                                       │
                                       ▼
                               POST /api/chat
                                       │
                       ┌───────────────┴───────────────┐
                       ▼                               ▼
            Alfred Persona Prompt             Groq LPU Inference
          (docs/persona/ALFRED_PERSONA)     (llama-3.3-70b-versatile)
                       │                               │
                       └───────────────┬───────────────┘
                                       │
                                Alfred Response
                                       │
                                       ▼
                               Local Kokoro TTS
                           (Kokoro-82M ONNX Runtime)
                        Voice: bm_george (en-GB 24kHz)
                                       │
                                       ▼
                       Base64 24kHz Mono WAV Audio URL
                                       │
                                       ▼
                     ┌───────────────────────────────────┐
                     │    Browser UI & Audio Playback    │
                     │  - Text message rendered in chat  │
                     │  - Spoken audio played via Web    │
                     │  - Re-listen via [▶ Play Voice]   │
                     └───────────────────────────────────┘
```

---

## 3. UI States & Indicators

The playground provides real-time state feedback via a status indicator pill in the header:

| State | Indicator | Description |
| :--- | :--- | :--- |
| **Idle / Ready** | Gray Dot | Server and browser are ready for user input. |
| **Listening** | Red Pulsing Dot | Microphone hardware is actively recording audio chunks. |
| **Transcribing** | Amber Pulsing Dot | Audio payload is being processed by Whisper STT. |
| **Thinking** | Blue Pulsing Dot | Groq is executing reasoning with the Alfred persona prompt. |
| **Speaking** | Green Pulsing Dot | Alfred's synthesized speech is actively playing through browser speakers. |
| **Error** | Red Solid Dot | A user-facing, sanitized error notification is displayed in the alert banner. |

---

## 4. Endpoints & Server API

All backend operations execute strictly server-side. Zero API keys or secrets are ever exposed to the client bundle.

### 4.1 `POST /api/chat`
- **Request Body**:
  ```json
  {
    "message": "Good morning, Alfred.",
    "history": [
      { "role": "user", "content": "Hello" },
      { "role": "assistant", "content": "Good day, sir." }
    ]
  }
  ```
- **Validation**:
  - `message`: Required non-empty string, maximum 2,000 characters.
  - `history`: Optional array of objects with `role` (`user` | `assistant`) and `content` (max 2,000 characters), capped at 10 turns.
- **Response**:
  ```json
  {
    "success": true,
    "text": "Good morning, sir. I trust you are well. How may I be of assistance today?",
    "audio": "data:audio/wav;base64,UklGRsQQ...",
    "duration": 5.55,
    "provider": "groq"
  }
  ```

### 4.2 `POST /api/stt`
- **Request**: `multipart/form-data` with `audio` binary blob.
- **Validation**:
  - Maximum size: 15 megabytes.
- **Response**:
  ```json
  {
    "success": true,
    "text": "Good morning, Alfred."
  }
  ```

---

## 5. Environment Variables

Create `.env` or `.env.local` in the project root:

```ini
# Application Configuration
NODE_ENV=development
PORT=3000

# Groq Cloud (LLM Reasoning & Whisper STT)
GROQ_API_KEY=gsk_your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
GROQ_STT_MODEL=whisper-large-v3-turbo

# Local Text-to-Speech (Kokoro-82M)
TTS_PROVIDER=kokoro
TTS_VOICE=bm_george
TTS_LANGUAGE=en-GB
TTS_SPEED=0.95
```

> **Note on Local Testing without Groq API Key**:  
> If `GROQ_API_KEY` is not present in the local environment, the server automatically uses a deterministic persona generator that reflects Alfred's British butler tone, capability boundaries, and pushback rules, paired with full Kokoro neural voice synthesis.

---

## 6. Local Development Guide

### Prerequisites
- Node.js >= 20 (Tested on Node.js v24.20.0)
- npm >= 10

### Setup & Run
```bash
# 1. Install root dependencies
npm install

# 2. Build the Next.js web application
npm run build:web

# 3. Start local development server (with hot-reloading)
npm run dev:web

# Or start the production server
npm run start:web
```

Access the playground at `http://localhost:3000`.

### Automated End-to-End Verification
To verify the full server pipeline, UX test dialogues, and security validation without opening a browser:
```bash
npx tsx scripts/verify-web-playground.ts
```

---

## 7. Microphone Permissions & Browser Behavior

1. **Permission Request**: When clicking the microphone button (🎤), modern browsers (Chrome, Firefox, Safari) will prompt: `Allow butler-alfred to access your microphone?`.
2. **Audio Format**: Uses `MediaRecorder` with `audio/webm;codecs=opus` (or standard `audio/webm` fallback).
3. **Autoplay Policies**: Modern browsers restrict unmuted audio autoplay before the first user interaction.
   - When the user types or clicks the microphone, this counts as an interaction, allowing immediate playback.
   - If autoplay is blocked by browser security policies, an inline `[▶ Play Voice]` button appears on every assistant message so the user can listen on demand.

---

## 8. Deployment Architecture (Firebase)

### Why Firebase Hosting + Server Runtime?
- **Static Frontend**: Firebase Hosting is fundamentally a high-speed static CDN. It serves pre-rendered HTML, JavaScript bundles, CSS, and media assets globally with SSL.
- **Server Runtime Requirement**: Kokoro-82M relies on `onnxruntime-node` (native C++ binaries) and requires ~500MB–1GB RAM in memory for model weights. Furthermore, Groq API keys must remain strictly confidential on the server.
- **Deployment Models**:
  1. **Firebase App Hosting (Gen 2 - Recommended)**:
     Configured via `apphosting.yaml`. Cloud Build automatically packages the Next.js application into a Cloud Run container with 2 CPU and 2048 MiB RAM, managing secrets and custom domains automatically.
  2. **Firebase Hosting Classic + Cloud Run Rewrites**:
     Configured via `firebase.json`:
     ```json
     "hosting": {
       "public": "apps/web/public",
       "rewrites": [
         { "source": "/api/**", "run": { "serviceId": "butler-alfred", "region": "europe-west1" } },
         { "source": "**", "destination": "/index.html" }
       ]
     }
     ```

### Deploying to Firebase
```bash
# Login to Firebase
npx -y firebase-tools@latest login

# Set active project
npx -y firebase-tools@latest use butler-alfred

# Deploy via App Hosting or Hosting
npx -y firebase-tools@latest deploy --only hosting
```

---

## 9. Known Limitations (Playground Scope)

As defined in the project roadmap, the following features are intentionally deferred to future milestones:
1. **Ephemeral Memory Only**: Conversation history is retained in browser memory and request payload (last 10 turns); no persistent database or Firestore conversation collections are written.
2. **No External Integrations**: Google Calendar, Gmail, GitHub actions, file manipulation, and terminal execution are not yet active in this milestone. Alfred explicitly acknowledges this boundary when asked.
3. **Local ONNX CPU Latency**: On CPU, Kokoro-82M takes ~3–5 seconds per synthesized sentence. In production or GPU environments, this is accelerated to <300ms.
4. **Token-to-Audio Streaming**: While `synthesizeStream` exists in the core architecture, the web playground utilizes discrete turn-based audio buffering for maximum stability. Real-time token streaming will be introduced in subsequent milestones.
