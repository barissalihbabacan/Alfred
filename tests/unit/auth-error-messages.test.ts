import { describe, it, expect } from "vitest";
import { getAuthErrorDetails, getFriendlyAuthErrorMessage } from "../../apps/web/lib/auth.js";

describe("Firebase Auth User-Friendly Error Messages", () => {
  it("translates auth/popup-closed-by-user gracefully", () => {
    const err = { code: "auth/popup-closed-by-user", message: "Firebase: Error (auth/popup-closed-by-user)." };
    const details = getAuthErrorDetails(err);

    expect(details.title).toBe("Giriş Penceresi Kapatıldı");
    expect(details.message).toContain("Google kimlik doğrulama penceresi");
    expect(getFriendlyAuthErrorMessage(err)).toBe(
      "Giriş Penceresi Kapatıldı: Google kimlik doğrulama penceresi işlem tamamlanmadan kapatıldı. Lütfen tekrar deneyin."
    );
  });

  it("translates auth/popup-blocked with clear guidance", () => {
    const err = { code: "auth/popup-blocked" };
    const details = getAuthErrorDetails(err);

    expect(details.title).toBe("Açılır Pencere Engellendi");
    expect(details.message).toContain("açılır pencerelere (pop-up) izin verip");
  });

  it("translates auth/unauthorized-domain with domain instructions", () => {
    const err = { code: "auth/unauthorized-domain" };
    const details = getAuthErrorDetails(err);

    expect(details.title).toBe("Yetkisiz Alan Adı");
    expect(details.message).toContain("Authorized Domains");
  });

  it("translates auth/network-request-failed with connection hint", () => {
    const err = { code: "auth/network-request-failed" };
    const details = getAuthErrorDetails(err);

    expect(details.title).toBe("Bağlantı Hatası");
    expect(details.message).toContain("İnternet bağlantısı");
  });

  it("translates auth/operation-not-allowed with clear console instructions", () => {
    const err = { code: "auth/operation-not-allowed" };
    const details = getAuthErrorDetails(err);

    expect(details.title).toBe("Google ile Giriş Henüz Etkin Değil");
    expect(details.message).toContain("Sign-in method");
  });

  it("falls back to friendly generic message for unknown errors", () => {
    const err = { code: "auth/unknown-custom-code", message: "Something broke" };
    const details = getAuthErrorDetails(err);

    expect(details.title).toBe("İşlem Başarısız Oldu");
    expect(details.message).toBe("Something broke");
  });
});
