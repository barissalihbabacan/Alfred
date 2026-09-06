/**
 * B.U.T.L.E.R. Alfred — Permission Manager
 * Enforces execution policies, confirmation requirements, and role checks before tool execution.
 */

import { PermissionLevel, PermissionContext, PermissionCheckResult } from "./types.js";

export class PermissionManager {
  /**
   * Checks whether the current context is authorized to execute a tool with the given permission level.
   */
  public static checkPermission(
    level: PermissionLevel,
    context?: PermissionContext
  ): PermissionCheckResult {
    // Level 0: READ_ONLY tools (such as get_current_time) are universally safe
    if (level === PermissionLevel.READ_ONLY) {
      return { granted: true };
    }

    if (!context || !context.userId) {
      return {
        granted: false,
        reason: "Unauthorized: Active user context is required for operations above READ_ONLY."
      };
    }

    // Level 1: SAFE_READ requires authenticated user
    if (level === PermissionLevel.SAFE_READ) {
      return { granted: true };
    }

    // Level 2 & 3: WRITE and EXECUTE operations
    if (level === PermissionLevel.WRITE || level === PermissionLevel.EXECUTE) {
      return { granted: true };
    }

    // Level 4: DESTRUCTIVE operations strictly require explicit confirmation
    if (level === PermissionLevel.DESTRUCTIVE) {
      if (!context.confirmed) {
        return {
          granted: false,
          requiresConfirmation: true,
          reason: "Confirmation required: Destructive action cannot proceed without explicit authorization."
        };
      }
      return { granted: true };
    }

    return { granted: false, reason: "Unrecognized permission level." };
  }
}
