/**
 * B.U.T.L.E.R. Alfred — the ssh_execute command allow-list.
 *
 * Shared with functions/index.js (bundled via esbuild) through
 * src/ai/tools/ssh/ssh-tool-definitions.ts: it is the `enum` the model sees
 * and the list production checks commands against. Keep it pure (no imports).
 */

export type AllowedSSHCommand =
  | "list_directory"
  | "disk_usage"
  | "current_directory"
  | "identity"
  | "system_info";

export const ALLOWED_SSH_COMMANDS: readonly AllowedSSHCommand[] = [
  "list_directory",
  "disk_usage",
  "current_directory",
  "identity",
  "system_info"
] as const;
