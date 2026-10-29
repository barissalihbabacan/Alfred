import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  DEFAULT_ANSWERS,
  DIGEST_TEMPLATE_FILE,
  TEMPLATE_MAPPINGS,
  renderDigest,
  renderTemplate,
  type ProfileAnswers
} from "../../scripts/init-profile.js";
import { parseUserProfileDigest, sha256 } from "../../scripts/generate-user-profile-sources.js";

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

  it("never renders docs/persona/ALFRED_PERSONA.md (the shared persona spec)", () => {
    expect(TEMPLATE_MAPPINGS.some((m) => m.destFile.includes("persona"))).toBe(false);
  });

  it("renders a digest whose hash lines match the rendered users/*.md", () => {
    const answers: ProfileAnswers = { ...DEFAULT_ANSWERS, USER_NAME: "Ada", USER_FULL_NAME: "Ada Lovelace" };
    const files = Object.fromEntries(
      TEMPLATE_MAPPINGS.map((m) => [m.destFile.split("/").pop() ?? "", renderTemplate(readFileSync(m.templateFile, "utf8"), answers)])
    );
    const digest = renderDigest(readFileSync(DIGEST_TEMPLATE_FILE, "utf8"), answers, files);
    expect(digest.match(/\{\{[A-Z0-9_]+\}\}/g)).toBeNull();
    const { hashes, body } = parseUserProfileDigest(digest);
    for (const [file, text] of Object.entries(files)) expect(hashes[file]).toBe(sha256(text));
    expect(body.startsWith("- Ada Lovelace: ")).toBe(true);
  });

  it("the committed example profile is exactly `--defaults --date 2026-10-29`", () => {
    const answers: ProfileAnswers = { ...DEFAULT_ANSWERS, GENERATED_DATE: "2026-10-29" };
    const files: Record<string, string> = {};
    for (const m of TEMPLATE_MAPPINGS) {
      const rendered = renderTemplate(readFileSync(m.templateFile, "utf8"), answers);
      expect(readFileSync(m.destFile, "utf8"), m.destFile).toBe(rendered);
      files[m.destFile.split("/").pop() ?? ""] = rendered;
    }
    const committedDigest = readFileSync(
      new URL("../../src/alfred/cognitive/context/user-profile.digest.md", import.meta.url),
      "utf8"
    );
    expect(committedDigest).toBe(renderDigest(readFileSync(DIGEST_TEMPLATE_FILE, "utf8"), answers, files));
  });
});
