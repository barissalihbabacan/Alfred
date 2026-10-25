/**
 * B.U.T.L.E.R. Alfred — Mock SSH Client
 * Test double for ISSHClient supporting reliable and deterministic unit tests
 * including connection states and SFTP directory listing.
 */

import { ISSHClient, DirectoryEntry, SSHExecResult } from "./ssh-client.interface.js";
import { SSHHostConfig } from "../../../core/config/ssh.config.js";
import { SSHPathSandbox } from "./ssh-path-sandbox.js";

export type MockSSHBehavior =
  | "success"
  | "auth_failure"
  | "timeout"
  | "connection_refused"
  | "unreachable";

export class MockSSHClient implements ISSHClient {
  private connected = false;
  public connectCalls: SSHHostConfig[] = [];
  public disconnectCalls = 0;
  public behavior: MockSSHBehavior = "success";
  public simulatedDelayMs = 0;

  // Mock directory contents keyed by normalized path (e.g. "Belgeler", "Belgeler/project")
  public mockDirectories = new Map<string, DirectoryEntry[]>();
  public mockFiles = new Set<string>();
  public mockSymlinks = new Map<string, string>(); // path -> real target path

  constructor(behavior: MockSSHBehavior = "success", simulatedDelayMs = 0) {
    this.behavior = behavior;
    this.simulatedDelayMs = simulatedDelayMs;
    this.initDefaultMockFilesystem();
  }

  private initDefaultMockFilesystem(): void {
    this.mockDirectories.set("Belgeler", [
      { name: "project", type: "directory" },
      { name: "docs", type: "directory" },
      { name: "notes.txt", type: "file", size: 1234, modifiedTime: "2026-09-01T12:00:00.000Z" },
      { name: "todo.md", type: "file", size: 512, modifiedTime: "2026-09-02T15:30:00.000Z" }
    ]);

    this.mockDirectories.set("Belgeler/project", [
      { name: "src", type: "directory" },
      { name: "package.json", type: "file", size: 890, modifiedTime: "2026-09-03T09:00:00.000Z" },
      { name: "README.md", type: "file", size: 2048, modifiedTime: "2026-09-03T09:05:00.000Z" }
    ]);

    this.mockDirectories.set("Belgeler/empty-dir", []);

    this.mockFiles.add("Belgeler/notes.txt");
    this.mockFiles.add("Belgeler/todo.md");
    this.mockFiles.add("Belgeler/project/package.json");
    this.mockFiles.add("Belgeler/project/README.md");

    // External symlink breakout fixture
    this.mockSymlinks.set("Belgeler/external-link", "/etc");
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async connect(config: SSHHostConfig): Promise<void> {
    this.connectCalls.push(config);

    if (this.simulatedDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.simulatedDelayMs));
    }

    switch (this.behavior) {
      case "success":
        this.connected = true;
        return;
      case "auth_failure":
        this.connected = false;
        throw new Error(
          "SSH connection failed: Authentication failed (public key rejected or unauthorized)."
        );
      case "timeout":
        this.connected = false;
        throw new Error(`SSH connection timed out after ${config.connectionTimeoutMs}ms.`);
      case "connection_refused":
        this.connected = false;
        throw new Error("SSH connection failed: Connection refused by target host.");
      case "unreachable":
        this.connected = false;
        throw new Error("SSH connection failed: Host unreachable or network unavailable.");
      default:
        this.connected = true;
        return;
    }
  }

  public async disconnect(): Promise<void> {
    this.disconnectCalls++;
    this.connected = false;
  }

  public execCalls: string[] = [];

  public async exec(
    command: string,
    _options?: { timeoutMs?: number }
  ): Promise<SSHExecResult> {
    if (!this.connected) {
      throw new Error("SSH client is not connected.");
    }

    this.execCalls.push(command);

    // 1. Check for list_directory script
    if (command.includes("---DIVIDER---") || command.includes("realpath -e -q")) {
      const targetMatch = command.match(/TARGET=\$\(realpath -e -q -- '([^']+)'\)/);
      const targetPath = targetMatch ? targetMatch[1] : "Belgeler";
      const normTarget = targetPath.replace(/\\/g, "/").replace(/\/+$/, "");
      const realSandboxRoot = "/home/baris/Belgeler";

      // Symlink escape check
      if (this.mockSymlinks.has(normTarget)) {
        const realTarget = this.mockSymlinks.get(normTarget)!;
        if (!SSHPathSandbox.isRealpathContained(realTarget, realSandboxRoot)) {
          return {
            stdout: `${realSandboxRoot}\n${realTarget}\n---DIVIDER---\n`,
            stderr: "Access denied: Resolves outside sandbox.",
            exitCode: 13
          };
        }
      }

      // Check if file, not directory
      if (this.mockFiles.has(normTarget)) {
        return {
          stdout: "",
          stderr: `Path '${targetPath}' is a file, not a directory.`,
          exitCode: 12
        };
      }

      // Check if directory exists in mock filesystem
      const dirEntries = this.mockDirectories.get(normTarget);
      if (!dirEntries) {
        return {
          stdout: "",
          stderr: `Remote path '${targetPath}' does not exist or is inaccessible.`,
          exitCode: 11
        };
      }

      // Build simulated LC_ALL=C ls -la --full-time output
      let lsOutput = `total ${dirEntries.length * 4}\n`;
      lsOutput += `drwxr-xr-x 2 baris baris 4096 2026-09-01 12:00:00.000000000 +0000 .\n`;
      lsOutput += `drwxr-xr-x 2 baris baris 4096 2026-09-01 12:00:00.000000000 +0000 ..\n`;

      for (const entry of dirEntries) {
        const dateStr = entry.modifiedTime
          ? entry.modifiedTime.replace("T", " ").replace("Z", " +0000")
          : "2026-09-01 12:00:00.000000000 +0000";

        if (entry.type === "directory") {
          lsOutput += `drwxr-xr-x 2 baris baris 4096 ${dateStr} ${entry.name}\n`;
        } else if (entry.type === "file") {
          const size = entry.size ?? 1024;
          lsOutput += `-rw-r--r-- 1 baris baris ${size} ${dateStr} ${entry.name}\n`;
        } else if (entry.type === "symlink") {
          lsOutput += `lrwxrwxrwx 1 baris baris 11 ${dateStr} ${entry.name} -> /mock/target\n`;
        } else {
          lsOutput += `?--------- 1 baris baris 0 ${dateStr} ${entry.name}\n`;
        }
      }

      const fullStdout = `${realSandboxRoot}\n${realSandboxRoot}/${normTarget}\n---DIVIDER---\n${lsOutput}`;
      return {
        stdout: fullStdout,
        stderr: "",
        exitCode: 0
      };
    }

    // 2. disk_usage: df -h
    if (command.includes("df -h")) {
      return {
        stdout: "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   20G   28G  42% /\n",
        stderr: "",
        exitCode: 0
      };
    }

    // 3. current_directory: pwd
    if (command === "pwd") {
      return {
        stdout: "/home/baris\n",
        stderr: "",
        exitCode: 0
      };
    }

    // 4. identity: whoami
    if (command === "whoami") {
      return {
        stdout: "baris\n",
        stderr: "",
        exitCode: 0
      };
    }

    // 5. system_info: uname -a
    if (command === "uname -a") {
      return {
        stdout: "Linux home-box 6.8.0-40-generic x86_64 GNU/Linux\n",
        stderr: "",
        exitCode: 0
      };
    }

    // 6. docker_ps: docker ps
    if (command.includes("docker ps")) {
      return {
        stdout: "NAMES               STATUS          PORTS\njellyfin            Up 3 days       0.0.0.0:8096->8096/tcp\nn8n                 Up 3 days       127.0.0.1:5678->5678/tcp\nnginx               Up 5 days       0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp\n",
        stderr: "",
        exitCode: 0
      };
    }

    // 7. docker_logs: docker logs
    if (command.includes("docker logs")) {
      return {
        stdout: "[INFO] Server started successfully.\n[INFO] Listening on port.\n",
        stderr: "",
        exitCode: 0
      };
    }

    // 8. docker_restart: docker restart
    if (command.includes("docker restart")) {
      const match = command.match(/docker restart\s+['"]?([^\s'"]+)['"]?/);
      const container = match ? match[1] : "jellyfin";
      return {
        stdout: `${container}\n`,
        stderr: "",
        exitCode: 0
      };
    }

    return {
      stdout: "",
      stderr: `bash: ${command}: command not found`,
      exitCode: 127
    };
  }
}
