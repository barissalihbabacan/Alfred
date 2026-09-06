/**
 * B.U.T.L.E.R. Alfred — Permission System Types
 * Defines security tiers and permission contexts for tool execution.
 */

export enum PermissionLevel {
  /**
   * Safe, deterministic, read-only inspection (e.g. current time, timezone, system status).
   * Zero side effects, no state changes, no user confirmation needed.
   */
  READ_ONLY = "READ_ONLY",

  /**
   * Reading user private data (e.g. reading contacts, emails, calendar entries).
   * Requires authenticated session, no write side-effects.
   */
  SAFE_READ = "SAFE_READ",

  /**
   * Modifying or creating non-destructive resources (e.g. creating draft email, adding calendar event).
   */
  WRITE = "WRITE",

  /**
   * Executing external commands or integrations with elevated privileges.
   */
  EXECUTE = "EXECUTE",

  /**
   * Destructive operations (e.g. deleting database records, cancelling meetings, file deletion).
   * Strictly requires explicit user confirmation.
   */
  DESTRUCTIVE = "DESTRUCTIVE"
}

export interface PermissionContext {
  userId: string;
  userRole?: "owner" | "admin" | "guest";
  confirmed?: boolean;
}

export interface PermissionCheckResult {
  granted: boolean;
  reason?: string;
  requiresConfirmation?: boolean;
}
