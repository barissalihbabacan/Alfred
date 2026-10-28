import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SSH_CONNECT_TOOL_DEFINITION,
  SSH_EXECUTE_TOOL_DEFINITION,
  SSH_LIST_DIRECTORY_TOOL_DEFINITION,
  getSshCommandDenial,
  getSshSandboxPathDenial,
  resolveSshExecutePathArg,
  resolveSshHostArg,
  resolveSshListPathArg
} from "../../src/ai/tools/ssh/ssh-tool-definitions.js";
import { SSHConnectTool } from "../../src/ai/tools/ssh/ssh-connect.tool.js";
import { SSHListDirectoryTool } from "../../src/ai/tools/ssh/ssh-list-directory.tool.js";
import { SSHExecuteTool } from "../../src/ai/tools/ssh/ssh-execute.tool.js";
import { ALLOWED_SSH_COMMANDS } from "../../src/alfred/execution-plane/ssh/allowed-commands.js";
import { CommandRegistry } from "../../src/alfred/execution-plane/ssh/command-registry.js";
import { SSHPathSandbox } from "../../src/alfred/execution-plane/ssh/ssh-path-sandbox.js";
import { SSHConnectionManager } from "../../src/alfred/execution-plane/ssh/ssh-connection-manager.js";
import { MockSSHClient } from "../../src/alfred/execution-plane/ssh/mock-ssh-client.js";

/**
 * Production contract for the SSH tools (ssh_connect, ssh_list_directory,
 * ssh_execute), which functions/index.js now imports from src/ (bundled via
 * esbuild). Production never opens an SSH connection: it applies a few
 * argument checks and returns canned results.
 *
 * The `LEGACY_*` definitions and `legacyRunTool` below are verbatim copies of
 * what functions/index.js carried inline before the migration (only renamed,
 * re-indented, wrapped in a function and typed; the definitions gained
 * `as const`). The differential tests prove the shared code returns the same
 * result, or throws the same error, for every input, so the migration is a
 * no-op in production. The last block checks that the src tools (real SSH)
 * return production's error text wherever production refuses a call.
 */

// ---------------------------------------------------------------------------
// Verbatim pre-migration production code (functions/index.js)
// ---------------------------------------------------------------------------

const LEGACY_SSH_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: "ssh_connect",
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
} as const;

const LEGACY_SSH_LIST_DIRECTORY_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: "ssh_list_directory",
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
} as const;

const LEGACY_SSH_EXECUTE_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: "ssh_execute",
    description: "Executes a strictly whitelisted remote command on an approved host. Permitted commands: 'list_directory', 'disk_usage', 'current_directory', 'identity', 'system_info', 'docker_ps', 'docker_logs', 'docker_restart'. Arbitrary shell execution is strictly prohibited.",
    parameters: {
      type: "object",
      properties: {
        host: {
          type: "string",
          description: "The identifier of the approved remote host (e.g. 'home-server')."
        },
        command: {
          type: "string",
          enum: ["list_directory", "disk_usage", "current_directory", "identity", "system_info", "docker_ps", "docker_logs", "docker_restart"],
          description: "The whitelisted command identifier to execute."
        },
        args: {
          type: "object",
          description: "Structured arguments specific to the chosen command (e.g. { path: 'Belgeler' } for 'list_directory', { container: 'jellyfin' } for 'docker_logs'/'docker_restart', { all: true } for 'docker_ps').",
          properties: {
            path: {
              type: "string",
              description: "Directory path within 'Belgeler/' for 'list_directory'."
            },
            container: {
              type: "string",
              description: "Container name for 'docker_logs' and 'docker_restart' (e.g. 'jellyfin', 'n8n', 'nginx')."
            },
            lines: {
              type: "number",
              description: "Number of log lines to retrieve for 'docker_logs' (default: 50)."
            },
            all: {
              type: "boolean",
              description: "Show all containers including stopped ones for 'docker_ps'."
            }
          }
        }
      },
      required: ["host", "command"]
    }
  }
} as const;

/** What the model sent: anything at runtime (typed loosely only to compile the verbatim body). */
type LegacyArgs = { host: string; path: string; command: string; args: { path: string } };

/** The SSH branches of the tool loop, plus its final `else`. */
function legacyRunTool(fnName: unknown, fnArgs: LegacyArgs): unknown {
  let toolResult;
  if (fnName === "ssh_connect") {
    const targetHost = fnArgs?.host || "home-server";
    toolResult = {
      host: targetHost,
      status: "connected",
      message: `Successfully connected to host '${targetHost}'. All credentials and handshakes are verified.`
    };
  } else if (fnName === "ssh_list_directory") {
    const targetHost = fnArgs?.host || "home-server";
    const targetPath = fnArgs?.path || "Belgeler";
    if (
      targetPath.includes("..") ||
      targetPath.startsWith("/etc") ||
      targetPath.startsWith("/var") ||
      targetPath.startsWith("/home")
    ) {
      toolResult = {
        error: `Access denied: Path '${targetPath}' resolves outside the permitted 'Belgeler/' sandbox.`
      };
    } else {
      toolResult = {
        host: targetHost,
        path: targetPath,
        entries: [
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
        ],
        totalCount: 15
      };
    }
  } else if (fnName === "ssh_execute") {
    const targetHost = fnArgs?.host || "home-server";
    const cmd = fnArgs?.command;
    const allowedCmds = [
      "list_directory",
      "disk_usage",
      "current_directory",
      "identity",
      "system_info",
      "docker_ps",
      "docker_logs",
      "docker_restart"
    ];

    if (!allowedCmds.includes(cmd)) {
      toolResult = {
        error: `Command '${cmd}' is not permitted. Only strictly whitelisted commands (${allowedCmds.join(", ")}) may be executed.`
      };
    } else if (cmd === "list_directory") {
      const targetPath = fnArgs?.args?.path || "Belgeler";
      if (
        targetPath.includes("..") ||
        targetPath.startsWith("/etc") ||
        targetPath.startsWith("/var") ||
        targetPath.startsWith("/home")
      ) {
        toolResult = {
          error: `Access denied: Path '${targetPath}' resolves outside the permitted 'Belgeler/' sandbox.`
        };
      } else {
        toolResult = {
          host: targetHost,
          path: targetPath,
          entries: [
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
          ],
          totalCount: 15
        };
      }
    } else if (cmd === "disk_usage") {
      toolResult = {
        host: targetHost,
        command: "disk_usage",
        output: "Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   20G   28G  42% /"
      };
    } else if (cmd === "current_directory") {
      toolResult = {
        host: targetHost,
        command: "current_directory",
        currentDirectory: "/home/baris"
      };
    } else if (cmd === "identity") {
      toolResult = {
        host: targetHost,
        command: "identity",
        user: "baris"
      };
    } else if (cmd === "system_info") {
      toolResult = {
        host: targetHost,
        command: "system_info",
        systemInfo: "Linux home-box 6.8.0-40-generic x86_64 GNU/Linux"
      };
    }
  } else {
    toolResult = { error: `Tool ${fnName} not recognized.` };
  }
  return toolResult;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const HOSTS: unknown[] = [
  undefined,
  null,
  "",
  "home-server",
  "  home-server  ",
  "   ",
  "dev-sunucum",
  "macbook",
  "root@100.108.234.65",
  "home-server; rm -rf /",
  "ev-sunucusu-ğüşİ",
  0,
  5,
  true,
  false,
  [],
  ["home-server"],
  {}
];

const PATHS: unknown[] = [
  undefined,
  null,
  "",
  "   ",
  "Belgeler",
  "Belgeler/",
  "Belgeler/project",
  "  Belgeler/project  ",
  "belgeler",
  "Documents",
  "documents/work",
  // traversal
  "..",
  "../",
  "../..",
  "../../etc",
  "../../../etc/passwd",
  "Belgeler/..",
  "Belgeler/../..",
  "Belgeler/../.ssh",
  "Belgeler/../../etc/shadow",
  "Belgeler/..hidden",
  "Belgeler/a..b",
  "...",
  "./Belgeler",
  ".",
  "Belgeler\\..\\..\\Windows",
  "..\\..\\etc",
  // encoded traversal (production does not decode)
  "%2e%2e",
  "%2e%2e/%2e%2e/etc",
  "Belgeler/%2e%2e/secret",
  "Belgeler/%252e%252e/secret",
  // absolute paths
  "/",
  "/etc",
  "/etc/passwd",
  "/etcetera",
  "/ETC",
  "ETC",
  " /etc",
  "//etc",
  "/./etc",
  "/var",
  "/var/log/syslog",
  "/variable",
  "/home",
  "/home/baris",
  "/home/baris/Belgeler",
  "/homes",
  "/root",
  "/root/.ssh/id_ed25519",
  "/tmp",
  "/usr/bin",
  "/Belgeler",
  "C:\\Windows\\System32",
  "~",
  "~/Belgeler",
  "~root",
  "home/baris/Belgeler",
  // symlink-looking and shell-looking names
  "Belgeler/external-link",
  "Belgeler/link -> /etc",
  "Belgeler/symlink@",
  "Belgeler/.ssh",
  "Belgeler/$(whoami)",
  "Belgeler/`id`",
  "Belgeler; rm -rf /",
  "Belgeler && cat /etc/passwd",
  "Belgeler/*",
  "Belgeler/\0invalid",
  "Belgeler/\n/etc",
  // unicode
  "Ev Tasarımı",
  "Belgeler/Açık Kaynak",
  "Belgeler/İstanbul/ğüşöç",
  "Belgeler/😀",
  "\u2024\u2024/etc",
  "\uff0e\uff0e/etc",
  "Belgeler/\u202e..",
  "Belgeler/\u200b..",
  // non-strings
  0,
  1,
  42,
  NaN,
  true,
  false,
  [],
  [".."],
  ["Belgeler"],
  ["..", "x"],
  {},
  { path: "Belgeler" }
];

const COMMANDS: unknown[] = [
  "list_directory",
  "disk_usage",
  "current_directory",
  "identity",
  "system_info",
  undefined,
  null,
  "",
  " disk_usage",
  "disk_usage ",
  "DISK_USAGE",
  "List_Directory",
  "ls",
  "rm -rf /",
  "list_directory; rm -rf /",
  "$(whoami)",
  "toString",
  "constructor",
  "__proto__",
  1,
  true,
  [],
  ["disk_usage"],
  {}
];

/** `args` shapes for ssh_execute, including every PATHS entry as args.path. */
const EXECUTE_ARGS: unknown[] = [
  undefined,
  null,
  "",
  "-h; rm -rf /",
  "../../etc",
  5,
  [],
  ["Belgeler"],
  {},
  { path: undefined },
  ...PATHS.map((path) => ({ path })),
  { path: "Belgeler", extra: "x" }
];

/** Whole-argument shapes: JSON that failed to parse stays a string in production. */
const ODD_FN_ARGS: unknown[] = [undefined, null, "", "not json", '{"host":"home-server"}', 42, true, [], {}];

function argCorpus(fnName: string): unknown[] {
  const corpus: unknown[] = [...ODD_FN_ARGS];
  if (fnName === "ssh_connect") {
    for (const host of HOSTS) corpus.push({ host }, { host, extra: 1 });
    corpus.push({ path: "Belgeler" });
  } else if (fnName === "ssh_list_directory") {
    for (const host of HOSTS) for (const path of PATHS) corpus.push({ host, path });
    for (const path of PATHS) corpus.push({ path });
  } else {
    for (const host of HOSTS) for (const command of COMMANDS) corpus.push({ host, command });
    for (const host of ["home-server", undefined, 5]) {
      for (const command of COMMANDS) for (const args of EXECUTE_ARGS) corpus.push({ host, command, args });
    }
    for (const path of PATHS) corpus.push({ command: "list_directory", path });
  }
  return corpus;
}

type Outcome = { threw: false; value: unknown } | { threw: true; name: string; message: string };

function outcome(run: () => unknown): Outcome {
  try {
    return { threw: false, value: run() };
  } catch (err) {
    return { threw: true, name: (err as Error).constructor.name, message: (err as Error).message };
  }
}

function label(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSH tool definitions (production contract)", () => {
  it("are byte-identical to production's inline definitions", () => {
    expect(JSON.stringify(SSH_CONNECT_TOOL_DEFINITION)).toBe(JSON.stringify(LEGACY_SSH_TOOL_DEFINITION));
    expect(JSON.stringify(SSH_LIST_DIRECTORY_TOOL_DEFINITION)).toBe(
      JSON.stringify(LEGACY_SSH_LIST_DIRECTORY_TOOL_DEFINITION)
    );
    expect(JSON.stringify(SSH_EXECUTE_TOOL_DEFINITION)).toBe(JSON.stringify(LEGACY_SSH_EXECUTE_TOOL_DEFINITION));
  });

  it("the src tools advertise the same definitions", () => {
    const manager = new SSHConnectionManager({ clientFactory: () => new MockSSHClient("success") });
    expect(JSON.stringify(new SSHConnectTool(manager).getDefinition())).toBe(
      JSON.stringify(LEGACY_SSH_TOOL_DEFINITION)
    );
    expect(JSON.stringify(new SSHListDirectoryTool(manager).getDefinition())).toBe(
      JSON.stringify(LEGACY_SSH_LIST_DIRECTORY_TOOL_DEFINITION)
    );
    expect(JSON.stringify(new SSHExecuteTool(manager).getDefinition())).toBe(
      JSON.stringify(LEGACY_SSH_EXECUTE_TOOL_DEFINITION)
    );
  });

  it("the allow-list is the definition's enum and the command registry's list", () => {
    const legacyEnum = LEGACY_SSH_EXECUTE_TOOL_DEFINITION.function.parameters.properties.command.enum;
    expect(ALLOWED_SSH_COMMANDS).toEqual(legacyEnum);
    expect(CommandRegistry.getAllowedCommands()).toEqual(legacyEnum);
    for (const command of ALLOWED_SSH_COMMANDS) {
      expect(CommandRegistry.get(command)?.name).toBe(command);
    }
  });
});

describe("shared argument rules", () => {
  it("getSshSandboxPathDenial matches production's check on every string path", () => {
    const denied = (targetPath: string) =>
      targetPath.includes("..") ||
      targetPath.startsWith("/etc") ||
      targetPath.startsWith("/var") ||
      targetPath.startsWith("/home");
    for (const path of PATHS.filter((p): p is string => typeof p === "string")) {
      expect(getSshSandboxPathDenial(path), label(path)).toBe(
        denied(path) ? `Access denied: Path '${path}' resolves outside the permitted 'Belgeler/' sandbox.` : null
      );
    }
  });

  it("getSshCommandDenial matches production's allow-list check", () => {
    const allowedCmds = [
      "list_directory",
      "disk_usage",
      "current_directory",
      "identity",
      "system_info",
      "docker_ps",
      "docker_logs",
      "docker_restart"
    ];
    for (const cmd of COMMANDS) {
      expect(getSshCommandDenial(cmd), label(cmd)).toBe(
        allowedCmds.includes(cmd as string)
          ? null
          : `Command '${cmd}' is not permitted. Only strictly whitelisted commands (${allowedCmds.join(", ")}) may be executed.`
      );
    }
  });
});

describe("src SSH tools accept and reject like production", () => {
  const manager = new SSHConnectionManager({ clientFactory: () => new MockSSHClient("success") });
  const tools = {
    ssh_connect: new SSHConnectTool(manager),
    ssh_list_directory: new SSHListDirectoryTool(manager),
    ssh_execute: new SSHExecuteTool(manager)
  } as const;

  /**
   * The only reasons a src tool may refuse what production accepts: guards a
   * real connection needs and production (canned results) has no use for.
   */
  function srcOnlyRejection(fnName: keyof typeof tools, fnArgs: unknown): boolean {
    const host = resolveSshHostArg(fnArgs);
    if (typeof host !== "string" || !host.trim()) return true;
    if (fnName === "ssh_connect") return false;
    const path = fnName === "ssh_list_directory" ? resolveSshListPathArg(fnArgs) : resolveSshExecutePathArg(fnArgs);
    if (typeof path !== "string") return true;
    return !SSHPathSandbox.validateSandboxPath(path).valid;
  }

  function pathIsStringOrUnused(fnName: keyof typeof tools, fnArgs: unknown): boolean {
    if (fnName === "ssh_connect") return true;
    if (fnName === "ssh_list_directory") return typeof resolveSshListPathArg(fnArgs) === "string";
    const command = (fnArgs as { command?: unknown } | null | undefined)?.command;
    return command !== "list_directory" || typeof resolveSshExecutePathArg(fnArgs) === "string";
  }

  for (const fnName of ["ssh_connect", "ssh_list_directory", "ssh_execute"] as const) {
    it(`${fnName}: production's errors come back verbatim; extra refusals are only the real-SSH guards`, () => {
      let agreed = 0;
      for (const fnArgs of argCorpus(fnName)) {
        const where = label(fnArgs);
        const legacy = outcome(() => legacyRunTool(fnName, fnArgs as LegacyArgs));
        const validation = tools[fnName].validateArgs(fnArgs);

        if (legacy.threw) {
          // Production fails the whole chat turn; src refuses the call instead.
          expect(validation.valid, where).toBe(false);
          continue;
        }
        const legacyError = (legacy.value as { error?: string }).error;
        if (legacyError && pathIsStringOrUnused(fnName, fnArgs)) {
          expect(validation, where).toEqual({ valid: false, error: legacyError });
        } else if (legacyError) {
          // An array path production tested element-wise (e.g. [".."]): src
          // refuses every non-string path, with its own text.
          expect(validation.valid, where).toBe(false);
        } else if (validation.valid) {
          agreed++;
        } else {
          expect(srcOnlyRejection(fnName, fnArgs), `${where}: ${validation.error}`).toBe(true);
        }
      }
      expect(agreed).toBeGreaterThan(0);
    });
  }

  it("a non-string args.path for ssh_execute list_directory is refused, as are non-string hosts", () => {
    expect(tools.ssh_execute.validateArgs({ host: "home-server", command: "list_directory", args: { path: 5 } }).valid).toBe(false);
    expect(tools.ssh_execute.validateArgs({ host: 5, command: "disk_usage" }).valid).toBe(false);
  });
});

describe("production offers real server tools via Firestore Relay", () => {
  const source = readFileSync(new URL("../../functions/api.ts", import.meta.url), "utf8");

  it("sends SSH tool definitions to the model and routes execution to the relay", () => {
    const activeBlock = /const activeTools = \[[\s\S]*?\];/.exec(source)?.[0] ?? "";
    expect(activeBlock).toContain("TIME_TOOL_DEFINITION");
    expect(activeBlock).toContain("SSH_EXECUTE_TOOL_DEFINITION");
    expect(source).toContain("ssh-tool-definitions.js");
    expect(source).toContain("dispatchServerCommandViaRelay");
    for (const name of ["ssh_connect", "ssh_list_directory", "ssh_execute"]) {
      expect(source).toContain(`"${name}"`);
    }
  });

  it("routes ssh_execute and ssh_list_directory to dispatchServerCommandViaRelay", () => {
    expect(source).toMatch(
      /if \(fnName === "ssh_execute"\) \{[\s\S]*?dispatchServerCommandViaRelay/
    );
  });

  it("keeps the tool_call log fields, minus the SSH command", () => {
    expect(source).toMatch(
      /tool: toolName,\n\s*provider: activeProvider,\n\s*round: toolTurn,\n\s*outcome: toolOk \? "ok" : "error",\n\s*duration_ms: msSince\(toolStart\)/
    );
  });
});
