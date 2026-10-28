import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  DEFAULT_ANSWERS,
  TEMPLATE_MAPPINGS,
  renderTemplate,
  type ProfileAnswers
} from "../../scripts/init-profile.js";

describe("scripts/init-profile.ts", () => {
  it("verifies all referenced template files exist on disk", () => {
    for (const mapping of TEMPLATE_MAPPINGS) {
      expect(existsSync(mapping.templateFile)).toBe(true);
    }
  });

  it("substitutes all {{PLACEHOLDER}} tags cleanly without leaving unfilled placeholders", () => {
    for (const mapping of TEMPLATE_MAPPINGS) {
      const templateContent = readFileSync(mapping.templateFile, "utf8");
      const rendered = renderTemplate(templateContent, DEFAULT_ANSWERS);

      // Verify no remaining double-curly brace placeholders remain
      const remainingPlaceholders = rendered.match(/\{\{[A-Z0-9_]+\}\}/g);
      expect(remainingPlaceholders).toBeNull();
    }
  });

  it("allows overriding specific fields while maintaining valid templates", () => {
    const customAnswers: ProfileAnswers = {
      ...DEFAULT_ANSWERS,
      USER_NAME: "Alice",
      USER_FULL_NAME: "Alice Smith",
      USER_ROLE: "Staff AI Engineer",
      PREFERRED_ADDRESS_TR: "Alice Hanım",
      PREFERRED_ADDRESS_EN: "Alice"
    };

    const userProfileMapping = TEMPLATE_MAPPINGS.find((m) => m.destFile.endsWith("USER_PROFILE.md"))!;
    const templateContent = readFileSync(userProfileMapping.templateFile, "utf8");
    const rendered = renderTemplate(templateContent, customAnswers);

    expect(rendered).toContain("# Canonical User Profile — Alice");
    expect(rendered).toContain("**Author**: Alice Smith");
    expect(rendered).toContain("Staff AI Engineer");
    expect(rendered.match(/\{\{[A-Z0-9_]+\}\}/g)).toBeNull();
  });
});
