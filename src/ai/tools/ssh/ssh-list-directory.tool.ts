/**
 * B.U.T.L.E.R. Alfred — Tool: ssh_list_directory(host, path)
 * Safe, read-only directory listing tool strictly confined to the "Belgeler/" filesystem sandbox.
 *
 * Definition, defaults and the first path check (with its error text) come from
 * ./ssh-tool-definitions.ts, which production (functions/index.js) bundles too.
 * The real listing then goes through SSHPathSandbox and realpath containment.
 */

import { ITool, ToolDefinition, ToolParameterSchema, ToolExecutionContext } from "../types.js";
import { PermissionLevel } from "../../../alfred/control-plane/permission-system/types.js";
import {
  SSHConnectionManager,
  getSSHConnectionManager
} from "../../../alfred/execution-plane/ssh/ssh-connection-manager.js";
import { SSHListDirectoryResult } from "../../../alfred/execution-plane/ssh/ssh-client.interface.js";
import {
  SSH_LIST_DIRECTORY_TOOL_DEFINITION,
  SSH_LIST_DIRECTORY_TOOL_NAME,
  getSshSandboxPathDenial,
  resolveSshHostArg,
  resolveSshListPathArg
} from "./ssh-tool-definitions.js";

export interface SSHListDirectoryArgs {
  host: string;
  path: string;
}

export class SSHListDirectoryTool
  implements ITool<SSHListDirectoryArgs, SSHListDirectoryResult> {
  public readonly name = SSH_LIST_DIRECTORY_TOOL_NAME;
  public readonly description = SSH_LIST_DIRECTORY_TOOL_DEFINITION.function.description;
  public readonly permissionLevel = PermissionLevel.SAFE_READ;

  public readonly parameterSchema: ToolParameterSchema = SSH_LIST_DIRECTORY_TOOL_DEFINITION.function.parameters;

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
   * Production's rules: a missing or empty host becomes 'home-server' and a
   * missing or empty path 'Belgeler'; a path containing ".." or starting with
   * /etc, /var or /home is refused with production's error text. The path is
   * passed on untrimmed (SSHPathSandbox trims and normalises it).
   *
   * src-only: a host or path that is not a string is rejected (production
   * would echo such a host, and throws a TypeError on such a path).
   */
  public validateArgs(
    args: unknown
  ): { valid: boolean; error?: string; parsedArgs?: SSHListDirectoryArgs } {
    const host = resolveSshHostArg(args);
    const path = resolveSshListPathArg(args);

    // Production's check first, so its error wins whatever the host is.
    const denial = typeof path === "string" ? getSshSandboxPathDenial(path) : null;
    if (denial) {
      return { valid: false, error: denial };
    }

    if (typeof host !== "string" || !host.trim()) {
      return {
        valid: false,
        error: "Missing required argument 'host'. Please specify an approved host (e.g. 'home-server')."
      };
    }

    if (typeof path !== "string") {
      return {
        valid: false,
        error: "Missing required argument 'path'. Please specify a directory path within 'Belgeler/'."
      };
    }

    return {
      valid: true,
      parsedArgs: {
        host: host.trim(),
        path
      }
    };
  }

  public async execute(
    args: SSHListDirectoryArgs,
    _context?: ToolExecutionContext
  ): Promise<SSHListDirectoryResult> {
    return this.connectionManager.listDirectory(args.host, args.path);
  }
}
