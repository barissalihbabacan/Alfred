import { describe, it, expect } from "vitest";
import { PrivacyFilter } from "../../src/alfred/cognitive/memory/privacy-filter.js";

// The two filters that existed before they were unified: the inline list in
// functions/index.js (production) and the old src/ PrivacyFilter. The unified
// filter must reject everything either of them rejected.
const OLD_PRODUCTION = [
  /sk-[a-zA-Z0-9_-]{20,}/i,
  /ghp_[a-zA-Z0-9]{30,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /bearer\s+[a-zA-Z0-9_\-.]{20,}/i,
  /password\s*[:=]\s*[^\s]+/i
];
const OLD_SRC = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:sk-[a-zA-Z0-9_-]{20,}|AIza[0-9A-Za-z-_]{35})\b/,
  /\b(?:ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9_-]{20,})\b/,
  /\bxox[baprs]-[0-9a-zA-Z]{10,}/,
  /\b(?:bearer\s+[a-zA-Z0-9_\-.]{25,}|eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/i,
  /\b(?:password|passwd|secret_key|api_secret|access_token)\s*[:=]\s*['"]?[^\s'"]{6,}['"]?/i
];

const SECRETS: Record<string, string> = {
  "OpenAI style key": "Barış uses sk-proj-12345678901234567890123456 for testing",
  "GitHub token": "ghp_123456789012345678901234567890123456",
  "GitHub OAuth token": "gho_123456789012345678901234567890123456",
  "GitLab token": "glpat-abcdefghij1234567890",
  "RSA private key": "-----BEGIN RSA PRIVATE KEY-----\nMIIE...",
  "OpenSSH private key": "-----BEGIN OPENSSH PRIVATE KEY-----",
  "Bearer token (20 chars)": "Authorization: Bearer abcdefghijklmnopqrstuv",
  "JWT": "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
  "Slack token": "slack xoxb-1234567890abcdef",
  "Legacy Google key": "Firebase key AIzaSyB2v-fk_DTVTRu4s2yuxScH-c9gSdNcRGQ",
  "short password assignment": "my password: abc",
  "long password assignment": "password: superSecretPassword123",
  "access_token assignment": "access_token=abcdef123456",
  "secret_key assignment": "secret_key = 'abcdef123456'",
  // Formats neither old filter caught.
  "Groq key": "My Groq key is gsk_6NCMoMOHBDlGcMdVz339WGdyb3FYYVGo",
  "Google AQ. key": "Gemini key AQ.Ab8RN6KObwTEDssGWU5Ayf9yR022GGak5rdVkzif0xwG",
  "api key assignment": "api_key: 9f8e7d6c5b4a",
  "password in prose": "my password is hunter22",
  "Turkish şifre with colon": "benim şifrem: hunter22",
  "Turkish parola without colon": "parolam Kedi2024!",
  "Turkish şifresi şu": "wifi şifresi şu: abc123",
  "Turkish capitalised": "Şifre: 1234"
};

const BENIGN: Record<string, string> = {
  "preference": "Barış loves green apple juice",
  "tech preference": "Barış prefers TypeScript for full-stack architecture.",
  "project fact": "The project uses Firebase Firestore for runtime state.",
  "passwordless": "I prefer passwordless login",
  "password manager": "Barış uses a password manager",
  "password quality": "Barış's password is strong.",
  "Turkish forgot password": "şifremi unuttum, sıfırlamam gerekiyor",
  "Turkish changing passwords": "şifre değiştirmeyi sevmiyorum",
  "Turkish parola word": "parola politikası çok katı",
  "short sk mention": "the sk- prefix is used by some vendors"
};

describe("PrivacyFilter (unified)", () => {
  for (const [label, text] of Object.entries(SECRETS)) {
    it(`rejects ${label}`, () => {
      const result = PrivacyFilter.check(text);
      expect(result.isSafe).toBe(false);
      expect(result.reason).toMatch(/Contains sensitive pattern/);
    });
  }

  for (const [label, text] of Object.entries(BENIGN)) {
    it(`allows ${label}`, () => {
      expect(PrivacyFilter.check(text)).toEqual({ isSafe: true });
    });
  }

  it("rejects everything the two former filters rejected", () => {
    for (const text of [...Object.values(SECRETS), ...Object.values(BENIGN)]) {
      const oldRejected = OLD_PRODUCTION.some((re) => re.test(text)) || OLD_SRC.some((re) => re.test(text));
      if (oldRejected) {
        expect(PrivacyFilter.check(text).isSafe, text).toBe(false);
      }
    }
  });

  it("treats empty or non-string input as safe", () => {
    expect(PrivacyFilter.check("").isSafe).toBe(true);
    expect(PrivacyFilter.check(undefined as unknown as string).isSafe).toBe(true);
  });
});
