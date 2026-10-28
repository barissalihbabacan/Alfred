import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// App Check is verified on every api request and enforced by default
// (switched on 24 Sep 2026 after production traffic logged "valid").
// It is off in the emulator and can be disabled with ENFORCE_APP_CHECK=false.
const source = readFileSync(new URL("../../functions/api.ts", import.meta.url), "utf8");

describe("functions/api.ts App Check handling", () => {
  it("reads enforcement from one constant: on unless ENFORCE_APP_CHECK=false or in the emulator", () => {
    expect(source).toContain(
      'const ENFORCE_APP_CHECK =\n  process.env.ENFORCE_APP_CHECK !== "false" && !process.env.FUNCTIONS_EMULATOR;'
    );
    expect(source.match(/process\.env\.ENFORCE_APP_CHECK/g)).toHaveLength(1);
    expect(source).toContain("enforceAppCheck: ENFORCE_APP_CHECK,");
  });

  it("classifies every request as valid, invalid or missing", () => {
    expect(source).toContain('let appCheckStatus = "missing";');
    expect(source).toMatch(/await getAppCheck\(\)\.verifyToken\(appCheckToken\);\n\s*appCheckStatus = "valid";/);
    expect(source).toMatch(/\} catch \(err\) \{\n\s*appCheckStatus = "invalid";/);
  });

  it("logs the status on every llm_request event", () => {
    expect(source).toMatch(/"llm_request",[\s\S]{0,200}\.\.\.llmMetrics,\n\s*outcome,\n\s*app_check: appCheckStatus,/);
  });

  it("rejects missing or invalid tokens when enforced, except the exempt paths", () => {
    expect(source).toMatch(
      /appCheckStatus = "invalid";[\s\S]{0,200}if \(ENFORCE_APP_CHECK && !isAppCheckExempt\(path\)\) \{\n\s*res\.status\(401\)\.json\(\{ error: "[^"]+", code: "app_check_invalid" \}\);/
    );
    expect(source).toMatch(
      /\} else if \(ENFORCE_APP_CHECK && !isAppCheckExempt\(path\)\) \{[\s\S]{0,200}res\.status\(401\)\.json\(\{ error: "[^"]+", code: "app_check_missing" \}\);/
    );
  });

  it("exempts only /health and the root", () => {
    const fn = source.slice(source.indexOf("function isAppCheckExempt"), source.indexOf("}", source.indexOf("function isAppCheckExempt")) + 1);
    const isAppCheckExempt = new Function(`${fn}; return isAppCheckExempt;`)() as (p: string) => boolean;
    for (const p of ["/health", "/api/health", "/", "", "/api", "/api/"]) expect(isAppCheckExempt(p), p).toBe(true);
    for (const p of ["/chat", "/api/chat", "/conversations", "/api/conversation"]) expect(isAppCheckExempt(p), p).toBe(false);
  });
});
