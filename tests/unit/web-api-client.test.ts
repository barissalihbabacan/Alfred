import { describe, it, expect, vi } from "vitest";
import type { User } from "firebase/auth";
import { apiFetch, ensureOk, ApiError, ApiDeps } from "../../apps/web/lib/api.js";

type TestDeps = ApiDeps & { fetchImpl: ReturnType<typeof vi.fn> };

function makeDeps(overrides: Partial<ApiDeps> = {}): TestDeps {
  return {
    // Only getIdToken is used by apiFetch.
    getUser: () => ({ getIdToken: vi.fn(async () => "id-token-123") }) as unknown as User,
    getAppCheckToken: vi.fn(async () => "app-check-456"),
    fetchImpl: vi.fn(async () => new Response("{}", { status: 200 })),
    ...overrides
  } as TestDeps;
}

describe("Web API client (apps/web/lib/api.ts)", () => {
  it("sends the Firebase ID token and App Check token to /api/*", async () => {
    const deps = makeDeps();
    await apiFetch("/chat?userId=u", { method: "GET" }, deps);

    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = deps.fetchImpl.mock.calls[0];
    expect(url).toBe("/api/chat?userId=u");
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer id-token-123");
    expect(headers.get("X-Firebase-AppCheck")).toBe("app-check-456");
    expect(init.method).toBe("GET");
  });

  it("sends streaming requests straight to the function (Hosting buffers them), with the same auth headers", async () => {
    const deps = makeDeps({ streamBase: "https://us-central1-example.cloudfunctions.net/api" });
    await apiFetch("/chat", { method: "POST", stream: true, body: "{}" }, deps);
    const [url, init] = deps.fetchImpl.mock.calls[0];
    expect(url).toBe("https://us-central1-example.cloudfunctions.net/api/chat");
    const headers = init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer id-token-123");
    expect(headers.get("X-Firebase-AppCheck")).toBe("app-check-456");
    expect(init).not.toHaveProperty("stream");

    // Everything else keeps going through the Hosting rewrite.
    await apiFetch("/chat?conversationId=c", {}, deps);
    expect(deps.fetchImpl.mock.calls[1][0]).toBe("/api/chat?conversationId=c");
  });

  it("uses the production function URL only in a production build", async () => {
    const { STREAM_API_BASE } = await import("../../apps/web/lib/api.js");
    // vitest runs with NODE_ENV=test, like next dev: stay on the /api proxy.
    expect(STREAM_API_BASE).toBe("/api");
    const source = (await import("node:fs")).readFileSync(new URL("../../apps/web/lib/api.ts", import.meta.url), "utf8");
    expect(source).toContain('process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID');
    expect(source).toContain('https://us-central1-${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.cloudfunctions.net/api');
  });

  it("refuses to call an authenticated endpoint before the session is restored", async () => {
    const deps = makeDeps({ getUser: () => null });

    await expect(apiFetch("/chat", {}, deps)).rejects.toMatchObject({ name: "ApiError", status: 401 });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it("allows anonymous calls (e.g. /health) without a user or token", async () => {
    const deps = makeDeps({ getUser: () => null });
    await apiFetch("/health", { anonymous: true }, deps);

    const [url, init] = deps.fetchImpl.mock.calls[0];
    expect(url).toBe("/api/health");
    expect((init.headers as Headers).has("Authorization")).toBe(false);
  });

  it("omits the App Check header when no token is available", async () => {
    const deps = makeDeps({ getAppCheckToken: async () => { throw new Error("recaptcha down"); } });
    await apiFetch("/chat", { method: "POST", headers: { "Content-Type": "application/json" } }, deps);

    const headers = deps.fetchImpl.mock.calls[0][1].headers as Headers;
    expect(headers.has("X-Firebase-AppCheck")).toBe(false);
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("ensureOk turns the functions' { error } body into an ApiError", async () => {
    const res = new Response(JSON.stringify({ error: "Unauthorized: Missing auth token." }), { status: 401 });
    await expect(ensureOk(res)).rejects.toEqual(new ApiError(401, "Unauthorized: Missing auth token."));

    const ok = new Response("{}", { status: 200 });
    await expect(ensureOk(ok)).resolves.toBe(ok);
  });
});
