import { describe, it, expect } from "vitest";
import { ALLOWED_UID, getAuthErrorDetails } from "../../apps/web/lib/auth.js";
import { POST } from "../../apps/web/app/api/chat/route.js";
import { NextRequest } from "next/server";

describe("Single-User Authorization (UID Whitelist)", () => {
  it("defines the exact authorized UID constant", () => {
    expect(ALLOWED_UID).toBe("test-owner-uid-123456");
  });

  it("provides Turkish user-facing error message for unauthorized UIDs", () => {
    const errorDetails = getAuthErrorDetails({ code: "auth/unauthorized-uid" });
    expect(errorDetails.title).toBe("Yetkisiz Kullanıcı (Erişim Reddedildi)");
    expect(errorDetails.message).toContain("yalnızca yetkili yönetici erişebilir");
  });

  it("rejects unauthorized UID with 403 in /api/chat when not in test bypass mode", async () => {
    const originalVitest = process.env.VITEST;
    const originalNodeEnv = process.env.NODE_ENV;

    try {
      delete process.env.VITEST;
      process.env.NODE_ENV = "production";

      const req = new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Hello Alfred",
          userId: "malicious_unauthorized_uid_123"
        })
      });

      const response = await POST(req);
      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Forbidden: Unauthorized UID.");
    } finally {
      process.env.VITEST = originalVitest;
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("accepts the authorized UID in /api/chat", async () => {
    const originalVitest = process.env.VITEST;
    const originalNodeEnv = process.env.NODE_ENV;

    try {
      delete process.env.VITEST;
      process.env.NODE_ENV = "production";

      const req = new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Hello Alfred",
          userId: ALLOWED_UID
        })
      });

      const response = await POST(req);
      // Status should not be 403 Forbidden
      expect(response.status).not.toBe(403);
    } finally {
      process.env.VITEST = originalVitest;
      process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
