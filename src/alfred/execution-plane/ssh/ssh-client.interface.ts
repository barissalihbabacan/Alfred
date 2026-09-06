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
}

export type SSHClientFactory = () => ISSHClient;
