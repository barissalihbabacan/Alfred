/**
 * B.U.T.L.E.R. Alfred — SSH tools: model-facing definitions and argument rules.
 *
 * Shared with functions/index.js (bundled via esbuild): production sends these
 * three definitions to the model and applies the same defaults, allow-list
 * check and path check, with the same error text. The src tools
 * (SSHConnectTool, SSHListDirectoryTool, SSHExecuteTool) use them too, then
 * add the guards a real SSH connection needs (host registry, full sandbox
 * normalisation, realpath containment) on top.
 *
 * Keep this module pure: no I/O, no imports with side effects.
 */

import type { ToolDefinition } from "../types.js";
import { ALLOWED_SSH_COMMANDS } from "../../../alfred/execution-plane/ssh/allowed-commands.js";

export const SSH_CONNECT_TOOL_NAME = "ssh_connect";
export const SSH_LIST_DIRECTORY_TOOL_NAME = "ssh_list_directory";
export const SSH_EXECUTE_TOOL_NAME = "ssh_execute";

/** Host used when a tool call omits `host` (or passes an empty/falsy one). */
export const DEFAULT_SSH_HOST = "home-server";

/** Directory used when a listing omits `path` (or passes an empty/falsy one). */
export const DEFAULT_SSH_PATH = "Belgeler";

export const SSH_CONNECT_TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: SSH_CONNECT_TOOL_NAME,
    description: "Verifies connectivity and authenticates an SSH connection to an approved remote host (e.g. 'home-server').",
    parameters: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "The identifier of the approved remote host to connect to (e.g. 'home-server')."
        }
      },
      required: ["host"]
    }
  }
};

export const SSH_LIST_DIRECTORY_TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: SSH_LIST_DIRECTORY_TOOL_NAME,
    description: "Lists directory contents on an approved remote host within the permitted 'Belgeler/' filesystem sandbox.",
    parameters: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "The identifier of the approved remote host to inspect (e.g. 'home-server')."
        },
        path: {
          type: "string",
          description: "The directory path to inspect, strictly within the 'Belgeler/' sandbox root (e.g. 'Belgeler', 'Belgeler/project')."
        }
      },
      required: ["host", "path"]
    }
  }
};

export const SSH_EXECUTE_TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: SSH_EXECUTE_TOOL_NAME,
    description: "Executes a strictly whitelisted remote command on an approved host. Permitted commands: 'list_directory', 'disk_usage', 'current_directory', 'identity', 'system_info'. Arbitrary shell execution is strictly prohibited.",
    parameters: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "The identifier of the approved remote host (e.g. 'home-server')."
        },
        command: {
          type: "string",
          enum: [...ALLOWED_SSH_COMMANDS],
          description: "The whitelisted command identifier to execute."
        },
        args: {
          type: "object",
          description: "Structured arguments specific to the chosen command (e.g. { path: 'Belgeler' } for 'list_directory').",
          properties: {
            path: {
              type: "string",
              description: "Directory path within 'Belgeler/' for 'list_directory'."
            }
          }
        }
      },
      required: ["host", "command"]
    }
  }
};

/** Tool-call arguments as the model sends them: anything, validated below. */
export interface RawSshToolArgs {
  host?: unknown;
  path?: unknown;
  command?: unknown;
  args?: { path?: unknown } | null;
}

/**
 * The host a call targets: `host` as given, or DEFAULT_SSH_HOST when it is
 * missing or falsy. Not trimmed or type-checked (production echoes it as is).
 */
export function resolveSshHostArg(fnArgs: unknown): unknown {
  return (fnArgs as RawSshToolArgs | null | undefined)?.host || DEFAULT_SSH_HOST;
}

/** ssh_list_directory's `path`, or DEFAULT_SSH_PATH when missing or falsy. */
export function resolveSshListPathArg(fnArgs: unknown): unknown {
  return (fnArgs as RawSshToolArgs | null | undefined)?.path || DEFAULT_SSH_PATH;
}

/** ssh_execute list_directory's `args.path`, or DEFAULT_SSH_PATH when missing or falsy. */
export function resolveSshExecutePathArg(fnArgs: unknown): unknown {
  return (fnArgs as RawSshToolArgs | null | undefined)?.args?.path || DEFAULT_SSH_PATH;
}

/**
 * Production's sandbox check: rejects a path containing ".." or starting with
 * "/etc", "/var" or "/home", and returns its error text; null means allowed.
 *
 * It is a deny-list, not a confinement: "/root", "Documents" or "%2e%2e" pass.
 * Real listings must also go through SSHPathSandbox.
 *
 * Expects a string. Like production, anything else is not type-checked: a
 * value without `includes`/`startsWith` (a number, an object) throws a
 * TypeError, and an array is tested element-wise by `includes`.
 */
export function getSshSandboxPathDenial(targetPath: string): string | null {
  if (
    targetPath.includes("..") ||
    targetPath.startsWith("/etc") ||
    targetPath.startsWith("/var") ||
    targetPath.startsWith("/home")
  ) {
    return `Access denied: Path '${targetPath}' resolves outside the permitted 'Belgeler/' sandbox.`;
  }
  return null;
}

/**
 * Production's ssh_execute allow-list check: exact match, no trimming or case
 * folding. Returns the error text for anything else (including undefined,
 * which reads "Command 'undefined' ..."), or null when allowed.
 */
export function getSshCommandDenial(cmd: unknown): string | null {
  const allowedCmds: readonly unknown[] = ALLOWED_SSH_COMMANDS;
  if (!allowedCmds.includes(cmd)) {
    return `Command '${cmd}' is not permitted. Only strictly whitelisted commands (${allowedCmds.join(", ")}) may be executed.`;
  }
  return null;
}

/** ssh_connect's success message. */
export function buildSshConnectedMessage(host: unknown): string {
  return `Successfully connected to host '${host}'. All credentials and handshakes are verified.`;
}
