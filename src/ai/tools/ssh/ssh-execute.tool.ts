/**
 * B.U.T.L.E.R. Alfred — Tool: ssh_execute(host, command, args)
 * Controlled remote SSH execution tool for strictly whitelisted commands.
 * This is NOT an arbitrary shell execution API.
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
  ALLOWED_SSH_COMMANDS
} from "../../../alfred/execution-plane/ssh/command-registry.js";

export interface SSHExecuteArgs {
  host: string;
  command: AllowedSSHCommand;
  args?: Record<string, unknown>;
}

export class SSHExecuteTool implements ITool<SSHExecuteArgs, any> {
  public readonly name = "ssh_execute";
  public readonly description =
    "Executes a strictly whitelisted remote command on an approved host. Permitted commands: 'list_directory', 'disk_usage', 'current_directory', 'identity', 'system_info'. Arbitrary shell commands are strictly prohibited.";
  public readonly permissionLevel = PermissionLevel.SAFE_READ;

  public readonly parameterSchema: ToolParameterSchema = {
    type: "object",
    properties: {
      host: {
        type: "string",
        description: "The identifier of the approved remote host (e.g. 'home-server')."
      },
      command: {
        type: "string",
        enum: [...ALLOWED_SSH_COMMANDS],
        description:
          "The whitelisted command identifier: 'list_directory', 'disk_usage', 'current_directory', 'identity', or 'system_info'."
      },
      args: {
        type: "object",
        description:
          "Structured arguments specific to the chosen command (e.g. { path: 'Belgeler' } for 'list_directory').",
        properties: {
          path: {
            type: "string",
            description: "Directory path within 'Belgeler/' for 'list_directory'."
          }
        }
      }
    },
    required: ["host", "command"],
    additionalProperties: false
  };

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

  public validateArgs(
    args: unknown
  ): { valid: boolean; error?: string; parsedArgs?: SSHExecuteArgs } {
    if (!args || typeof args !== "object") {
      return {
        valid: false,
        error: "Invalid arguments: expected an object containing 'host' and 'command' properties."
      };
    }

    const cast = args as Record<string, unknown>;

    // 1. Validate host parameter
    if (typeof cast.host !== "string" || !cast.host.trim()) {
      return {
        valid: false,
        error: "Missing required argument 'host'. Please specify an approved host (e.g. 'home-server')."
      };
    }

    // 2. Validate command parameter against strict whitelist
    if (typeof cast.command !== "string" || !cast.command.trim()) {
      return {
        valid: false,
        error: "Missing required argument 'command'. Please specify a whitelisted command identifier."
      };
    }

    const commandStr = cast.command.trim();
    if (!CommandRegistry.isAllowedCommand(commandStr)) {
      const allowed = ALLOWED_SSH_COMMANDS.join(", ");
      return {
        valid: false,
        error: `Command '${commandStr}' is not permitted. Only strictly whitelisted commands (${allowed}) may be executed.`
      };
    }

    const command = commandStr as AllowedSSHCommand;
    const commandDef = CommandRegistry.get(command)!;

    // 3. Validate args parameter
    let cmdArgs: Record<string, unknown> = {};
    if (cast.args !== undefined && cast.args !== null) {
      if (typeof cast.args !== "object" || Array.isArray(cast.args)) {
        return {
          valid: false,
          error: "Argument 'args' must be a structured key-value object, not a raw shell string or array."
        };
      }
      cmdArgs = cast.args as Record<string, unknown>;
    }

    const argValidation = commandDef.validateArgs(cmdArgs);
    if (!argValidation.valid) {
      return {
        valid: false,
        error: argValidation.error || `Invalid arguments for command '${command}'.`
      };
    }

    return {
      valid: true,
      parsedArgs: {
        host: cast.host.trim(),
        command,
        args: argValidation.parsedArgs
      }
    };
  }

  public async execute(args: SSHExecuteArgs, _context?: ToolExecutionContext): Promise<any> {
    return this.connectionManager.executeCommand(args.host, args.command, args.args);
  }
}
