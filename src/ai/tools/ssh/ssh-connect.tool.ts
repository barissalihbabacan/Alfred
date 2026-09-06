/**
 * B.U.T.L.E.R. Alfred — Tool: ssh_connect(host)
 * Safe, side-effect-free tool to establish and verify an SSH connection to an approved host.
 */

import { ITool, ToolDefinition, ToolParameterSchema, ToolExecutionContext } from "../types.js";
import { PermissionLevel } from "../../../alfred/control-plane/permission-system/types.js";
import { SSHConnectionManager, getSSHConnectionManager } from "../../../alfred/execution-plane/ssh/ssh-connection-manager.js";

export interface SSHConnectArgs {
  host: string;
}

export interface SSHConnectResult {
  host: string;
  status: "connected";
  message: string;
  latencyMs?: number;
}

export class SSHConnectTool implements ITool<SSHConnectArgs, SSHConnectResult> {
  public readonly name = "ssh_connect";
  public readonly description =
    "Verifies connectivity and authenticates an SSH connection to an approved remote host (e.g. 'home-server'). Use this whenever the user requests to connect to, check, or verify access to their server.";
  public readonly permissionLevel = PermissionLevel.EXECUTE;

  public readonly parameterSchema: ToolParameterSchema = {
    type: "object",
    properties: {
      host: {
        type: "string",
        description:
          "The identifier or alias of the approved remote host to connect to (e.g. 'home-server', 'dev-sunucum', 'macbook')."
      }
    },
    required: ["host"],
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

  public validateArgs(args: unknown): { valid: boolean; error?: string; parsedArgs?: SSHConnectArgs } {
    if (!args || typeof args !== "object") {
      return {
        valid: false,
        error: "Invalid arguments: expected an object containing a 'host' string property."
      };
    }

    const cast = args as Record<string, unknown>;
    if (typeof cast.host !== "string" || !cast.host.trim()) {
      return {
        valid: false,
        error: "Missing required argument 'host'. Please specify a valid approved host identifier (e.g., 'home-server')."
      };
    }

    return {
      valid: true,
      parsedArgs: {
        host: cast.host.trim()
      }
    };
  }

  public async execute(
    args: SSHConnectArgs,
    _context?: ToolExecutionContext
  ): Promise<SSHConnectResult> {
    const verification = await this.connectionManager.verifyConnection(args.host);

    return {
      host: verification.host,
      status: "connected",
      message: verification.message,
      latencyMs: verification.latencyMs
    };
  }
}
