/**
 * B.U.T.L.E.R. Alfred — production's placeholder SSH tool results.
 *
 * functions/index.js does not open SSH connections: for ssh_connect,
 * ssh_list_directory and ssh_execute it returns the fixed results below, after
 * the same defaults, allow-list check and path check the src tools apply
 * (ssh-tool-definitions.ts). The listing, disk usage, working directory, user
 * and uname strings are canned snapshots of the home server, not live data.
 *
 * Real execution lives in src/alfred/execution-plane/ssh (ssh2 client, host
 * registry, SSHPathSandbox, ls parser) and is not wired into production.
 *
 * Shared with functions/index.js (bundled via esbuild). Keep it pure.
 */

import {
  SSH_CONNECT_TOOL_NAME,
  SSH_EXECUTE_TOOL_NAME,
  SSH_LIST_DIRECTORY_TOOL_NAME,
  buildSshConnectedMessage,
  getSshCommandDenial,
  getSshSandboxPathDenial,
  resolveSshExecutePathArg,
  resolveSshHostArg,
  resolveSshListPathArg
} from "./ssh-tool-definitions.js";

export interface PlaceholderDirectoryEntry {
  name: string;
  type: "directory";
}

/** The canned top level of Belgeler/ that every allowed listing returns. */
export const PLACEHOLDER_BELGELER_ENTRIES: readonly PlaceholderDirectoryEntry[] = [
  { name: "Açık Kaynak", type: "directory" },
  { name: "Any Association", type: "directory" },
  { name: "Babacan Sites", type: "directory" },
  { name: "B.U.T.L.E.R. Alfred", type: "directory" },
  { name: "Chorus", type: "directory" },
  { name: "Ev Tasarımı", type: "directory" },
  { name: "family-tree", type: "directory" },
  { name: "jellyfin", type: "directory" },
  { name: "Lise", type: "directory" },
  { name: "Loa London", type: "directory" },
  { name: "Mythos", type: "directory" },
  { name: "Osmos", type: "directory" },
  { name: "superlig-fantasy-optimizer", type: "directory" },
  { name: "The Sins of the Fathers", type: "directory" },
  { name: "zen-dashboard", type: "directory" }
];

export type PlaceholderSshToolResult = Record<string, unknown>;

const SSH_TOOL_NAMES: readonly string[] = [SSH_CONNECT_TOOL_NAME, SSH_LIST_DIRECTORY_TOOL_NAME, SSH_EXECUTE_TOOL_NAME];

export function isSshToolName(fnName: unknown): boolean {
  return typeof fnName === "string" && SSH_TOOL_NAMES.includes(fnName);
}

function listing(host: unknown, targetPath: unknown): PlaceholderSshToolResult {
  const denial = getSshSandboxPathDenial(targetPath as string);
  if (denial) {
    return { error: denial };
  }
  return {
    host,
    path: targetPath,
    // Fresh copies each call: the result is serialised and sent to the client.
    entries: PLACEHOLDER_BELGELER_ENTRIES.map((entry) => ({ ...entry })),
    totalCount: 15
  };
}

/**
 * Production's result for an SSH tool call, exactly as functions/index.js
 * returned it inline: a result object, or `{ error }` for a denied path or
 * command. Returns undefined when `fnName` is not an SSH tool.
 *
 * `fnArgs` is whatever the model sent (parsed JSON, or the raw string when it
 * did not parse). Nothing is type-checked beyond production's checks, so a
 * non-string, truthy path throws a TypeError, as it did inline.
 */
export function runPlaceholderSshTool(fnName: unknown, fnArgs: unknown): PlaceholderSshToolResult | undefined {
  if (fnName === SSH_CONNECT_TOOL_NAME) {
    const targetHost = resolveSshHostArg(fnArgs);
    return {
      host: targetHost,
      status: "connected",
      message: buildSshConnectedMessage(targetHost)
    };
  }

  if (fnName === SSH_LIST_DIRECTORY_TOOL_NAME) {
    return listing(resolveSshHostArg(fnArgs), resolveSshListPathArg(fnArgs));
  }

  if (fnName === SSH_EXECUTE_TOOL_NAME) {
    const targetHost = resolveSshHostArg(fnArgs);
    const cmd = (fnArgs as { command?: unknown } | null | undefined)?.command;
    const denial = getSshCommandDenial(cmd);
    if (denial) {
      return { error: denial };
    }
    switch (cmd) {
      case "list_directory":
        return listing(targetHost, resolveSshExecutePathArg(fnArgs));
      case "disk_usage":
        return {
          host: targetHost,
          command: "disk_usage",
          output: "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   20G   28G  42% /"
        };
      case "current_directory":
        return { host: targetHost, command: "current_directory", currentDirectory: "/home/baris" };
      case "identity":
        return { host: targetHost, command: "identity", user: "baris" };
      case "system_info":
        return {
          host: targetHost,
          command: "system_info",
          systemInfo: "Linux home-box 6.8.0-40-generic x86_64 GNU/Linux"
        };
    }
  }

  return undefined;
}
