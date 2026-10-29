import { describe, it, expect, afterAll } from "vitest";
import { ALLOWED_UID } from "../../apps/web/lib/allowed-uid.js";
import { OFFLINE } from "./prerequisites.js";

// Runs against a deployed instance: ALFRED_PROD_BASE_URL (e.g.
// https://<your-project-id>.web.app). Without it nothing here runs. Every /api
// endpoint except /health requires a Firebase ID token for ALLOWED_UID
// (NEXT_PUBLIC_ALLOWED_UID), so the chat tests need credentials. They are
// resolved in this order:
//   1. ALFRED_TEST_ID_TOKEN — a Firebase ID token for the allowed user
//      (e.g. copied from the browser: `await firebase.auth().currentUser.getIdToken()`).
//   2. GOOGLE_APPLICATION_CREDENTIALS — a service-account key for that project
//      plus NEXT_PUBLIC_FIREBASE_API_KEY; a custom token is minted for
//      ALLOWED_UID and exchanged for an ID token.
// Without either, the authenticated tests are skipped (the unauthenticated
// checks still run). With ALFRED_OFFLINE=1 (CI) nothing here runs: CI must
// never hit production.

const BASE = (process.env.ALFRED_PROD_BASE_URL || "").trim().replace(/\/+$/, "");
// Public Firebase web config key of the target project; not a secret.
const FIREBASE_WEB_API_KEY = (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "").trim();

const hasCredentials = Boolean(
  process.env.ALFRED_TEST_ID_TOKEN ||
    (process.env.GOOGLE_APPLICATION_CREDENTIALS && FIREBASE_WEB_API_KEY)
);

async function getIdToken(): Promise<string> {
  if (process.env.ALFRED_TEST_ID_TOKEN) return process.env.ALFRED_TEST_ID_TOKEN;

  const { initializeApp, getApps, applicationDefault } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const app =
    getApps().find((a) => a.name === "prod-regression") ??
    // The project comes from the service-account key.
    initializeApp({ credential: applicationDefault() }, "prod-regression");
  const customToken = await getAuth(app).createCustomToken(ALLOWED_UID);

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_WEB_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    }
  );
  const body = (await res.json()) as { idToken?: string; error?: { message?: string } };
  if (!res.ok || !body.idToken) {
    throw new Error(`Custom token exchange failed: ${body.error?.message ?? res.status}`);
  }
  return body.idToken;
}

describe.skipIf(OFFLINE || !BASE)("Production API auth gate (no credentials needed)", () => {
  it("rejects unauthenticated conversation reads with 401", async () => {
    const res = await fetch(`${BASE}/api/conversations`);
    expect(res.status).toBe(401);
  });

  it("rejects unauthenticated chat with 401 before touching the model", async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hello" })
    });
    expect(res.status).toBe(401);
  });

  it("rejects a bogus ID token with 401", async () => {
    const res = await fetch(`${BASE}/api/conversations`, {
      headers: { Authorization: "Bearer not-a-real-token" }
    });
    expect(res.status).toBe(401);
  });

  it("keeps /api/health public", async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
  });
});

describe.skipIf(OFFLINE || !BASE || !hasCredentials)("Production Chat SSE Regression Tests (authenticated)", () => {
  const createdConversations: string[] = [];

  afterAll(async () => {
    // Don't leave test conversations in the owner's history.
    if (createdConversations.length === 0) return;
    const token = await getIdToken();
    for (const id of createdConversations) {
      await fetch(`${BASE}/api/chat?conversationId=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });
    }
  });

  it(
    "streams start, content chunks and done without error fallback copy",
    async () => {
      const token = await getIdToken();
      const res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          message: "What do you think about Rust software language?",
          history: []
        })
      });

      expect(res.ok).toBe(true);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const text = await res.text();
      const events: Array<{ type?: string; text?: string; conversationId?: string }> = [];
      let accumulatedContent = "";

      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        try {
          const parsed = JSON.parse(trimmed.replace(/^data:\s*/, "")) as {
            type?: string;
            text?: string;
            conversationId?: string;
          };
          events.push(parsed);
          if (parsed.type === "chunk" && parsed.text) accumulatedContent += parsed.text;
        } catch {
          // Non-JSON keep-alive lines are ignored.
        }
      }

      // 1. Contract checks
      const startEvent = events.find((e) => e.type === "start");
      expect(startEvent).toBeDefined();
      if (startEvent?.conversationId) createdConversations.push(startEvent.conversationId);

      expect(events.filter((e) => e.type === "chunk").length).toBeGreaterThan(0);
      expect(events.find((e) => e.type === "done")).toBeDefined();
      expect(events.find((e) => e.type === "error")).toBeUndefined();

      // 2. Must NOT contain fallback copy or internal network details
      expect(accumulatedContent).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
      expect(accumulatedContent).not.toContain("To enable live reasoning");
      expect(accumulatedContent).not.toContain("please ensure the Ollama server is running");
      expect(accumulatedContent).not.toContain("Indeed, sir. You mentioned:");

      // 3. Genuine model output
      expect(accumulatedContent.length).toBeGreaterThan(50);
    },
    90000
  );

  it("returns a 400 JSON error (not assistant dialogue) for an empty message", async () => {
    const token = await getIdToken();
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: "" })
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string; text?: string };
    expect(body.error).toBeDefined();
    expect(body.text).toBeUndefined();
  });
});
