/**
 * B.U.T.L.E.R. Alfred — Tool: ssh_connect(host)
 * Safe, side-effect-free tool to establish and verify an SSH connection to an approved host.
 *
 * Definition, host default and success message come from
 * ./ssh-tool-definitions.ts, which production (functions/index.js) bundles too.
 */

import { ITool, ToolDefinition, ToolParameterSchema, ToolExecutionContext } from "../types.js";
import { PermissionLevel } from "../../../alfred/control-plane/permission-system/types.js";
import { SSHConnectionManager, getSSHConnectionManager } from "../../../alfred/execution-plane/ssh/ssh-connection-manager.js";
import {
  SSH_CONNECT_TOOL_DEFINITION,
  SSH_CONNECT_TOOL_NAME,
  buildSshConnectedMessage,
  resolveSshHostArg
} from "./ssh-tool-definitions.js";

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
  public readonly name = SSH_CONNECT_TOOL_NAME;
  public readonly description = SSH_CONNECT_TOOL_DEFINITION.function.description;
  public readonly permissionLevel = PermissionLevel.EXECUTE;

  public readonly parameterSchema: ToolParameterSchema = SSH_CONNECT_TOOL_DEFINITION.function.parameters;

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
   * Production never rejects ssh_connect arguments: a missing or empty host
   * becomes 'home-server'. A host that is not a non-empty string cannot name
   * a registry entry, so it is rejected here (production has no real host to
   * resolve). The alias is trimmed for the registry lookup.
   */
  public validateArgs(args: unknown): { valid: boolean; error?: string; parsedArgs?: SSHConnectArgs } {
    const host = resolveSshHostArg(args);
    if (typeof host !== "string" || !host.trim()) {
      return {
        valid: false,
        error: "Missing required argument 'host'. Please specify a valid approved host identifier (e.g., 'home-server')."
      };
    }

    return {
      valid: true,
      parsedArgs: {
        host: host.trim()
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
      message: buildSshConnectedMessage(verification.host),
      latencyMs: verification.latencyMs
    };
  }
}
