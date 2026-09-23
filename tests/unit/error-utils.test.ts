import { describe, it, expect } from "vitest";
import { errorMessage, errorName, isAbortError } from "../../src/core/errors/index.js";

// errorMessage replaces the old `err?.message || fallback` and
// `err?.message || String(err)` idioms; these cases pin that equivalence.
describe("error utils (src/core/errors/utils.ts)", () => {
  it("returns the message of an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  it("reads message from error-like objects", () => {
    expect(errorMessage({ message: "from object" })).toBe("from object");
  });

  it("falls back when the message is missing or empty", () => {
    expect(errorMessage(new Error(""), "fallback")).toBe("fallback");
    expect(errorMessage({}, "fallback")).toBe("fallback");
    expect(errorMessage(undefined, "fallback")).toBe("fallback");
  });

  it("stringifies the value when there is no message and no fallback", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
    expect(errorMessage(new Error(""))).toBe("Error");
  });

  it("ignores non-string message fields", () => {
    expect(errorMessage({ message: 123 }, "fallback")).toBe("fallback");
  });

  it("detects abort errors by name", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isAbortError(abort)).toBe(true);
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("other"))).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(errorName(abort)).toBe("AbortError");
  });
});
