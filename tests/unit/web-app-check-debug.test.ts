import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveAppCheckDebugToken } from "../../apps/web/lib/app-check-debug";

// App Check is enforced in production, so a debug token is a way past it.
// Before 24 Sep 2026 lib/firebase.ts enabled debug mode on any host with
// ?debug_token=true and fell back to a token committed in the repository.

describe("resolveAppCheckDebugToken", () => {
  it("never enables debug mode on the production site", () => {
    for (const hostname of ["butler-alfred.web.app", "butler-alfred.firebaseapp.com", "example.com"]) {
      expect(resolveAppCheckDebugToken({ hostname, nodeEnv: "production", envToken: undefined })).toBeUndefined();
      expect(resolveAppCheckDebugToken({ hostname, nodeEnv: "production", envToken: "some-token" })).toBeUndefined();
    }
  });

  it("on localhost uses the private env token when set", () => {
    expect(resolveAppCheckDebugToken({ hostname: "localhost", nodeEnv: "production", envToken: " my-token " })).toBe("my-token");
    expect(resolveAppCheckDebugToken({ hostname: "127.0.0.1", nodeEnv: "development", envToken: "t" })).toBe("t");
  });

  it("on localhost without an env token lets the SDK generate one", () => {
    expect(resolveAppCheckDebugToken({ hostname: "localhost", nodeEnv: "development", envToken: undefined })).toBe(true);
    expect(resolveAppCheckDebugToken({ hostname: "localhost", nodeEnv: "production", envToken: "  " })).toBe(true);
  });

  it("enables debug mode under next dev on any host", () => {
    expect(resolveAppCheckDebugToken({ hostname: "192.168.1.5", nodeEnv: "development", envToken: undefined })).toBe(true);
  });
});

describe("apps/web/lib/firebase.ts", () => {
  const source = readFileSync(new URL("../../apps/web/lib/firebase.ts", import.meta.url), "utf8");

  it("carries no committed debug token and no ?debug_token switch", () => {
    expect(source).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(source).not.toContain("debug_token=true");
    expect(source).toContain("resolveAppCheckDebugToken({");
  });
});
