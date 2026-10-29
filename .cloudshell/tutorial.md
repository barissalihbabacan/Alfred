# Welcome to Alfred Setup in Google Cloud Shell 🦇

Alfred is an open-source, self-hosted personal AI butler and senior engineering partner with persistent vector memory and reasoned objection.

---

## 1. Quick Launch with Setup-UI

We have prepared an interactive **Rust + WebAssembly visual setup wizard** that guides you through project selection, authentication whitelist, API key configuration, and 1-click deployment.

### Start the Wizard Server:

Click the copy button or run the following command in the terminal below:

```bash
npm run setup:ui
```

---

## 2. Open Web Preview

The wizard server binds securely to localhost (`127.0.0.1:8080`). Google Cloud Shell Web Preview automatically proxies preview requests directly to localhost:
1. In the top-right corner of Google Cloud Shell, click the **Web Preview** icon (`eye` or `window with arrow`).
2. Select **Preview on port 8080**.
3. The visual Setup-UI will open securely in a new browser tab.

---

## 3. Configure in Setup-UI

Follow the 4 steps in the visual wizard:

1. **GCP & Firebase Project**: Enter a project ID or click **✨ Auto-Generate**. Alfred's provisioning script will automatically create the Google Cloud project and enable Firebase for you!
2. **User Authorization**: Enter your Google Email. The Firebase Auth UID is optional and will automatically bind to your account on first sign-in.
3. **API Keys**: Enter your Groq (`gsk_...`), Gemini (`AIzaSy...`), and Tavily (`tvly-...`) API keys.
4. **Deploy**: Click **🚀 Execute Setup & Deploy Now** or copy the generated provisioning script.

---

## 4. Manual Fallback (Optional CLI Flow)

If you prefer using the terminal directly without the visual wizard:

```bash
# 1. Initialize local persona profile digest
npm run profile:init

# 2. Configure .env with your whitelist and keys
cp .env.example .env
nano .env

# 3. Create Secret Manager secrets
gcloud secrets create GROQ_API_KEY --data-file=- <<< "your_groq_key"
gcloud secrets create GEMINI_API_KEY --data-file=- <<< "your_gemini_key"
gcloud secrets create TAVILY_API_KEY --data-file=- <<< "your_tavily_key"

# 4. Deploy to Firebase
npx firebase deploy --only hosting,functions,firestore:rules,firestore:indexes
```

---

## 5. You're Ready!

Open your live Alfred instance at:
`https://<YOUR_PROJECT_ID>.web.app`
