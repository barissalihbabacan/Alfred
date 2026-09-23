import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// App Check is verified on every api request. Enforcement is opt-in
// (ENFORCE_APP_CHECK=true) and should only be switched on once the
// llm_request logs show real traffic carries a valid token.
const source = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");

describe("functions/index.js App Check handling", () => {
  it("reads enforcement from one constant, off unless ENFORCE_APP_CHECK=true", () => {
    expect(source).toContain('const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === "true";');
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

  it("rejects missing or invalid tokens only when enforcement is on", () => {
    expect(source).toMatch(/appCheckStatus = "invalid";[\s\S]{0,200}if \(ENFORCE_APP_CHECK\) \{\n\s*res\.status\(401\)\.json\(\{ error: "Unauthorized: Invalid App Check token\." \}\);/);
    expect(source).toContain('} else if (ENFORCE_APP_CHECK && !path.endsWith("/health")) {');
  });
});
