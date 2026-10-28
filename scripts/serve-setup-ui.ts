import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
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

  // API endpoint for automated Cloud Shell execution
  if (req.method === "POST" && url.pathname === "/api/provision") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(body);
        const scriptPath = path.resolve(process.cwd(), ".provision-temp.sh");
        fs.writeFileSync(scriptPath, payload.script, { mode: 0o755 });

        // Execute the generated script
        console.log(`[Alfred Setup Server] Executing provisioning script...`);
        const { stdout, stderr } = await execAsync(`bash ${scriptPath}`);
        console.log(stdout);
        if (stderr) console.error(stderr);

        // Clean up temporary script
        try {
          fs.unlinkSync(scriptPath);
        } catch {}

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ 
          success: true, 
          message: `Alfred deployed successfully! Check https://${payload.projectId}.web.app` 
        }));
      } catch (err: unknown) {
        console.error("[Alfred Setup Server] Execution error:", err);
        const errObj = err as { stderr?: string; stdout?: string; message?: string };
        const errorMessage = errObj.stderr || errObj.stdout || errObj.message || "Failed to execute setup script.";
        res.writeHead(500, { "Content-Type": "application/json" });
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

server.listen(PORT, "0.0.0.0", () => {
  console.log("===================================================================");
  console.log("🦇 Alfred — Interactive Setup-UI (Rust WebAssembly Core)");
  console.log("===================================================================");
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
  console.log("");
  console.log("👉 In Google Cloud Shell:");
  console.log("   Click 'Web Preview' (top right) -> 'Preview on port 8080'");
  console.log("   Or open: http://localhost:8080");
  console.log("===================================================================");
});
