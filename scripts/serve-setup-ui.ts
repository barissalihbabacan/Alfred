import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const PORT = Number(process.env.PORT) || 8080;
const SETUP_DIR = path.resolve(process.cwd(), "setup-ui");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  // API endpoint for automated Cloud Shell execution (Live Streaming)
  if (req.method === "POST" && url.pathname === "/api/provision") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alfred-provision-"));
        const scriptPath = path.join(tmpDir, "provision.sh");
        fs.writeFileSync(scriptPath, payload.script, { mode: 0o700 });

        console.log(`[Alfred Setup Server] Spawning provisioning script with live streaming...`);

        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff"
        });

        const child = spawn("bash", [scriptPath], {
          cwd: process.cwd(),
          env: process.env
        });

        child.stdout.on("data", (chunk: Buffer) => {
          process.stdout.write(chunk);
          res.write(chunk);
        });

        child.stderr.on("data", (chunk: Buffer) => {
          process.stderr.write(chunk);
          res.write(chunk);
        });

        const cleanupTemp = () => {
          try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
          } catch {}
        };

        child.on("close", (code) => {
          cleanupTemp();

          if (code === 0) {
            res.write(`\n[SUCCESS] Alfred deployed successfully! Check https://${payload.projectId}.web.app\n`);
          } else {
            res.write(`\n[ERROR] Setup script exited with code ${code}.\n`);
          }
          res.end();
        });

        child.on("error", (err: Error) => {
          cleanupTemp();
          res.write(`\n[ERROR] Failed to execute setup script: ${err.message}\n`);
          res.end();
        });
      } catch (err: unknown) {
        console.error("[Alfred Setup Server] Request error:", err);
        const errorMessage = err instanceof Error ? err.message : "Failed to parse provision request.";
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: errorMessage }));
      }
    });
    return;
  }

  // Static file serving
  const reqPath = url.pathname === "/" ? "/index.html" : url.pathname;
  let filePath = path.join(SETUP_DIR, reqPath);

  // Fallback to avatar if requested from root
  if (reqPath === "/avatar.png") {
    filePath = path.resolve(process.cwd(), "apps/web/public/avatar.png");
  }

  // Security check: prevent directory traversal outside workspace
  if (!filePath.startsWith(SETUP_DIR) && !filePath.includes("apps/web/public/avatar.png")) {
    res.writeHead(403);
    res.end("Forbidden");
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
      // SharedArrayBuffer / WebAssembly security headers
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("===================================================================");
  console.log("🦇 Alfred — Interactive Setup-UI (Rust WebAssembly Core)");
  console.log("===================================================================");
  console.log(`Server listening on http://127.0.0.1:${PORT}`);
  console.log("");
  console.log("👉 In Google Cloud Shell:");
  console.log("   Click 'Web Preview' (top right) -> 'Preview on port 8080'");
  console.log("   Or open: http://localhost:8080");
  console.log("===================================================================");
});
