/**
 * B.U.T.L.E.R. Alfred — Tool: ssh_execute(host, command, args)
 * Controlled remote SSH execution tool for strictly whitelisted commands.
 * This is NOT an arbitrary shell execution API.
 *
 * Definition, allow-list check, defaults and the first path check (with their
 * error text) come from ./ssh-tool-definitions.ts, which production
 * (functions/index.js) bundles too. CommandRegistry then applies each
 * command's own validation (SSHPathSandbox for list_directory).
 */

import { ITool, ToolDefinition, ToolParameterSchema, ToolExecutionContext } from "../types.js";
import { PermissionLevel } from "../../../alfred/control-plane/permission-system/types.js";
import {
  SSHConnectionManager,
  getSSHConnectionManager
} from "../../../alfred/execution-plane/ssh/ssh-connection-manager.js";
import {
  CommandRegistry,
  AllowedSSHCommand,
  SSHCommandResult,
  SSHCommandResultMap
} from "../../../alfred/execution-plane/ssh/command-registry.js";
import {
  SSH_EXECUTE_TOOL_DEFINITION,
  SSH_EXECUTE_TOOL_NAME,
  getSshCommandDenial,
  getSshSandboxPathDenial,
  resolveSshExecutePathArg,
  resolveSshHostArg
} from "./ssh-tool-definitions.js";

export interface SSHExecuteArgs<C extends AllowedSSHCommand = AllowedSSHCommand> {
  host: string;
  command: C;
  args?: Record<string, unknown>;
}

export class SSHExecuteTool implements ITool<SSHExecuteArgs, SSHCommandResult> {
  public readonly name = SSH_EXECUTE_TOOL_NAME;
  public readonly description = SSH_EXECUTE_TOOL_DEFINITION.function.description;
  public readonly permissionLevel = PermissionLevel.SAFE_READ;

  public readonly parameterSchema: ToolParameterSchema = SSH_EXECUTE_TOOL_DEFINITION.function.parameters;

  private connectionManager: SSHConnectionManager;

  constructor(connectionManager?: SSHConnectionManager) {
    this.connectionManager = connectionManager || getSSHConnectionManager();
  }

  public getDefinition(): ToolDefinition {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameterSchema
      }
    };
  }

  /**
   * Production's rules, in production's order: a missing or empty host
   * becomes 'home-server'; `command` must be exactly one of the allow-list
   * (no trimming; anything else, including a missing command, gets
   * production's "Command '<cmd>' is not permitted" text); `args` is not
   * type-checked, only `args.path` is read, for list_directory (missing or
   * empty -> 'Belgeler', then production's path check). Other commands ignore
   * `args`.
   *
   * src-only: a host or `args.path` that is not a string is rejected
   * (production would echo such a host, and throws a TypeError on such a
   * path), and list_directory paths then go through SSHPathSandbox.
   */
  public validateArgs(
    args: unknown
  ): { valid: boolean; error?: string; parsedArgs?: SSHExecuteArgs } {
    const host = resolveSshHostArg(args);

    const rawCommand = (args as { command?: unknown } | null | undefined)?.command;
    const commandDenial = getSshCommandDenial(rawCommand);
    if (commandDenial) {
      return { valid: false, error: commandDenial };
    }
    const command = rawCommand as AllowedSSHCommand;

    const path = command === "list_directory" ? resolveSshExecutePathArg(args) : undefined;
    // Production's check first, so its error wins whatever the host is.
    const pathDenial = typeof path === "string" ? getSshSandboxPathDenial(path) : null;
    if (pathDenial) {
      return { valid: false, error: pathDenial };
    }

    if (typeof host !== "string" || !host.trim()) {
      return {
        valid: false,
        error: "Missing required argument 'host'. Please specify an approved host (e.g. 'home-server')."
      };
    }

    let cmdArgs: Record<string, unknown> = {};
    if (command === "list_directory") {
      if (typeof path !== "string") {
        return {
          valid: false,
          error: "Argument 'args.path' must be a directory path string within 'Belgeler/'."
        };
      }
      cmdArgs = { path };
    }

    const argValidation = CommandRegistry.get(command)!.validateArgs(cmdArgs);
    if (!argValidation.valid) {
      return {
        valid: false,
        error: argValidation.error || `Invalid arguments for command '${command}'.`
      };
    }

    return {
      valid: true,
      parsedArgs: {
        host: host.trim(),
        command,
        args: argValidation.parsedArgs
      }
    };
  }

  public async execute<C extends AllowedSSHCommand>(
    args: SSHExecuteArgs<C>,
    _context?: ToolExecutionContext
  ): Promise<SSHCommandResultMap[C]> {
    return this.connectionManager.executeCommand(args.host, args.command, args.args);
  }
}
