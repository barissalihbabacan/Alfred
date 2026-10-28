import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  describeStaleUserProfileDigest,
  renderUserProfileSourcesModule,
  staleUserProfileDigestSources
} from "../../scripts/generate-user-profile-sources.js";
import {
  renderUserProfileBlock,
  renderUserProfileMarkdown,
  USER_PROFILE_BLOCK_HEADER,
  USER_PROFILE_BLOCK_FOOTER
} from "../../src/alfred/cognitive/context/user-profile-renderer.js";
import { USER_PROFILE_SOURCES } from "../../src/alfred/cognitive/context/user-profile.generated.js";
import type { UserProfileSources } from "../../src/alfred/cognitive/context/user-profile.types.js";

const readUsersFile = (name: string) =>
  readFileSync(new URL(`../../users/${name}`, import.meta.url), "utf8");

describe("user-profile.generated.ts (users/*.md embedded for the functions bundle)", () => {
  // If this fails, users/*.md was edited without regenerating the embedded
  // copy: run `npm run generate:user-profile` and commit the result.
  it("matches users/*.md byte for byte", () => {
    expect(USER_PROFILE_SOURCES.userProfile).toBe(readUsersFile("USER_PROFILE.md"));
    expect(USER_PROFILE_SOURCES.preferences).toBe(readUsersFile("PREFERENCES.md"));
    expect(USER_PROFILE_SOURCES.workingStyle).toBe(readUsersFile("WORKING_STYLE.md"));
  });

  it("embeds the current digest, and the digest's hashes match users/*.md", () => {
    expect(staleUserProfileDigestSources()).toEqual([]);
    expect(renderUserProfileSourcesModule()).toBe(
      readFileSync(new URL("../../src/alfred/cognitive/context/user-profile.generated.ts", import.meta.url), "utf8")
    );
  });

  it("an edit to any users/*.md file makes the digest stale until it is updated", () => {
    const root = mkdtempSync(join(tmpdir(), "alfred-digest-"));
    try {
      const context = join("src", "alfred", "cognitive", "context");
      mkdirSync(join(root, "users"));
      mkdirSync(join(root, context), { recursive: true });
      for (const name of ["USER_PROFILE.md", "PREFERENCES.md", "WORKING_STYLE.md"]) {
        writeFileSync(join(root, "users", name), readUsersFile(name));
      }
      const digest = readFileSync(new URL(`../../${context}/user-profile.digest.md`, import.meta.url), "utf8");
      writeFileSync(join(root, context, "user-profile.digest.md"), digest);
      expect(staleUserProfileDigestSources(root)).toEqual([]);

      writeFileSync(join(root, "users", "WORKING_STYLE.md"), `${readUsersFile("WORKING_STYLE.md")}\n- New rule\n`);
      const stale = staleUserProfileDigestSources(root);
      expect(stale.map((s) => s.file)).toEqual(["WORKING_STYLE.md"]);
      expect(describeStaleUserProfileDigest(stale)).toContain(`<!-- sha256 WORKING_STYLE.md ${stale[0]!.actual} -->`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the renderer and the generated module are pure (safe to bundle: no file or env access)", () => {
    for (const file of [
      "../../src/alfred/cognitive/context/user-profile-renderer.ts",
      "../../src/alfred/cognitive/context/user-profile.generated.ts",
      "../../src/ai/prompts/alfred-system-prompt.ts"
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/from "node:|from "fs"|require\(|process\.env|readFileSync/);
    }
  });
});

describe("renderUserProfileMarkdown", () => {
  it("drops the title, metadata blockquotes, rules and blank lines; flattens headings", () => {
    const md = [
      "# Canonical Something — Barış",
      "",
      "> **Document Status**: Canonical  ",
      "> **Last Verified**: 2026-09-04",
      "",
      "---",
      "",
      "## 1. Identity & Baseline",
      "",
      "- **Name**: Barış",
      "  - nested *italic* and **bold**",
      "1. **Numbered**: kept",
      "",
      "### Sub Heading ###"
    ].join("\r\n");
    expect(renderUserProfileMarkdown(md)).toBe(
      ["Identity & Baseline:", "- Name: Barış", "  - nested italic and bold", "1. Numbered: kept", "Sub Heading:"].join("\n")
    );
  });

  it("keeps code spans (and the emphasis inside them) intact", () => {
    expect(renderUserProfileMarkdown("- Use bold (`**term**`) and blocks (` ```lang `), *not* this"))
      .toBe("- Use bold (`**term**`) and blocks (` ```lang `), not this");
  });

  it("does not treat multiplication or lone asterisks as emphasis", () => {
    expect(renderUserProfileMarkdown("- 2 * 3 * 4 is arithmetic")).toBe("- 2 * 3 * 4 is arithmetic");
  });
});

describe("renderUserProfileBlock", () => {
  const block = renderUserProfileBlock(USER_PROFILE_SOURCES);

  it("frames the profile with the canonical header and footer, in file order", () => {
    expect(block.startsWith(`${USER_PROFILE_BLOCK_HEADER}\nUSER PROFILE:\n`)).toBe(true);
    expect(block.endsWith(`\n${USER_PROFILE_BLOCK_FOOTER}`)).toBe(true);
    const order = ["USER PROFILE:", "INTERACTION PREFERENCES:", "WORKING STYLE & ENGINEERING PRINCIPLES:"]
      .map((label) => block.indexOf(`\n${label}\n`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("contains distinctive content from each users/*.md file", () => {
    // users/USER_PROFILE.md
    expect(block).toContain("- Primary Languages: Turkish (Native), English (Fluent / Professional Working Proficiency)");
    expect(block).toContain("3. Operational Quiet: Do not intrude with unsolicited conversational filler.");
    // users/PREFERENCES.md
    expect(block).toContain("- Conclusion First (Inverted Pyramid): State the primary answer");
    expect(block).toContain('  - In Turkish: Address Barış as "Efendim" or "Barış Bey" with equal restraint.');
    // users/WORKING_STYLE.md
    expect(block).toContain("- Extend, Don't Compete: When an abstraction already exists");
    expect(block).toContain("Collaboration Contract with Alfred:");
  });

  it("carries no document scaffolding or bold markers", () => {
    expect(block).not.toContain("Document Status");
    expect(block).not.toContain("Last Verified");
    expect(block).not.toMatch(/^#/m);
    expect(block).not.toMatch(/^---$/m);
    expect(block.replace(/(`+)(.+?)(?<!`)\1(?!`)/g, "")).not.toContain("**");
  });

  it("any edit to a users/*.md file changes the rendered block", () => {
    const keys: Array<keyof UserProfileSources> = ["userProfile", "preferences", "workingStyle"];
    for (const key of keys) {
      const edited = { ...USER_PROFILE_SOURCES, [key]: `${USER_PROFILE_SOURCES[key]}\n- **Marker ${key}**: zebra-42\n` };
      const rendered = renderUserProfileBlock(edited);
      expect(rendered).not.toBe(block);
      expect(rendered).toContain(`- Marker ${key}: zebra-42`);
    }
  });

  it("leaves out a file that renders to nothing", () => {
    const rendered = renderUserProfileBlock({ ...USER_PROFILE_SOURCES, preferences: "# Title only\n\n---\n" });
    expect(rendered).not.toContain("INTERACTION PREFERENCES:");
    expect(rendered).toContain("USER PROFILE:");
    expect(rendered).toContain("WORKING STYLE & ENGINEERING PRINCIPLES:");
  });
});
