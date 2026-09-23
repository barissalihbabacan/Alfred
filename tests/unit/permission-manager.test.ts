import { describe, it, expect } from "vitest";
import { PermissionManager } from "../../src/alfred/control-plane/permission-system/permission-manager.js";
import { PermissionLevel, type PermissionContext } from "../../src/alfred/control-plane/permission-system/types.js";

type Role = NonNullable<PermissionContext["userRole"]> | undefined;

// Expected policy: which roles may run each level (confirmed where needed).
const POLICY: Record<PermissionLevel, Role[]> = {
  [PermissionLevel.READ_ONLY]: ["owner", "admin", "guest", undefined],
  [PermissionLevel.SAFE_READ]: ["owner", "admin"],
  [PermissionLevel.WRITE]: ["owner", "admin"],
  [PermissionLevel.EXECUTE]: ["owner"],
  [PermissionLevel.DESTRUCTIVE]: ["owner"]
};
const ROLES: Role[] = ["owner", "admin", "guest", undefined];

describe("PermissionManager role policy", () => {
  for (const level of Object.values(PermissionLevel)) {
    for (const role of ROLES) {
      const allowed = POLICY[level].includes(role);
      it(`${allowed ? "grants" : "denies"} ${level} to ${role ?? "a user without a role"}`, () => {
        const result = PermissionManager.checkPermission(level, { userId: "baris", userRole: role, confirmed: true });
        expect(result.granted).toBe(allowed);
        if (!allowed) expect(result.reason).toMatch(/Forbidden: role '(admin|guest)'/);
      });
    }
  }

  it("treats a missing role as guest", () => {
    const result = PermissionManager.checkPermission(PermissionLevel.SAFE_READ, { userId: "baris" });
    expect(result).toMatchObject({ granted: false });
    expect(result.reason).toContain("role 'guest'");
  });

  it("allows READ_ONLY without any user context", () => {
    expect(PermissionManager.checkPermission(PermissionLevel.READ_ONLY)).toEqual({ granted: true });
  });

  it("requires a user context above READ_ONLY", () => {
    for (const level of [PermissionLevel.SAFE_READ, PermissionLevel.WRITE, PermissionLevel.EXECUTE, PermissionLevel.DESTRUCTIVE]) {
      const result = PermissionManager.checkPermission(level, undefined);
      expect(result.granted).toBe(false);
      expect(result.reason).toContain("Active user context is required");
      expect(PermissionManager.checkPermission(level, { userId: "", userRole: "owner" }).granted).toBe(false);
    }
  });

  it("still requires confirmation for DESTRUCTIVE, even for the owner", () => {
    const result = PermissionManager.checkPermission(PermissionLevel.DESTRUCTIVE, { userId: "baris", userRole: "owner" });
    expect(result).toMatchObject({ granted: false, requiresConfirmation: true });
    expect(
      PermissionManager.checkPermission(PermissionLevel.DESTRUCTIVE, { userId: "baris", userRole: "owner", confirmed: true })
    ).toEqual({ granted: true });
  });

  it("does not ask a non-owner to confirm a DESTRUCTIVE action (role check comes first)", () => {
    const result = PermissionManager.checkPermission(PermissionLevel.DESTRUCTIVE, { userId: "x", userRole: "admin" });
    expect(result.granted).toBe(false);
    expect(result.requiresConfirmation).toBeUndefined();
  });

  it("rejects unknown levels", () => {
    const result = PermissionManager.checkPermission("SUPERUSER" as PermissionLevel, { userId: "baris", userRole: "owner" });
    expect(result).toEqual({ granted: false, reason: "Unrecognized permission level." });
  });
});
