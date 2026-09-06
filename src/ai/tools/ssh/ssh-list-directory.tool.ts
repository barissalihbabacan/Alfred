/**
 * B.U.T.L.E.R. Alfred — Tool: ssh_list_directory(host, path)
 * Safe, read-only directory listing tool strictly confined to the "Belgeler/" filesystem sandbox.
 */

import { ITool, ToolDefinition, ToolParameterSchema, ToolExecutionContext } from "../types.js";
import { PermissionLevel } from "../../../alfred/control-plane/permission-system/types.js";
import {
  SSHConnectionManager,
  getSSHConnectionManager
} from "../../../alfred/execution-plane/ssh/ssh-connection-manager.js";
import { SSHListDirectoryResult } from "../../../alfred/execution-plane/ssh/ssh-client.interface.js";

export interface SSHListDirectoryArgs {
  host: string;
  path: string;
}

export class SSHListDirectoryTool
  implements ITool<SSHListDirectoryArgs, SSHListDirectoryResult> {
  public readonly name = "ssh_list_directory";
  public readonly description =
    "Lists directory contents on an approved remote host within the permitted 'Belgeler/' filesystem sandbox. Use this tool when the user inquires about files or folders in their documents directory.";
  public readonly permissionLevel = PermissionLevel.SAFE_READ;

  public readonly parameterSchema: ToolParameterSchema = {
    type: "object",
    properties: {
      host: {
        type: "string",
        description:
          "The identifier of the approved remote host to inspect (e.g. 'home-server')."
      },
      path: {
        type: "string",
        description:
          "The directory path to inspect, strictly within the 'Belgeler/' sandbox root (e.g. 'Belgeler', 'Belgeler/project')."
      }
    },
    required: ["host", "path"],
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
  ): { valid: boolean; error?: string; parsedArgs?: SSHListDirectoryArgs } {
    if (!args || typeof args !== "object") {
      return {
        valid: false,
        error: "Invalid arguments: expected an object containing 'host' and 'path' properties."
      };
    }

    const cast = args as Record<string, unknown>;

    if (typeof cast.host !== "string" || !cast.host.trim()) {
      return {
        valid: false,
        error: "Missing required argument 'host'. Please specify an approved host (e.g. 'home-server')."
      };
    }

    if (typeof cast.path !== "string") {
      return {
        valid: false,
        error: "Missing required argument 'path'. Please specify a directory path within 'Belgeler/'."
      };
    }

    return {
      valid: true,
      parsedArgs: {
        host: cast.host.trim(),
        path: cast.path.trim()
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
