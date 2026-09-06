/**
 * B.U.T.L.E.R. Alfred — SSH Client Interface
 * Abstraction layer decoupling SSH communication implementations (ssh2 vs mock).
 */

import { SSHHostConfig } from "../../../core/config/ssh.config.js";

export interface SSHConnectionVerificationResult {
  host: string;
  status: "connected" | "failed";
  message: string;
  latencyMs?: number;
}

export type FileType = "file" | "directory" | "symlink" | "other";

export interface DirectoryEntry {
  name: string;
  type: FileType;
  size?: number;
  modifiedTime?: string;
}

export interface SSHListDirectoryResult {
  host: string;
  path: string;
  entries: DirectoryEntry[];
  totalCount: number;
}

export interface ISSHClient {
  /**
   * Attempts to establish and authenticate an SSH connection using host configuration.
   * Rejects if connection times out or authentication fails.
   */
  connect(config: SSHHostConfig): Promise<void>;

  /**
   * Cleanly closes the active SSH connection.
   */
  disconnect(): Promise<void>;

  /**
   * Returns true if connection is active.
   */
  isConnected(): boolean;

  /**
   * Securely lists directory entries via SFTP while enforcing that targetPath
   * and any resolved symlink remain strictly within sandboxRootPath.
   *
   * @param targetPath Path to inspect (e.g. "Belgeler" or "Belgeler/sub")
   * @param sandboxRootPath Sandbox boundary root (default: "Belgeler")
   */
  listDirectory(
    targetPath: string,
    sandboxRootPath?: string
  ): Promise<{ realPath: string; entries: DirectoryEntry[] }>;
}

export type SSHClientFactory = () => ISSHClient;
