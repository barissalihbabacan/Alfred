/**
 * B.U.T.L.E.R. Alfred — Mock SSH Client
 * Test double for ISSHClient supporting reliable and deterministic unit tests
 * including connection states and SFTP directory listing.
 */

import { ISSHClient, DirectoryEntry, FileType } from "./ssh-client.interface.js";
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

  public async listDirectory(
    targetPath: string,
    sandboxRootPath: string = "Belgeler"
  ): Promise<{ realPath: string; entries: DirectoryEntry[] }> {
    if (!this.connected) {
      throw new Error("SSH client is not connected.");
    }

    const normTarget = targetPath.replace(/\\/g, "/").replace(/\/+$/, "");
    const realSandboxRoot = "/home/baris/Belgeler";

    // Check if target is a symlink
    if (this.mockSymlinks.has(normTarget)) {
      const realTarget = this.mockSymlinks.get(normTarget)!;
      if (!SSHPathSandbox.isRealpathContained(realTarget, realSandboxRoot)) {
        throw new Error(
          `Access denied: Path '${targetPath}' resolves outside the permitted '${sandboxRootPath}' sandbox.`
        );
      }
    }

    // Check if target is a file rather than directory
    if (this.mockFiles.has(normTarget)) {
      throw new Error(`Path '${targetPath}' is a file, not a directory.`);
    }

    const dirEntries = this.mockDirectories.get(normTarget);
    if (!dirEntries) {
      throw new Error(`Remote path '${targetPath}' does not exist or is inaccessible.`);
    }

    // Deterministic sorting: directories first alphabetically, then files alphabetically
    const sorted = [...dirEntries].sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (a.type !== "directory" && b.type === "directory") return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return {
      realPath: `/home/baris/${normTarget}`,
      entries: sorted
    };
  }
}
