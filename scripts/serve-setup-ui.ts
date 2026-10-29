import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execSync, ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as wasmCore from "../setup-ui/wasm/alfred_setup_core.js";
import { errorMessage } from "../src/core/errors/index.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

export interface SetupWasmModule {
  wasm_validate_project_id: (id: string) => string;
  wasm_validate_email: (email: string) => string;
  wasm_validate_uid: (uid: string) => string;
  wasm_validate_api_key: (provider: string, key: string) => unknown;
  wasm_validate_ollama_url?: (url: string) => string;
  wasm_generate_script: (config: unknown) => string;
}

export interface SetupServerDeps {
  spawnImpl?: typeof spawn;
  execSyncImpl?: typeof execSync;
  wasmModule?: SetupWasmModule;
  sessionToken?: string;
  setupDir?: string;
  host?: string;
  port?: number;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createSetupServer(deps: SetupServerDeps = {}): http.Server {
  const setupDir = deps.setupDir || path.resolve(process.cwd(), "setup-ui");
  const spawnImpl = deps.spawnImpl || spawn;
  const execSyncImpl = deps.execSyncImpl || execSync;
  const sessionToken = deps.sessionToken || crypto.randomBytes(32).toString("hex");

  let wasm: SetupWasmModule;
  if (deps.wasmModule) {
    wasm = deps.wasmModule;
  } else {
    const wasmPath = path.join(setupDir, "wasm", "alfred_setup_core_bg.wasm");
    const wasmBytes = fs.readFileSync(wasmPath);
    wasmCore.initSync({ module: wasmBytes });
    wasm = wasmCore as SetupWasmModule;
  }

  let activeChildProcess: ChildProcess | null = null;

  const server = http.createServer((req, res) => {
    const hostHeader = req.headers.host || "localhost:8080";
    const url = new URL(req.url || "/", `http://${hostHeader}`);

    // CORS & Origin Security Guard
    const originHeader = req.headers.origin;
    if (originHeader) {
      try {
        const originUrl = new URL(originHeader);
        if (originUrl.host !== req.headers.host) {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Forbidden: Origin mismatch" }));
          return;
        }
      } catch {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden: Malformed origin header" }));
        return;
      }
    }

    // Reject CORS preflight OPTIONS requests explicitly
    if (req.method === "OPTIONS") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method Not Allowed: CORS preflight disabled" }));
      return;
    }

    // Protected API Endpoints
    if (url.pathname.startsWith("/api/")) {
      // 1. Session Token Verification
      const tokenHeader = req.headers["x-setup-token"];
      if (typeof tokenHeader !== "string" || !timingSafeEqualStr(tokenHeader, sessionToken)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Forbidden: Invalid or missing setup session token" }));
        return;
      }

      // 2. Billing Accounts Listing
      if (url.pathname === "/api/billing-accounts") {
        if (req.method !== "GET") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method Not Allowed: GET required" }));
          return;
        }

        try {
          const stdout = execSyncImpl("gcloud billing accounts list --filter=open=true --format=json", {
            encoding: "utf-8",
            timeout: 10000,
            stdio: ["ignore", "pipe", "pipe"]
          });
          const rawAccounts: unknown = JSON.parse(stdout || "[]");
          const accounts = (Array.isArray(rawAccounts) ? rawAccounts : []).map((item: unknown) => {
            const acc = (item && typeof item === "object") ? item as Record<string, unknown> : {};
            const rawName = typeof acc.name === "string" ? acc.name : "";
            const id = rawName.startsWith("billingAccounts/") ? rawName.slice("billingAccounts/".length) : rawName;
            return {
              id,
              name: rawName,
              displayName: typeof acc.displayName === "string" ? acc.displayName : id,
              open: Boolean(acc.open)
            };
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ accounts }));
        } catch (err: unknown) {
          const msg = errorMessage(err);
          console.warn("[Setup Server] Could not list billing accounts via gcloud:", msg);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ accounts: [], error: msg }));
        }
        return;
      }

      // 3. Provisioning Endpoint
      if (url.pathname === "/api/provision") {
        if (req.method !== "POST") {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method Not Allowed: POST required" }));
          return;
        }

        const contentType = req.headers["content-type"] || "";
        if (!contentType.includes("application/json")) {
          res.writeHead(415, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unsupported Media Type: application/json required" }));
          return;
        }

        if (activeChildProcess !== null) {
          res.writeHead(409, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Conflict: A provisioning job is already in progress." }));
          return;
        }

        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString("utf-8");
        });

        req.on("end", () => {
          let tmpDir: string | null = null;
          try {
            const rawPayload: unknown = JSON.parse(body);
            if (!rawPayload || typeof rawPayload !== "object") {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Malformed JSON payload." }));
              return;
            }

            const payload = rawPayload as Record<string, unknown>;
            // Extract config strictly — never run client-supplied script
            const configRaw = (payload.config && typeof payload.config === "object")
              ? payload.config as Record<string, unknown>
              : payload;

            const projectId = typeof configRaw.project_id === "string"
              ? configRaw.project_id
              : (typeof configRaw.projectId === "string" ? configRaw.projectId : "");
            const allowedEmail = typeof configRaw.allowed_email === "string"
              ? configRaw.allowed_email
              : (typeof configRaw.allowedEmail === "string" ? configRaw.allowedEmail : "");
            const allowedUid = typeof configRaw.allowed_uid === "string"
              ? configRaw.allowed_uid
              : (typeof configRaw.allowedUid === "string" ? configRaw.allowedUid : "");
            const groqKey = typeof configRaw.groq_api_key === "string"
              ? configRaw.groq_api_key
              : (typeof configRaw.groqKey === "string" ? configRaw.groqKey : "");
            const geminiKey = typeof configRaw.gemini_api_key === "string"
              ? configRaw.gemini_api_key
              : (typeof configRaw.geminiKey === "string" ? configRaw.geminiKey : "");
            const tavilyKey = typeof configRaw.tavily_api_key === "string"
              ? configRaw.tavily_api_key
              : (typeof configRaw.tavilyKey === "string" ? configRaw.tavilyKey : "");
            const evrenKey = typeof configRaw.evren_api_key === "string"
              ? configRaw.evren_api_key
              : (typeof configRaw.evrenKey === "string" ? configRaw.evrenKey : null);
            const ollamaUrl = typeof configRaw.ollama_url === "string"
              ? configRaw.ollama_url
              : (typeof configRaw.ollamaUrl === "string" ? configRaw.ollamaUrl : null);
            const firestoreRegion = typeof configRaw.firestore_region === "string"
              ? configRaw.firestore_region
              : (typeof configRaw.firestoreRegion === "string" ? configRaw.firestoreRegion : "europe-west1");
            const billingAccountId = typeof configRaw.billing_account_id === "string"
              ? configRaw.billing_account_id
              : (typeof configRaw.billingAccountId === "string" ? configRaw.billingAccountId : null);

            // Server-side validation via Rust setup-core
            try {
              wasm.wasm_validate_project_id(projectId);
              wasm.wasm_validate_email(allowedEmail);
              if (allowedUid) {
                wasm.wasm_validate_uid(allowedUid);
              }
              if (groqKey) {
                wasm.wasm_validate_api_key("groq", groqKey);
              }
              if (geminiKey) {
                wasm.wasm_validate_api_key("gemini", geminiKey);
              }
              if (tavilyKey) {
                wasm.wasm_validate_api_key("tavily", tavilyKey);
              }
            } catch (valErr: unknown) {
              const msg = valErr instanceof Error ? valErr.message : String(valErr);
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: `Validation failed: ${msg}` }));
              return;
            }

            const setupConfig = {
              project_id: projectId,
              allowed_email: allowedEmail,
              allowed_uid: allowedUid,
              groq_api_key: groqKey,
              gemini_api_key: geminiKey,
              tavily_api_key: tavilyKey,
              evren_api_key: evrenKey,
              ollama_url: ollamaUrl,
              firestore_region: firestoreRegion,
              billing_account_id: billingAccountId
            };

            // Server securely generates bash script using Rust crate
            const script = wasm.wasm_generate_script(setupConfig);

            // Create temporary execution directory under os.tmpdir (mode 0700)
            tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alfred-setup-"));
            fs.chmodSync(tmpDir, 0o700);
            const scriptPath = path.join(tmpDir, "provision.sh");
            fs.writeFileSync(scriptPath, script, { mode: 0o700 });

            res.writeHead(200, {
              "Content-Type": "text/plain; charset=utf-8",
              "Transfer-Encoding": "chunked",
              "Cache-Control": "no-cache",
              "X-Content-Type-Options": "nosniff"
            });

            // Pass keys to child process via environment variables (no command-line leaking)
            const childEnv = {
              ...process.env,
              GROQ_API_KEY: groqKey,
              GEMINI_API_KEY: geminiKey,
              TAVILY_API_KEY: tavilyKey,
              EVREN_API_KEY: evrenKey || ""
            };

            const child = spawnImpl("bash", [scriptPath], {
              cwd: process.cwd(),
              env: childEnv
            });
            activeChildProcess = child;

            child.stdout?.on("data", (chunk: Buffer) => {
              process.stdout.write(chunk);
              res.write(chunk);
            });

            child.stderr?.on("data", (chunk: Buffer) => {
              process.stderr.write(chunk);
              res.write(chunk);
            });

            const cleanup = () => {
              activeChildProcess = null;
              if (tmpDir) {
                try {
                  fs.rmSync(tmpDir, { recursive: true, force: true });
                } catch {}
              }
            };

            child.on("close", (code) => {
              cleanup();
              if (code === 0) {
                res.write(`\n__ALFRED_RESULT__ ${JSON.stringify({ ok: true, url: `https://${projectId}.web.app` })}\n`);
              } else {
                res.write(`\n__ALFRED_RESULT__ ${JSON.stringify({ ok: false, exitCode: code })}\n`);
              }
              res.end();
            });

            child.on("error", (err: Error) => {
              cleanup();
              res.write(`\n[ERROR] Setup process error: ${err.message}\n`);
              res.write(`\n__ALFRED_RESULT__ ${JSON.stringify({ ok: false, error: err.message })}\n`);
              res.end();
            });
          } catch (err: unknown) {
            if (tmpDir) {
              try {
                fs.rmSync(tmpDir, { recursive: true, force: true });
              } catch {}
            }
            activeChildProcess = null;
            const errorMsg = err instanceof Error ? err.message : String(err);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Provisioning server error: ${errorMsg}` }));
          }
        });
        return;
      }

      // Other /api endpoints not matched
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Endpoint not found" }));
      return;
    }

    // Static file serving
    const reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
    let filePath = path.join(setupDir, reqPath);

    if (reqPath === "/avatar.png") {
      filePath = path.resolve(process.cwd(), "apps/web/public/avatar.png");
    }

    // Security check: prevent directory traversal outside setupDir
    if (!filePath.startsWith(setupDir) && !filePath.includes("apps/web/public/avatar.png")) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    // Special handling for index.html: inject setup session token into <head>
    if (reqPath === "/index.html") {
      fs.readFile(filePath, "utf-8", (err, html) => {
        if (err) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("404 Not Found");
          return;
        }

        const metaTag = `<meta name="setup-token" content="${sessionToken}">`;
        const modifiedHtml = html.includes("<head>")
          ? html.replace("<head>", `<head>\n    ${metaTag}`)
          : `${metaTag}\n${html}`;

        const buffer = Buffer.from(modifiedHtml, "utf-8");
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": buffer.length,
          "Cache-Control": "no-cache",
          "Cross-Origin-Opener-Policy": "same-origin",
          "Cross-Origin-Embedder-Policy": "require-corp"
        });
        res.end(buffer);
      });
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp"
      });

      fs.createReadStream(filePath).pipe(res);
    });
  });

  return server;
}

// Check if run directly from CLI
const isDirectCli = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
  process.argv[1].endsWith("serve-setup-ui.ts") ||
  process.argv[1].endsWith("serve-setup-ui.js")
);

if (isDirectCli) {
  const HOST = process.env.HOST || "127.0.0.1";
  const PORT = Number(process.env.PORT) || 8080;
  const server = createSetupServer({ host: HOST, port: PORT });
  server.listen(PORT, HOST, () => {
    console.log("===================================================================");
    console.log("🦇 Alfred — Interactive Setup-UI (Rust WebAssembly Core)");
    console.log("===================================================================");
    console.log(`Server listening on http://${HOST}:${PORT}`);
    console.log("");
    console.log("👉 In Google Cloud Shell:");
    console.log(`   Click 'Web Preview' (top right) -> 'Preview on port ${PORT}'`);
    console.log(`   Or open: http://localhost:${PORT}`);
    console.log("===================================================================");
  });
}