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

  it("translates missing initial state / sessionStorage errors gracefully", () => {
    const err = { message: "Unable to process request due to missing initial state. This may happen if browser sessionStorage is inaccessible" };
    const details = getAuthErrorDetails(err);

    expect(details.title).toBe("Tarayıcı Oturum/Gizlilik Engeli");
    expect(details.message).toContain("çerez ve oturum");
  });

  it("translates auth/multi-factor-auth-required with MFA instructions", () => {
    const err = { code: "auth/multi-factor-auth-required" };
    const details = getAuthErrorDetails(err);

    expect(details.title).toBe("SMS 2 Adımlı Doğrulama (2FA) Gerekli");
    expect(details.message).toContain("SMS doğrulaması");
  });

  it("translates auth/captcha-check-failed with security check guidance", () => {
    const err = { code: "auth/captcha-check-failed" };
    const details = getAuthErrorDetails(err);

    expect(details.title).toBe("Güvenlik Denetimi Başarısız");
    expect(details.message).toContain("reCAPTCHA");
  });

  it("translates auth/invalid-verification-code with clear guidance", () => {
    const err = { code: "auth/invalid-verification-code" };
    const details = getAuthErrorDetails(err);

    expect(details.title).toBe("Geçersiz SMS Kodu");
    expect(details.message).toContain("6 haneli doğrulama kodu");
  });

  it("translates auth/internal-error-encountered with helpful retry guidance", () => {
    const err = { code: "auth/internal-error-encountered" };
    const details = getAuthErrorDetails(err);

    expect(details.title).toBe("SMS İletişim Hatası");
    expect(details.message).toContain("Tekrar SMS Gönder");
  });

  it("falls back to friendly generic message for unknown errors", () => {
    const err = { code: "auth/unknown-custom-code", message: "Something broke" };
    const details = getAuthErrorDetails(err);

    expect(details.title).toBe("İşlem Başarısız Oldu");
    expect(details.message).toBe("Something broke");
  });
});
