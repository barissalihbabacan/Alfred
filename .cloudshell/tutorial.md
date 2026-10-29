# Alfred Setup

## Start the wizard

Click the **Cloud Shell icon** next to the command below: it is typed into the terminal for you. Then press **Enter**.

```bash
bash .cloudshell/start.sh
```

It downloads the setup wizard (a few MB) from the latest Alfred release, checks its checksum, asks you to sign in to Google Cloud if Cloud Shell is not signed in yet, and starts it. Authorize Cloud Shell if it asks.

## In the wizard

1. **Project:** type a project ID or press **Ctrl+G** for a new one, choose a billing account and the Firestore region.
2. **Account:** your name and the Google e-mail that will be the only one allowed to sign in.
3. **API keys:** EVREN, Groq, Gemini and Tavily, all optional and stored in Secret Manager.
4. **Review:** press **Enter**; the live log shows every step up to the deploy.
5. **Done:** enable Google sign-in with the link the wizard shows, then open `https://<project-id>.web.app`.

Press **F2** at any time to switch between English and Turkish.
