/**
 * B.U.T.L.E.R. Alfred — Home Server Relay Daemon
 * Listens for queued server execution requests in Firestore, validates them
 * against Alfred's CommandRegistry, executes them locally on the home server,
 * and writes back the structured output.
 *
 * Runs on Barış's home server / local development host.
 */

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync, existsSync } from "node:fs";
import { exec } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { CommandRegistry, AllowedSSHCommand } from "../src/alfred/execution-plane/ssh/command-registry.js";

const DEFAULT_KEY_PATH = path.join(os.homedir(), ".config", "alfred", "home-relay-key.json");
const KEY_PATH = process.env.ALFRED_RELAY_KEY_PATH || DEFAULT_KEY_PATH;

if (!existsSync(KEY_PATH)) {
  console.error(`[Alfred Relay] Error: Service account key not found at: ${KEY_PATH}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(KEY_PATH, "utf8"));

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount)
  });
}

const db = getFirestore();
const HOST_ID = "home-server";
const COMMAND_TIMEOUT_MS = 25000;

console.log(`[Alfred Relay] Starting daemon for host '${HOST_ID}' (PID: ${process.pid})...`);
console.log(`[Alfred Relay] Listening for pending commands in 'server_commands'...`);

function executeLocalCommand(commandLine: string, timeoutMs = 20000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    exec(commandLine, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const exitCode = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({
        stdout: stdout || "",
        stderr: stderr || (error && !stderr ? error.message : ""),
        exitCode
      });
    });
  });
}

const unsubscribe = db.collection("server_commands")
  .where("status", "==", "pending")
  .onSnapshot(async (snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type !== "added" && change.type !== "modified") continue;

      const doc = change.doc;
      const data = doc.data();

      // Only handle pending commands for this host
      if (data.status !== "pending") continue;
      const targetHost = data.host || "home-server";
      if (targetHost !== HOST_ID && targetHost !== "localhost" && targetHost !== "baris-IPXSB-H61") {
        continue;
      }

      const commandId = doc.id;
      const commandName = data.command as AllowedSSHCommand;
      const rawArgs = data.args || {};
      const createdAtMs = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now();
      const isExpired = data.expiresAt ? Date.now() > data.expiresAt : (Date.now() - createdAtMs > COMMAND_TIMEOUT_MS);

      if (isExpired) {
        console.warn(`[Alfred Relay] Command '${commandId}' (${commandName}) expired. Skipping.`);
        await doc.ref.update({ status: "expired" }).catch(() => {});
        continue;
      }

      console.log(`[Alfred Relay] ⚙️ Processing command '${commandId}': ${commandName} with args:`, JSON.stringify(rawArgs));

      // Atomically mark as processing so another listener doesn't duplicate execution
      try {
        await doc.ref.update({
          status: "processing",
          startedAt: FieldValue.serverTimestamp()
        });
      } catch (err) {
        console.warn(`[Alfred Relay] Could not claim command '${commandId}':`, err);
        continue;
      }

      const commandDef = CommandRegistry.get(commandName);
      if (!commandDef) {
        console.error(`[Alfred Relay] ❌ Command '${commandName}' is not in CommandRegistry allowlist.`);
        await doc.ref.update({
          status: "failed",
          error: `Command '${commandName}' is not permitted by home server allowlist.`,
          completedAt: FieldValue.serverTimestamp()
        });
        continue;
      }

      // Validate args strictly
      const validation = commandDef.validateArgs(rawArgs);
      if (!validation.valid) {
        console.error(`[Alfred Relay] ❌ Argument validation failed for '${commandName}':`, validation.error);
        await doc.ref.update({
          status: "failed",
          error: validation.error || "Invalid arguments.",
          completedAt: FieldValue.serverTimestamp()
        });
        continue;
      }

      const shellCmd = commandDef.buildCommand(validation.parsedArgs);
      const startTime = performance.now();

      try {
        console.log(`[Alfred Relay] Executing: ${shellCmd}`);
        const { stdout, stderr, exitCode } = await executeLocalCommand(shellCmd);
        const durationMs = Math.round(performance.now() - startTime);

        if (exitCode !== 0) {
          const errMsg = stderr.trim() || stdout.trim() || `Process exited with code ${exitCode}`;
          console.error(`[Alfred Relay] ❌ Command failed (${durationMs}ms): ${errMsg}`);
          await doc.ref.update({
            status: "failed",
            error: errMsg,
            durationMs,
            completedAt: FieldValue.serverTimestamp()
          });
          continue;
        }

        const parsedResult = commandDef.parseOutput(stdout, stderr, exitCode, validation.parsedArgs, HOST_ID);
        console.log(`[Alfred Relay] ✅ Successfully completed '${commandName}' in ${durationMs}ms`);

        await doc.ref.update({
          status: "completed",
          result: parsedResult,
          durationMs,
          completedAt: FieldValue.serverTimestamp()
        });
      } catch (execErr: unknown) {
        const durationMs = Math.round(performance.now() - startTime);
        const msg = execErr instanceof Error ? execErr.message : String(execErr);
        console.error(`[Alfred Relay] ❌ Error executing '${commandName}':`, msg);
        await doc.ref.update({
          status: "failed",
          error: msg,
          durationMs,
          completedAt: FieldValue.serverTimestamp()
        });
      }
    }
  }, (err) => {
    console.error("[Alfred Relay] Snapshot listener error:", err);
  });

function shutdown() {
  console.log("\n[Alfred Relay] Shutting down daemon gracefully...");
  unsubscribe();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
