import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { createSetupServer, SetupServerDeps } from "../../scripts/serve-setup-ui.js";

interface AddressInfo {
  address: string;
  family: string;
  port: number;
}

describe("Setup Wizard Server (serve-setup-ui)", () => {
  let server: http.Server;
  let baseUrl: string;
  const testToken = "test_session_token_1234567890abcdef1234567890abcdef";

  const mockWasm = {
    wasm_validate_project_id: vi.fn((id: string) => {
      if (id === "valid-proj-id") return id;
      throw new Error("Invalid project ID");
    }),
    wasm_validate_email: vi.fn((email: string) => {
      if (email === "user@gmail.com") return email;
      throw new Error("Invalid email");
    }),
    wasm_validate_uid: vi.fn((uid: string) => uid),
    wasm_validate_api_key: vi.fn((_p: string, key: string) => key),
    wasm_generate_script: vi.fn(() => "#!/usr/bin/env bash\necho 'SERVER_GENERATED_SCRIPT'")
  };

  class MockChildProcess extends EventEmitter {
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    stdin = null;
    stdio = [null, this.stdout, this.stderr, null, null] as unknown as ChildProcess["stdio"];
    killed = false;
    pid = 12345;
  }

  let lastSpawnArgs: { command: string; args: string[]; options: unknown } | null = null;
  let mockChild: MockChildProcess;

  const mockSpawn = vi.fn((command: string, args: string[], options: unknown) => {
    lastSpawnArgs = { command, args: [...args], options };
    mockChild = new MockChildProcess();
    return mockChild as unknown as ChildProcess;
  });

  beforeEach(async () => {
    lastSpawnArgs = null;
    vi.clearAllMocks();

    const deps: SetupServerDeps = {
      sessionToken: testToken,
      wasmModule: mockWasm,
      spawnImpl: mockSpawn as unknown as SetupServerDeps["spawnImpl"]
    };

    server = createSetupServer(deps);

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("serves index.html with dynamically injected setup-token meta tag", async () => {
    const res = await fetch(`${baseUrl}/index.html`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`<meta name="setup-token" content="${testToken}">`);
  });

  it("rejects OPTIONS preflight request (CORS disabled)", async () => {
    const res = await fetch(`${baseUrl}/api/provision`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://malicious-website.com"
      }
    });
    expect(res.status).toBe(403); // Origin mismatch triggered before OPTIONS, or 405
  });

  it("rejects request when Origin header does not match Host", async () => {
    const res = await fetch(`${baseUrl}/api/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Setup-Token": testToken,
        Origin: "http://evil-attacker.com"
      },
      body: JSON.stringify({ config: { project_id: "valid-proj-id", allowed_email: "user@gmail.com" } })
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Origin mismatch");
  });

  it("rejects request when X-Setup-Token is missing", async () => {
    const res = await fetch(`${baseUrl}/api/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ config: { project_id: "valid-proj-id", allowed_email: "user@gmail.com" } })
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("Invalid or missing setup session token");
  });

  it("rejects request when X-Setup-Token is invalid", async () => {
    const res = await fetch(`${baseUrl}/api/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Setup-Token": "invalid_wrong_token_123456"
      },
      body: JSON.stringify({ config: { project_id: "valid-proj-id", allowed_email: "user@gmail.com" } })
    });
    expect(res.status).toBe(403);
  });

  it("rejects request with 415 when Content-Type is not application/json", async () => {
    const res = await fetch(`${baseUrl}/api/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Setup-Token": testToken
      },
      body: "plain text payload"
    });
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toContain("application/json required");
  });

  it("rejects invalid configuration with 400 from Rust validator", async () => {
    const res = await fetch(`${baseUrl}/api/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Setup-Token": testToken
      },
      body: JSON.stringify({
        config: {
          project_id: "invalid-bad-id",
          allowed_email: "user@gmail.com"
        }
      })
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Validation failed");
  });

  it("strictly ignores client-supplied script and executes ONLY server-generated script", async () => {
    const maliciousScript = "rm -rf / # attacker injected code";

    const fetchPromise = fetch(`${baseUrl}/api/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Setup-Token": testToken
      },
      body: JSON.stringify({
        script: maliciousScript, // Malicious script sent by client
        config: {
          project_id: "valid-proj-id",
          allowed_email: "user@gmail.com"
        }
      })
    });

    // Wait for spawn to be invoked
    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalled();
    });

    expect(lastSpawnArgs).not.toBeNull();
    expect(lastSpawnArgs?.command).toBe("bash");
    const scriptPath = lastSpawnArgs!.args[0];
    const scriptContent = fs.readFileSync(scriptPath, "utf-8");

    // The executed file MUST NOT contain the client's injected script
    expect(scriptContent).not.toContain(maliciousScript);
    expect(scriptContent).toContain("SERVER_GENERATED_SCRIPT");

    // Simulate completion
    mockChild.emit("close", 0);
    const res = await fetchPromise;
    expect(res.status).toBe(200);
    const output = await res.text();
    expect(output).toContain("__ALFRED_RESULT__");
    expect(output).toContain('"ok":true');
  });

  it("returns 409 Conflict if provisioning is already in progress", async () => {
    // Start first provisioning
    const firstReq = fetch(`${baseUrl}/api/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Setup-Token": testToken
      },
      body: JSON.stringify({
        config: {
          project_id: "valid-proj-id",
          allowed_email: "user@gmail.com"
        }
      })
    });

    await vi.waitFor(() => {
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    // Second concurrent request
    const secondRes = await fetch(`${baseUrl}/api/provision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Setup-Token": testToken
      },
      body: JSON.stringify({
        config: {
          project_id: "valid-proj-id",
          allowed_email: "user@gmail.com"
        }
      })
    });

    expect(secondRes.status).toBe(409);
    const body = await secondRes.json();
    expect(body.error).toContain("already in progress");

    // Finish first
    mockChild.emit("close", 0);
    const firstRes = await firstReq;
    expect(firstRes.status).toBe(200);
  });
});