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

export interface SSHExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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
   * Executes a command on the remote host via the SSH exec channel.
   *
   * @param command The shell command string to execute
   * @param options Execution options such as timeout
   */
  exec(
    command: string,
    options?: { timeoutMs?: number }
  ): Promise<SSHExecResult>;
}

export type SSHClientFactory = () => ISSHClient;
