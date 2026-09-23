/**
 * B.U.T.L.E.R. Alfred — Permission Manager
 * Enforces execution policies, confirmation requirements, and role checks before tool execution.
 *
 * Policy (least privilege; a missing role counts as "guest"):
 *   READ_ONLY          anyone, even without a user context
 *   SAFE_READ, WRITE   authenticated owner or admin
 *   EXECUTE            authenticated owner only
 *   DESTRUCTIVE        authenticated owner only, and only with explicit confirmation
 */

import { PermissionLevel, PermissionContext, PermissionCheckResult } from "./types.js";

type Role = NonNullable<PermissionContext["userRole"]>;

const ALLOWED_ROLES: Record<Exclude<PermissionLevel, PermissionLevel.READ_ONLY>, readonly Role[]> = {
  [PermissionLevel.SAFE_READ]: ["owner", "admin"],
  [PermissionLevel.WRITE]: ["owner", "admin"],
  [PermissionLevel.EXECUTE]: ["owner"],
  [PermissionLevel.DESTRUCTIVE]: ["owner"]
};

export class PermissionManager {
  /**
   * Checks whether the current context is authorized to execute a tool with the given permission level.
   */
  public static checkPermission(
    level: PermissionLevel,
    context?: PermissionContext
  ): PermissionCheckResult {
    // READ_ONLY tools (such as get_current_time) are universally safe
    if (level === PermissionLevel.READ_ONLY) {
      return { granted: true };
    }

    if (!Object.prototype.hasOwnProperty.call(ALLOWED_ROLES, level)) {
      return { granted: false, reason: "Unrecognized permission level." };
    }

    if (!context || !context.userId) {
      return {
        granted: false,
        reason: "Unauthorized: Active user context is required for operations above READ_ONLY."
      };
    }

    const role: Role = context.userRole ?? "guest";
    const allowed = ALLOWED_ROLES[level as keyof typeof ALLOWED_ROLES];
    if (!allowed.includes(role)) {
      return {
        granted: false,
        reason: `Forbidden: role '${role}' may not perform ${level} operations (requires ${allowed.join(" or ")}).`
      };
    }

    // DESTRUCTIVE operations strictly require explicit confirmation
    if (level === PermissionLevel.DESTRUCTIVE && !context.confirmed) {
      return {
        granted: false,
        requiresConfirmation: true,
        reason: "Confirmation required: Destructive action cannot proceed without explicit authorization."
      };
    }

    return { granted: true };
  }
}
