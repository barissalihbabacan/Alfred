import { describe, it, expect, vi } from "vitest";
import { verifyUserAuthorization } from "../../src/core/permissions/authorization.js";
import { validateProductionFirebaseConfig } from "../../apps/web/lib/firebase.js";

describe("Backend Authorization & Production Config Validation", () => {
  describe("verifyUserAuthorization (src/core/permissions/authorization.ts)", () => {
    it("fails closed with 503 when neither UID nor Email is configured", () => {
      const onUnconfigured = vi.fn();
      const result = verifyUserAuthorization("any-uid", "any@example.com", true, "", "", onUnconfigured);
      expect(result.authorized).toBe(false);
      expect(result.status).toBe(503);
      expect(result.error).toContain("Service Unavailable: Authorization not configured on backend.");
      expect(onUnconfigured).toHaveBeenCalledTimes(1);
    });

    it("allows access when UID is empty and email matches with verified email (zero-touch onboarding)", () => {
      const result = verifyUserAuthorization(
        "new-user-uid-456",
        "owner@example.com",
        true,
        "",
        "owner@example.com"
      );
      expect(result.authorized).toBe(true);
      expect(result.status).toBeUndefined();
    });

    it("rejects with 403 when UID is empty and email matches but email is not verified", () => {
      const result = verifyUserAuthorization(
        "new-user-uid-456",
        "owner@example.com",
        false,
        "",
        "owner@example.com"
      );
      expect(result.authorized).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toContain("Forbidden: Unauthorized account.");
    });

    it("rejects with 403 when UID is empty and email does not match", () => {
      const result = verifyUserAuthorization(
        "new-user-uid-456",
        "intruder@example.com",
        true,
        "",
        "owner@example.com"
      );
      expect(result.authorized).toBe(false);
      expect(result.status).toBe(403);
      expect(result.error).toContain("Forbidden: Unauthorized account.");
    });

    it("allows access when both UID and verified Email match", () => {
      const result = verifyUserAuthorization(
        "uid-123",
        "owner@example.com",
        true,
        "uid-123",
        "owner@example.com"
      );
      expect(result.authorized).toBe(true);
    });

    it("rejects with 403 when both are configured but UID does not match", () => {
      const result = verifyUserAuthorization(
        "wrong-uid",
        "owner@example.com",
        true,
        "uid-123",
        "owner@example.com"
      );
      expect(result.authorized).toBe(false);
      expect(result.status).toBe(403);
    });

    it("rejects with 403 when both are configured but email does not match", () => {
      const result = verifyUserAuthorization(
        "uid-123",
        "wrong-email@example.com",
        true,
        "uid-123",
        "owner@example.com"
      );
      expect(result.authorized).toBe(false);
      expect(result.status).toBe(403);
    });

    it("allows access when only UID is configured and matches", () => {
      const result = verifyUserAuthorization(
        "uid-123",
        "any-email@example.com",
        false,
        "uid-123",
        ""
      );
      expect(result.authorized).toBe(true);
    });

    it("rejects with 403 when only UID is configured and does not match", () => {
      const result = verifyUserAuthorization(
        "wrong-uid",
        "any-email@example.com",
        false,
        "uid-123",
        ""
      );
      expect(result.authorized).toBe(false);
      expect(result.status).toBe(403);
    });
  });

  describe("validateProductionFirebaseConfig (apps/web/lib/firebase.ts)", () => {
    it("throws descriptive error when apiKey is missing", () => {
      expect(() =>
        validateProductionFirebaseConfig({
          apiKey: "",
          projectId: "test-proj",
          appId: "test-app-id"
        })
      ).toThrow("Missing mandatory Firebase configuration in production environment");
    });

    it("throws descriptive error when projectId is missing", () => {
      expect(() =>
        validateProductionFirebaseConfig({
          apiKey: "test-api-key",
          projectId: "",
          appId: "test-app-id"
        })
      ).toThrow("Missing mandatory Firebase configuration in production environment");
    });

    it("throws descriptive error when appId is missing", () => {
      expect(() =>
        validateProductionFirebaseConfig({
          apiKey: "test-api-key",
          projectId: "test-proj",
          appId: ""
        })
      ).toThrow("Missing mandatory Firebase configuration in production environment");
    });

    it("succeeds when all mandatory fields are provided", () => {
      expect(() =>
        validateProductionFirebaseConfig({
          apiKey: "test-api-key",
          projectId: "test-proj",
          appId: "test-app-id"
        })
      ).not.toThrow();
    });
  });
});
