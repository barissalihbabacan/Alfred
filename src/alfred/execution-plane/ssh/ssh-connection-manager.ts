/**
 * B.U.T.L.E.R. Alfred — SSH Connection Manager
 * Manages host validation against allowlist, connection lifecycle verification,
 * and secure sandboxed directory listing via SFTP.
 */

import {
  ISSHClient,
  SSHClientFactory,
  SSHConnectionVerificationResult,
  SSHListDirectoryResult
} from "./ssh-client.interface.js";
import { SSH2Client } from "./ssh2-client.js";
import { SSHConfig, getSSHConfig, resolveSSHHost } from "../../../core/config/ssh.config.js";
import { RemoteCommandExecutor } from "./remote-command-executor.js";
import { AllowedSSHCommand } from "./command-registry.js";

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

      return {
        host: hostConfig.id,
        status: "connected",
        message: `Successfully connected to host '${hostConfig.id}' (${hostConfig.name}).`,
        latencyMs
      };
    } finally {
      try {
        await client.disconnect();
      } catch {
        // Suppress secondary disconnect errors
      }
    }
  }

  /**
   * Inspects directory contents on an approved SSH server while enforcing a strict filesystem sandbox.
   * Target path and any resolved symlinks must remain inside "Belgeler/".
   * Uses SSH exec (not SFTP) and cleanly closes the connection upon completion.
   */
  public async listDirectory(
    hostIdentifier: string,
    requestedPath: string
  ): Promise<SSHListDirectoryResult> {
    const executor = new RemoteCommandExecutor({
      clientFactory: this.clientFactory,
      config: this.config
    });
    return executor.executeListDirectory(hostIdentifier, requestedPath);
  }

  /**
   * Executes a strictly whitelisted command on an approved SSH server.
   */
  public async executeCommand(
    hostIdentifier: string,
    command: AllowedSSHCommand | string,
    rawArgs?: unknown
  ): Promise<any> {
    const executor = new RemoteCommandExecutor({
      clientFactory: this.clientFactory,
      config: this.config
    });
    return executor.executeCommand(hostIdentifier, command, rawArgs);
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
