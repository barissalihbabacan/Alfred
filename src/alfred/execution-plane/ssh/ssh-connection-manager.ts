/**
 * B.U.T.L.E.R. Alfred — SSH Connection Manager
 * Manages host validation against allowlist, connection lifecycle verification, and immediate cleanup.
 */

import { ISSHClient, SSHClientFactory, SSHConnectionVerificationResult } from "./ssh-client.interface.js";
import { SSH2Client } from "./ssh2-client.js";
import { SSHConfig, getSSHConfig, resolveSSHHost } from "../../../core/config/ssh.config.js";

export interface SSHConnectionManagerOptions {
  clientFactory?: SSHClientFactory;
  config?: SSHConfig;
}

export class SSHConnectionManager {
  private clientFactory: SSHClientFactory;
  private config?: SSHConfig;

  constructor(options?: SSHConnectionManagerOptions) {
    this.clientFactory = options?.clientFactory || (() => new SSH2Client());
    this.config = options?.config;
  }

  /**
   * Verifies that an SSH connection can be established and authenticated to an approved host.
   * Immediately terminates the connection upon verification.
   * Throws an error if the host is unapproved, unreachable, or authentication fails.
   */
  public async verifyConnection(hostIdentifier: string): Promise<SSHConnectionVerificationResult> {
    if (!hostIdentifier || typeof hostIdentifier !== "string" || !hostIdentifier.trim()) {
      throw new Error("Invalid host parameter: Host name must be a non-empty string.");
    }

    const hostConfig = resolveSSHHost(hostIdentifier, this.config);
    if (!hostConfig) {
      throw new Error(
        `Host '${hostIdentifier}' is not recognized or permitted. Only approved hosts configured in Alfred's host registry (e.g. 'home-server') are accessible.`
      );
    }

    const client = this.clientFactory();
    const startTime = performance.now();

    try {
      await client.connect(hostConfig);
      const latencyMs = Math.round(performance.now() - startTime);

      // Cleanly terminate verification connection
      await client.disconnect();

      return {
        host: hostConfig.id,
        status: "connected",
        message: `Successfully connected to host '${hostConfig.id}' (${hostConfig.name}).`,
        latencyMs
      };
    } catch (err: any) {
      try {
        await client.disconnect();
      } catch {
        // Suppress secondary disconnect errors
      }
      throw err;
    }
  }
}

// Global default singleton connection manager
let defaultManagerInstance: SSHConnectionManager | null = null;

export function getSSHConnectionManager(): SSHConnectionManager {
  if (!defaultManagerInstance) {
    defaultManagerInstance = new SSHConnectionManager();
  }
  return defaultManagerInstance;
}
