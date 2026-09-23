/**
 * B.U.T.L.E.R. Alfred — Remote Command Executor
 * Secure execution bridge connecting high-level tools to SSH exec channels.
 * Enforces host allowlists, whitelisted commands, trusted argument templates,
 * and guaranteed connection closure.
 */

import { SSHClientFactory, SSHListDirectoryResult } from "./ssh-client.interface.js";
import { SSH2Client } from "./ssh2-client.js";
import { SSHConfig, resolveSSHHost } from "../../../core/config/ssh.config.js";
import {
  CommandRegistry,
  AllowedSSHCommand,
  SSHCommandResult,
  SSHCommandResultMap
} from "./command-registry.js";

export interface RemoteCommandExecutorOptions {
  clientFactory?: SSHClientFactory;
  config?: SSHConfig;
}

export class RemoteCommandExecutor {
  private clientFactory: SSHClientFactory;
  private config?: SSHConfig;

  constructor(options?: RemoteCommandExecutorOptions) {
    this.clientFactory = options?.clientFactory || (() => new SSH2Client());
    this.config = options?.config;
  }

  /**
   * Executes a strictly whitelisted command on an approved SSH host.
   * Enforces argument validation, trusted template generation, and clean disconnection.
   */
  public async executeCommand<C extends AllowedSSHCommand>(
    hostIdentifier: string,
    command: C,
    rawArgs?: unknown
  ): Promise<SSHCommandResultMap[C]>;
  public async executeCommand(
    hostIdentifier: string,
    command: AllowedSSHCommand | string,
    rawArgs?: unknown
  ): Promise<SSHCommandResult>;
  public async executeCommand(
    hostIdentifier: string,
    command: AllowedSSHCommand | string,
    rawArgs?: unknown
  ): Promise<SSHCommandResult> {
    if (!hostIdentifier || typeof hostIdentifier !== "string" || !hostIdentifier.trim()) {
      throw new Error("Invalid host parameter: Host name must be a non-empty string.");
    }

    // 1. Host allowlist verification
    const hostConfig = resolveSSHHost(hostIdentifier, this.config);
    if (!hostConfig) {
      throw new Error(
        `Host '${hostIdentifier}' is not recognized or permitted. Only approved hosts configured in Alfred's host registry (e.g. 'home-server') are accessible.`
      );
    }

    // 2. Command whitelist verification
    if (!CommandRegistry.isAllowedCommand(command as string)) {
      const allowedList = CommandRegistry.getAllowedCommands().join(", ");
      throw new Error(
        `Command '${command}' is not permitted. Only strictly whitelisted commands (${allowedList}) may be executed.`
      );
    }

    const commandDef = CommandRegistry.get(command)!;

    // 3. Command-specific argument validation
    const validation = commandDef.validateArgs(rawArgs);
    if (!validation.valid) {
      throw new Error(validation.error || `Invalid arguments for command '${command}'.`);
    }

    // 4. Trusted command template generation
    const shellCommand = commandDef.buildCommand(validation.parsedArgs);

    // 5. Remote execution via SSH exec channel with guaranteed disconnection
    const client = this.clientFactory();
    try {
      await client.connect(hostConfig);
      const execResult = await client.exec(shellCommand);

      return commandDef.parseOutput(
        execResult.stdout,
        execResult.stderr,
        execResult.exitCode,
        validation.parsedArgs,
        hostConfig.id
      );
    } finally {
      try {
        await client.disconnect();
      } catch {
        // Suppress secondary disconnect errors
      }
    }
  }

  /**
   * High-level helper for directory listing inside the 'Belgeler/' sandbox.
   */
  public async executeListDirectory(
    hostIdentifier: string,
    path: string
  ): Promise<SSHListDirectoryResult> {
    return this.executeCommand(hostIdentifier, "list_directory", { path });
  }
}

// Global default singleton executor
let defaultExecutorInstance: RemoteCommandExecutor | null = null;

export function getRemoteCommandExecutor(): RemoteCommandExecutor {
  if (!defaultExecutorInstance) {
    defaultExecutorInstance = new RemoteCommandExecutor();
  }
  return defaultExecutorInstance;
}
