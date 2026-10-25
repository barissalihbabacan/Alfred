/**
 * B.U.T.L.E.R. Alfred — SSH Command Registry
 * Defines whitelisted, strongly-typed remote commands, argument validators,
 * trusted command templates, and structured output parsers.
 * Rejects arbitrary shell execution and unwhitelisted commands before SSH dispatch.
 */

import { SSHPathSandbox, SANDBOX_ROOT_NAME } from "./ssh-path-sandbox.js";
import { LSParser } from "./ls-parser.js";
import { SSHListDirectoryResult } from "./ssh-client.interface.js";

import { ALLOWED_SSH_COMMANDS, AllowedSSHCommand } from "./allowed-commands.js";

export { ALLOWED_SSH_COMMANDS };
export type { AllowedSSHCommand };

/**
 * Safely escapes a string for POSIX shell argument literal inclusion.
 * Wraps in single quotes and escapes any embedded single quotes.
 */
export function escapeShellArg(arg: string): string {
  if (typeof arg !== "string") {
    throw new Error("Shell argument must be a string.");
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export type CommandValidationResult<T = unknown> =
  | { valid: true; parsedArgs: T; error?: undefined }
  | { valid: false; error?: string; parsedArgs?: undefined };

/** Structured output of each whitelisted command, keyed by command name. */
export interface SSHCommandResultMap {
  list_directory: SSHListDirectoryResult;
  disk_usage: { host: string; command: "disk_usage"; output: string };
  current_directory: { host: string; command: "current_directory"; currentDirectory: string };
  identity: { host: string; command: "identity"; user: string };
  system_info: { host: string; command: "system_info"; systemInfo: string };
  docker_ps: { host: string; command: "docker_ps"; output: string };
  docker_logs: { host: string; command: "docker_logs"; container: string; logs: string };
  docker_restart: { host: string; command: "docker_restart"; container: string; output: string };
}

/** Structured output of any whitelisted command. */
export type SSHCommandResult = SSHCommandResultMap[AllowedSSHCommand];

/**
 * A whitelisted command. `buildCommand` / `parseOutput` use method syntax on
 * purpose: definitions with specific `TArgs` are stored side by side in one
 * registry, and each is only ever called with the `parsedArgs` its own
 * `validateArgs` produced.
 */
export interface CommandDefinition<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = SSHCommandResult
> {
  name: AllowedSSHCommand;
  description: string;
  buildCommand(args: TArgs): string;
  validateArgs(rawArgs: unknown): CommandValidationResult<TArgs>;
  parseOutput(
    stdout: string,
    stderr: string,
    exitCode: number,
    args: TArgs,
    host: string
  ): TResult;
}

export class CommandRegistry {
  private static commands = new Map<AllowedSSHCommand, CommandDefinition>();

  static {
    // 1. list_directory
    CommandRegistry.register<{ path: string }>({
      name: "list_directory",
      description: "Safely lists directory entries within the 'Belgeler/' sandbox.",
      validateArgs: (rawArgs: unknown) => {
        let pathCandidate = "Belgeler";
        if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
          const cast = rawArgs as Record<string, unknown>;
          if (typeof cast.path === "string" && cast.path.trim().length > 0) {
            pathCandidate = cast.path.trim();
          }
        }

        const pathValidation = SSHPathSandbox.validateSandboxPath(pathCandidate);
        if (!pathValidation.valid || !pathValidation.normalizedSandboxPath) {
          return {
            valid: false,
            error: pathValidation.error || "Sandbox path validation failed."
          };
        }

        return {
          valid: true,
          parsedArgs: { path: pathValidation.normalizedSandboxPath }
        };
      },
      buildCommand: (args: { path: string }) => {
        const escapedPath = escapeShellArg(args.path);
        const escapedRoot = escapeShellArg(SANDBOX_ROOT_NAME);
        return [
          `ROOT=$(realpath -e -q -- ${escapedRoot}) || exit 10`,
          `TARGET=$(realpath -e -q -- ${escapedPath}) || exit 11`,
          `case "$TARGET" in`,
          `  "$ROOT"/*|"$ROOT") ;;`,
          `  *) exit 13 ;;`,
          `esac`,
          `[ -d "$TARGET" ] || exit 12`,
          `printf "%s\\n%s\\n---DIVIDER---\\n" "$ROOT" "$TARGET"`,
          `LC_ALL=C ls -la --full-time -- "$TARGET"`
        ].join("\n");
      },
      parseOutput: (stdout, stderr, exitCode, args, host): SSHListDirectoryResult => {
        if (exitCode === 10) {
          throw new Error(
            `Sandbox root '${SANDBOX_ROOT_NAME}' does not exist or is inaccessible on remote host.`
          );
        }
        if (exitCode === 11) {
          throw new Error(`Remote path '${args.path}' does not exist or is inaccessible.`);
        }
        if (exitCode === 12) {
          throw new Error(`Path '${args.path}' is a file, not a directory.`);
        }
        if (exitCode === 13) {
          throw new Error(
            `Access denied: Path '${args.path}' resolves outside the permitted '${SANDBOX_ROOT_NAME}/' sandbox.`
          );
        }
        if (exitCode !== 0) {
          const errMsg = stderr.trim() || stdout.trim() || `Exit code ${exitCode}`;
          throw new Error(`Failed to list directory '${args.path}': ${errMsg}`);
        }

        const dividerIndex = stdout.indexOf("---DIVIDER---");
        if (dividerIndex === -1) {
          throw new Error("Malformed remote directory listing output: Missing metadata header.");
        }

        const header = stdout.slice(0, dividerIndex).trim().split(/\r?\n/);
        const realRoot = header[0];
        const realTarget = header[1];

        // Defense-in-depth: Verify realpath containment programmatically
        if (!SSHPathSandbox.isRealpathContained(realTarget, realRoot)) {
          throw new Error(
            `Access denied: Path '${args.path}' resolves outside the permitted '${SANDBOX_ROOT_NAME}/' sandbox.`
          );
        }

        const lsOutput = stdout.slice(dividerIndex + "---DIVIDER---".length);
        const entries = LSParser.parse(lsOutput);

        return {
          host,
          path: args.path,
          entries,
          totalCount: entries.length
        };
      }
    });

    // 2. disk_usage
    CommandRegistry.register({
      name: "disk_usage",
      description: "Reports filesystem disk usage via `df -h`.",
      validateArgs: (rawArgs: unknown) => {
        if (rawArgs !== undefined && rawArgs !== null) {
          if (typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
            return {
              valid: false,
              error: "Arguments for 'disk_usage' must be an object (or empty)."
            };
          }
        }
        return { valid: true, parsedArgs: {} };
      },
      buildCommand: () => "LC_ALL=C df -h",
      parseOutput: (stdout, stderr, exitCode, _args, host) => {
        if (exitCode !== 0) {
          throw new Error(`Command 'disk_usage' failed: ${stderr.trim() || stdout.trim()}`);
        }
        return {
          host,
          command: "disk_usage",
          output: stdout.trim()
        };
      }
    });

    // 3. current_directory
    CommandRegistry.register({
      name: "current_directory",
      description: "Reports remote working directory via `pwd`.",
      validateArgs: (rawArgs: unknown) => {
        if (rawArgs !== undefined && rawArgs !== null) {
          if (typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
            return {
              valid: false,
              error: "Arguments for 'current_directory' must be an object (or empty)."
            };
          }
        }
        return { valid: true, parsedArgs: {} };
      },
      buildCommand: () => "pwd",
      parseOutput: (stdout, stderr, exitCode, _args, host) => {
        if (exitCode !== 0) {
          throw new Error(`Command 'current_directory' failed: ${stderr.trim() || stdout.trim()}`);
        }
        return {
          host,
          command: "current_directory",
          currentDirectory: stdout.trim()
        };
      }
    });

    // 4. identity
    CommandRegistry.register({
      name: "identity",
      description: "Reports remote user identity via `whoami`.",
      validateArgs: (rawArgs: unknown) => {
        if (rawArgs !== undefined && rawArgs !== null) {
          if (typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
            return {
              valid: false,
              error: "Arguments for 'identity' must be an object (or empty)."
            };
          }
        }
        return { valid: true, parsedArgs: {} };
      },
      buildCommand: () => "whoami",
      parseOutput: (stdout, stderr, exitCode, _args, host) => {
        if (exitCode !== 0) {
          throw new Error(`Command 'identity' failed: ${stderr.trim() || stdout.trim()}`);
        }
        return {
          host,
          command: "identity",
          user: stdout.trim()
        };
      }
    });

    // 5. system_info
    CommandRegistry.register({
      name: "system_info",
      description: "Reports remote system architecture and kernel info via `uname -a`.",
      validateArgs: (rawArgs: unknown) => {
        if (rawArgs !== undefined && rawArgs !== null) {
          if (typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
            return {
              valid: false,
              error: "Arguments for 'system_info' must be an object (or empty)."
            };
          }
        }
        return { valid: true, parsedArgs: {} };
      },
      buildCommand: () => "uname -a",
      parseOutput: (stdout, stderr, exitCode, _args, host) => {
        if (exitCode !== 0) {
          throw new Error(`Command 'system_info' failed: ${stderr.trim() || stdout.trim()}`);
        }
        return {
          host,
          command: "system_info",
          systemInfo: stdout.trim()
        };
      }
    });

    const SAFE_CONTAINER_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,63}$/;

    // 6. docker_ps
    CommandRegistry.register<{ all?: boolean }>({
      name: "docker_ps",
      description: "Reports Docker containers status via `docker ps`.",
      validateArgs: (rawArgs: unknown) => {
        let all = false;
        if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
          const cast = rawArgs as Record<string, unknown>;
          if (typeof cast.all === "boolean") {
            all = cast.all;
          }
        }
        return { valid: true, parsedArgs: { all } };
      },
      buildCommand: (args: { all?: boolean }) => {
        return args?.all
          ? "LC_ALL=C docker ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'"
          : "LC_ALL=C docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'";
      },
      parseOutput: (stdout, stderr, exitCode, _args, host) => {
        if (exitCode !== 0) {
          throw new Error(`Command 'docker_ps' failed: ${stderr.trim() || stdout.trim()}`);
        }
        return {
          host,
          command: "docker_ps",
          output: stdout.trim()
        };
      }
    });

    // 7. docker_logs
    CommandRegistry.register<{ container: string; lines: number }>({
      name: "docker_logs",
      description: "Retrieves recent stdout/stderr logs of a Docker container.",
      validateArgs: (rawArgs: unknown) => {
        if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
          return {
            valid: false,
            error: "Arguments for 'docker_logs' must be an object with a 'container' name."
          };
        }
        const cast = rawArgs as Record<string, unknown>;
        const container = typeof cast.container === "string" ? cast.container.trim() : "";
        if (!container || !SAFE_CONTAINER_REGEX.test(container)) {
          return {
            valid: false,
            error: `Invalid container name '${container}'. Must be 2-64 alphanumeric characters, dots, underscores or dashes.`
          };
        }
        let lines = 50;
        if (typeof cast.lines === "number" && Number.isInteger(cast.lines) && cast.lines > 0) {
          lines = Math.min(cast.lines, 500);
        }
        return { valid: true, parsedArgs: { container, lines } };
      },
      buildCommand: (args: { container: string; lines: number }) => {
        return `LC_ALL=C docker logs --tail ${args.lines} ${escapeShellArg(args.container)}`;
      },
      parseOutput: (stdout, stderr, exitCode, args, host) => {
        if (exitCode !== 0) {
          throw new Error(`Command 'docker_logs' failed: ${stderr.trim() || stdout.trim()}`);
        }
        const fullLogs = (stdout + (stderr ? "\n" + stderr : "")).trim();
        return {
          host,
          command: "docker_logs",
          container: args.container,
          logs: fullLogs
        };
      }
    });

    // 8. docker_restart
    CommandRegistry.register<{ container: string }>({
      name: "docker_restart",
      description: "Restarts a specified Docker container safely.",
      validateArgs: (rawArgs: unknown) => {
        if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
          return {
            valid: false,
            error: "Arguments for 'docker_restart' must be an object with a 'container' name."
          };
        }
        const cast = rawArgs as Record<string, unknown>;
        const container = typeof cast.container === "string" ? cast.container.trim() : "";
        if (!container || !SAFE_CONTAINER_REGEX.test(container)) {
          return {
            valid: false,
            error: `Invalid container name '${container}'. Must be 2-64 alphanumeric characters, dots, underscores or dashes.`
          };
        }
        return { valid: true, parsedArgs: { container } };
      },
      buildCommand: (args: { container: string }) => {
        return `LC_ALL=C docker restart ${escapeShellArg(args.container)}`;
      },
      parseOutput: (stdout, stderr, exitCode, args, host) => {
        if (exitCode !== 0) {
          throw new Error(`Command 'docker_restart' failed: ${stderr.trim() || stdout.trim()}`);
        }
        return {
          host,
          command: "docker_restart",
          container: args.container,
          output: stdout.trim()
        };
      }
    });
  }

  public static register<TArgs extends Record<string, unknown>>(def: CommandDefinition<TArgs>): void {
    this.commands.set(def.name, def);
  }

  public static get(name: string): CommandDefinition | undefined {
    return this.commands.get(name as AllowedSSHCommand);
  }

  public static isAllowedCommand(name: string): name is AllowedSSHCommand {
    return ALLOWED_SSH_COMMANDS.includes(name as AllowedSSHCommand);
  }

  public static getAllowedCommands(): readonly AllowedSSHCommand[] {
    return ALLOWED_SSH_COMMANDS;
  }
}
