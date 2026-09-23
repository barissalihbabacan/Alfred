import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Auth } from "firebase/auth";

// The browser-side allow-list in apps/web/lib/auth.ts is exercised against a
// mocked Firebase Auth SDK. Server-side enforcement lives in functions/index.js
// (the `api` Cloud Function), which rejects any ID token whose UID differs.
const authMocks = vi.hoisted(() => ({
  onAuthStateChanged: vi.fn(),
  signOut: vi.fn(async () => {}),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(async () => {}),
  getRedirectResult: vi.fn()
}));

vi.mock("firebase/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("firebase/auth")>();
  return {
    ...actual,
    getAuth: vi.fn(() => ({ name: "mock-auth" })),
    ...authMocks
  };
});

import {
  ALLOWED_UID,
  getAuthErrorDetails,
  subscribeAuthState,
  signInWithGoogle,
  checkRedirectResult
} from "../../apps/web/lib/auth.js";

const fakeAuth = { name: "fake-auth" } as unknown as Auth;

describe("Single-User Authorization (UID Whitelist)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defines the exact authorized UID constant", () => {
    expect(ALLOWED_UID).toBe("test-owner-uid-123456");
  });

  it("provides Turkish user-facing error message for unauthorized UIDs", () => {
    const errorDetails = getAuthErrorDetails({ code: "auth/unauthorized-uid" });
    expect(errorDetails.title).toBe("Yetkisiz Kullanıcı (Erişim Reddedildi)");
    expect(errorDetails.message).toContain("yalnızca yetkili yönetici erişebilir");
  });

  it("signs a restored session with a foreign UID straight back out", async () => {
    const callback = vi.fn();
    const onUnauthorized = vi.fn();
    subscribeAuthState(callback, onUnauthorized, fakeAuth);

    const listener = authMocks.onAuthStateChanged.mock.calls[0][1];
    await listener({ uid: "malicious_unauthorized_uid_123" });

    expect(authMocks.signOut).toHaveBeenCalledWith(fakeAuth);
    expect(onUnauthorized).toHaveBeenCalledWith("malicious_unauthorized_uid_123");
    expect(callback).toHaveBeenCalledWith(null);
  });

  it("passes the allowed user through without signing out", async () => {
    const callback = vi.fn();
    const onUnauthorized = vi.fn();
    subscribeAuthState(callback, onUnauthorized, fakeAuth);

    const user = { uid: ALLOWED_UID };
    const listener = authMocks.onAuthStateChanged.mock.calls[0][1];
    await listener(user);

    expect(authMocks.signOut).not.toHaveBeenCalled();
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith(user);
  });

  it("rejects a popup sign-in with a foreign UID as auth/unauthorized-uid", async () => {
    authMocks.signInWithPopup.mockResolvedValueOnce({ user: { uid: "someone-else" } });

    await expect(signInWithGoogle()).rejects.toMatchObject({ code: "auth/unauthorized-uid" });
    expect(authMocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("returns the allowed user from a popup sign-in", async () => {
    const user = { uid: ALLOWED_UID };
    authMocks.signInWithPopup.mockResolvedValueOnce({ user });

    await expect(signInWithGoogle()).resolves.toBe(user);
    expect(authMocks.signOut).not.toHaveBeenCalled();
  });

  it.each(["auth/popup-blocked", "auth/internal-error", "auth/cancelled-popup-request"])(
    "falls back to redirect sign-in on %s",
    async (code) => {
      authMocks.signInWithPopup.mockRejectedValueOnce({ code });

      // On fallback the promise never settles (the page navigates away).
      const settled = vi.fn();
      signInWithGoogle().then(settled, settled);
      await vi.waitFor(() => expect(authMocks.signInWithRedirect).toHaveBeenCalledTimes(1));
      expect(settled).not.toHaveBeenCalled();
    }
  );

  it("does not fall back to redirect when the user closes the popup", async () => {
    authMocks.signInWithPopup.mockRejectedValueOnce({ code: "auth/popup-closed-by-user" });

    await expect(signInWithGoogle()).rejects.toMatchObject({ code: "auth/popup-closed-by-user" });
    expect(authMocks.signInWithRedirect).not.toHaveBeenCalled();
  });

  it("rejects a redirect result with a foreign UID", async () => {
    authMocks.getRedirectResult.mockResolvedValueOnce({ user: { uid: "someone-else" } });

    await expect(checkRedirectResult()).rejects.toMatchObject({ code: "auth/unauthorized-uid" });
    expect(authMocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("returns null when there is no pending redirect result", async () => {
    authMocks.getRedirectResult.mockResolvedValueOnce(null);
    await expect(checkRedirectResult()).resolves.toBeNull();
  });
});
