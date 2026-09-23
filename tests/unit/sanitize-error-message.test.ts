import { describe, it, expect } from "vitest";
import { sanitizeErrorMessage } from "../../src/core/errors/ai.js";

// Pins the redaction regexes in src/core/errors/ai.ts so that cosmetic regex
// edits (e.g. dropping redundant escapes inside character classes) can't
// silently change what gets redacted.
describe("sanitizeErrorMessage", () => {
  it("returns an empty string for empty input", () => {
    expect(sanitizeErrorMessage("")).toBe("");
  });

  it("redacts Groq keys", () => {
    expect(sanitizeErrorMessage("bad key gsk_abcdefghijklmnopqrstuvwxyz0123")).toBe(
      "bad key gsk_***REDACTED***"
    );
  });

  it("redacts bearer tokens containing dots, dashes and underscores", () => {
    expect(sanitizeErrorMessage("Authorization: Bearer eyJhbGciOi.JIUzI1-NiIs_InR5cCI6")).toBe(
      "Authorization: Bearer ***REDACTED***"
    );
    expect(sanitizeErrorMessage("bearer a.b-c_d.e-f_g.h-i_j.k-l_m")).toBe("Bearer ***REDACTED***");
  });

  it("does not redact short bearer values", () => {
    expect(sanitizeErrorMessage("Bearer short.token")).toBe("Bearer short.token");
  });

  it("redacts api_key / api-key / apikey assignments", () => {
    expect(sanitizeErrorMessage('api_key="abcd-efgh_ijkl-mnop"')).toBe("api_key=***REDACTED***");
    expect(sanitizeErrorMessage("api-key: abcd-efgh_ijkl-mnop")).toBe("api_key=***REDACTED***");
    expect(sanitizeErrorMessage("APIKEY=abcdefghijklmnop")).toBe("api_key=***REDACTED***");
  });

  it("redacts generic key assignments of 20+ chars", () => {
    expect(sanitizeErrorMessage("key='aaaaaaaaaa-bbbbbbbbb_ccc'")).toBe("key=***REDACTED***");
    expect(sanitizeErrorMessage("key=short-value")).toBe("key=short-value");
  });

  it("stops the token at characters outside the allowed class", () => {
    expect(sanitizeErrorMessage("Bearer abcdefghijklmnopqrstuvwxyz/rest")).toBe(
      "Bearer ***REDACTED***/rest"
    );
  });
});
