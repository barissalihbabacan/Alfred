/**
 * B.U.T.L.E.R. Alfred — SSH2 Implementation of ISSHClient
 * Wraps ssh2 library to establish and authenticate connections safely with strict timeouts
 * and provides structured SFTP directory listing with strict sandbox validation.
 */

import { Client as SSH2LibClient, ConnectConfig } from "ssh2";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ISSHClient, SSHExecResult } from "./ssh-client.interface.js";
import { SSHHostConfig } from "../../../core/config/ssh.config.js";
import { errorMessage } from "../../../core/errors/index.js";

/** Exit code reported when the remote side sent no exit status (signal, dropped channel). */
export const NO_EXIT_STATUS_CODE = 255;

/**
 * The result of a finished exec channel. Output is decoded once from the
 * collected bytes, so a UTF-8 character split across two SSH packets ("ş" in
 * "Şirket") stays intact. ssh2 closes with `(null, "SIGKILL")` for a killed
 * command and with no code at all when the channel dropped: neither is a
 * success, so both report NO_EXIT_STATUS_CODE and say why in stderr.
 */
export function toExecResult(
  stdoutChunks: Buffer[],
  stderrChunks: Buffer[],
  code: number | null | undefined,
  signal?: string | null
): SSHExecResult {
  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  let stderr = Buffer.concat(stderrChunks).toString("utf8");
  if (typeof code === "number") return { stdout, stderr, exitCode: code };
  const why = signal ? `terminated by signal ${signal}` : "closed without an exit status";
  stderr += `${stderr && !stderr.endsWith("\n") ? "\n" : ""}[ssh] Remote command ${why}.`;
  return { stdout, stderr, exitCode: NO_EXIT_STATUS_CODE };
}

export class SSH2Client implements ISSHClient {
  private client: SSH2LibClient | null = null;
  private connected = false;

  public isConnected(): boolean {
    return this.connected;
  }

  public async connect(config: SSHHostConfig): Promise<void> {
    if (this.connected) {
      await this.disconnect();
    }

    return new Promise<void>((resolve, reject) => {
      const client = new SSH2LibClient();
      this.client = client;

      let settled = false;
      const timeoutMs = config.connectionTimeoutMs || 7000;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.connected = false;
          try {
            client.destroy();
          } catch {
            // Ignore cleanup errors
          }
          reject(new Error(`SSH connection timed out after ${timeoutMs}ms.`));
        }
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
      };

      client.on("ready", () => {
        if (!settled) {
          settled = true;
          this.connected = true;
          cleanup();
          resolve();
        }
      });

      client.on("error", (err: Error) => {
        if (!settled) {
          settled = true;
          this.connected = false;
          cleanup();
          try {
            client.destroy();
          } catch {
            // Ignore cleanup errors
          }
          const safeMessage = this.sanitizeErrorMessage(err.message);
          reject(new Error(`SSH connection failed: ${safeMessage}`));
        }
      });

      client.on("close", () => {
        this.connected = false;
      });

      client.on("end", () => {
        this.connected = false;
      });

      // Prepare connection options
      try {
        const connectOptions: ConnectConfig = {
          host: config.hostname,
          port: config.port,
          username: config.username,
          readyTimeout: timeoutMs,
          keepaliveInterval: 0
        };

        if (config.authMethod === "privateKey") {
          let privateKeyData: string | Buffer | undefined = config.privateKey;
          if (!privateKeyData && config.privateKeyPath) {
            const resolvedPath = config.privateKeyPath.startsWith("~")
              ? path.join(os.homedir(), config.privateKeyPath.slice(1))
              : config.privateKeyPath;

            if (!fs.existsSync(resolvedPath)) {
              cleanup();
              settled = true;
              return reject(new Error(`SSH private key file not found on server.`));
            }
            privateKeyData = fs.readFileSync(resolvedPath);
          }

          if (!privateKeyData) {
            cleanup();
            settled = true;
            return reject(new Error("SSH private key configuration is missing."));
          }

          connectOptions.privateKey = privateKeyData;
          if (config.passphrase) {
            connectOptions.passphrase = config.passphrase;
          }
        }

        client.connect(connectOptions);
      } catch (prepErr: unknown) {
        cleanup();
        settled = true;
        reject(new Error(`Failed to initiate SSH connection: ${errorMessage(prepErr)}`));
      }
    });
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      try {
        this.client.end();
        this.client.destroy();
      } catch {
        // Ignore termination errors
      } finally {
        this.client = null;
        this.connected = false;
      }
    }
  }

  public async exec(
    command: string,
    options?: { timeoutMs?: number }
  ): Promise<SSHExecResult> {
    if (!this.client || !this.connected) {
      throw new Error("SSH client is not connected.");
    }

    return new Promise((resolve, reject) => {
      const timeoutMs = options?.timeoutMs || 15000;
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`SSH exec command timed out after ${timeoutMs}ms.`));
        }
      }, timeoutMs);

      this.client!.exec(command, (err, stream) => {
        if (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            return reject(new Error(`Failed to execute SSH command: ${err.message}`));
          }
          return;
        }

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        stream.on("data", (data: Buffer | string) => {
          stdoutChunks.push(Buffer.from(data));
        });

        stream.stderr.on("data", (data: Buffer | string) => {
          stderrChunks.push(Buffer.from(data));
        });

        stream.on("close", (code: number | null | undefined, signal?: string | null) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(toExecResult(stdoutChunks, stderrChunks, code, signal));
          }
        });

        stream.on("error", (streamErr: Error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error(`SSH stream error: ${streamErr.message}`));
          }
        });
      });
    });
  }

  private sanitizeErrorMessage(msg: string): string {
    if (/all configured authentication methods failed/i.test(msg)) {
      return "Authentication failed (public key rejected or unauthorized).";
    }
    if (/ECONNREFUSED/i.test(msg)) {
      return "Connection refused by target host.";
    }
    if (/EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
      return "Host unreachable or network unavailable.";
    }
    if (/ETIMEDOUT/i.test(msg)) {
      return "Connection timed out.";
    }
    return msg;
  }
}
