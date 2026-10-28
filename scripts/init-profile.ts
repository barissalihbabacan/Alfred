#!/usr/bin/env tsx
/**
 * scripts/init-profile.ts
 *
 * Interactive / programmatic generator that renders templates from `templates/`
 * into `users/` and `docs/persona/`.
 *
 * Usage:
 *   npx tsx scripts/init-profile.ts               # Interactive prompt
 *   npx tsx scripts/init-profile.ts --defaults    # Non-interactive with sensible defaults
 *   npx tsx scripts/init-profile.ts --dry-run     # Preview rendered output without writing
 *   npx tsx scripts/init-profile.ts --name "Barış" --full-name "Barış Salih Babacan" ...
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";
import { syncUserProfileSourcesModule } from "./generate-user-profile-sources.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface ProfileAnswers {
  USER_NAME: string;
  USER_FULL_NAME: string;
  USER_ROLE: string;
  USER_DOMAIN: string;
  ENGINEERING_LEVEL: string;
  PRIMARY_LANGUAGES: string;
  CORE_STACKS: string;
  ARCHITECTURAL_ORIENTATION: string;
  PREFERRED_ADDRESS_TR: string;
  PREFERRED_ADDRESS_EN: string;
  PUSHBACK_SCENARIOS: string;
  GENERATED_DATE: string;
}

export const DEFAULT_ANSWERS: ProfileAnswers = {
  USER_NAME: "Barış",
  USER_FULL_NAME: "Barış Salih Babacan",
  USER_ROLE: "Systems Architect & Senior Software Engineer",
  USER_DOMAIN: "High-performance distributed systems, agentic AI cognitive architectures, voice/audio engineering",
  ENGINEERING_LEVEL: "Principal / Lead / Senior (Expert — no elementary tutorials or boilerplate needed)",
  PRIMARY_LANGUAGES: "TypeScript, JavaScript (ESM), Node.js 22+, Python",
  CORE_STACKS: "Next.js (App Router), React, Firebase (Hosting, Cloud Functions 2nd Gen, Firestore), Google Cloud, Tailwind CSS 4, Vector search, Groq, Ollama",
  ARCHITECTURAL_ORIENTATION: "Vertical slices, single source of truth (SSOT), strict type safety, zero loose any, explicit error handling, minimal focused diffs",
  PREFERRED_ADDRESS_TR: "Efendim",
  PREFERRED_ADDRESS_EN: "sir",
  PUSHBACK_SCENARIOS: [
    "- **Destructive Operations**: Dropping production or staging databases, deleting collections, or running irreversible shell commands without backups.",
    "- **Security Hazards**: Hardcoded secrets, disabled authentication or authorization checks, bypassed TLS/HTTPS, or exposed service accounts.",
    "- **Architectural Regressions**: Competing sources of truth, leaky abstractions, circular dependencies, or premature framework complexity.",
    "- **Quality Violations**: Force-pushes, skipping tests, or bypassing strict TypeScript type checks (`--noEmit`, `no-explicit-any`)."
  ].join("\n"),
  GENERATED_DATE: new Date().toISOString().slice(0, 10)
};

export interface TemplateMapping {
  templateFile: string;
  destFile: string;
}

export const TEMPLATE_MAPPINGS: readonly TemplateMapping[] = [
  {
    templateFile: join(repoRoot, "templates", "USER_PROFILE.template.md"),
    destFile: join(repoRoot, "users", "USER_PROFILE.md")
  },
  {
    templateFile: join(repoRoot, "templates", "PREFERENCES.template.md"),
    destFile: join(repoRoot, "users", "PREFERENCES.md")
  },
  {
    templateFile: join(repoRoot, "templates", "WORKING_STYLE.template.md"),
    destFile: join(repoRoot, "users", "WORKING_STYLE.md")
  },
  {
    templateFile: join(repoRoot, "templates", "ALFRED_PERSONA.template.md"),
    destFile: join(repoRoot, "docs", "persona", "ALFRED_PERSONA.md")
  }
];

export function renderTemplate(templateContent: string, answers: ProfileAnswers): string {
  let result = templateContent;
  for (const [key, value] of Object.entries(answers)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(pattern, value);
  }
  return result;
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Updates hash lines in `src/alfred/cognitive/context/user-profile.digest.md`
 * so the digest remains valid for the rendered `users/*.md` files.
 */
export function updateDigestHashes(renderedFiles: Record<string, string>): void {
  const digestPath = join(repoRoot, "src", "alfred", "cognitive", "context", "user-profile.digest.md");
  if (!existsSync(digestPath)) return;

  const content = readFileSync(digestPath, "utf8");
  const lines = content.split("\n");
  const updatedLines = lines.map((line) => {
    const match = /^<!--\s*sha256\s+(\S+)\s+([0-9a-f]{64})\s*-->$/.exec(line.trim());
    if (match) {
      const filename = match[1];
      const newContent = renderedFiles[filename];
      if (newContent !== undefined) {
        return `<!-- sha256 ${filename} ${sha256(newContent)} -->`;
      }
    }
    return line;
  });

  writeFileSync(digestPath, updatedLines.join("\n"), "utf8");
}

function parseCliArgs(): {
  flags: Partial<ProfileAnswers>;
  useDefaults: boolean;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const flags: Partial<ProfileAnswers> = {};
  let useDefaults = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--defaults") useDefaults = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--name" && i + 1 < args.length) flags.USER_NAME = args[++i];
    else if (arg === "--full-name" && i + 1 < args.length) flags.USER_FULL_NAME = args[++i];
    else if (arg === "--role" && i + 1 < args.length) flags.USER_ROLE = args[++i];
    else if (arg === "--domain" && i + 1 < args.length) flags.USER_DOMAIN = args[++i];
    else if (arg === "--level" && i + 1 < args.length) flags.ENGINEERING_LEVEL = args[++i];
    else if (arg === "--languages" && i + 1 < args.length) flags.PRIMARY_LANGUAGES = args[++i];
    else if (arg === "--stacks" && i + 1 < args.length) flags.CORE_STACKS = args[++i];
    else if (arg === "--architecture" && i + 1 < args.length) flags.ARCHITECTURAL_ORIENTATION = args[++i];
    else if (arg === "--address-tr" && i + 1 < args.length) flags.PREFERRED_ADDRESS_TR = args[++i];
    else if (arg === "--address-en" && i + 1 < args.length) flags.PREFERRED_ADDRESS_EN = args[++i];
  }

  return { flags, useDefaults, dryRun };
}

async function promptUser(): Promise<ProfileAnswers> {
  const { flags, useDefaults } = parseCliArgs();
  const isInteractive = input.isTTY && !useDefaults && Object.keys(flags).length === 0;

  if (!isInteractive) {
    return {
      ...DEFAULT_ANSWERS,
      ...flags,
      GENERATED_DATE: new Date().toISOString().slice(0, 10)
    };
  }

  const rl = readline.createInterface({ input, output });

  try {
    console.log("\n=======================================================");
    console.log("   Alfred — Profile & Persona Initialization Setup");
    console.log("=======================================================\n");
    console.log("Press Enter to keep the default value in brackets.\n");

    const ask = async (promptText: string, defaultValue: string): Promise<string> => {
      const answer = await rl.question(`${promptText}\n[Default: ${defaultValue}]: `);
      return answer.trim() || defaultValue;
    };

    const userName = await ask("1. Short Name (What Alfred calls you)", DEFAULT_ANSWERS.USER_NAME);
    const userFullName = await ask("2. Full Name", DEFAULT_ANSWERS.USER_FULL_NAME);
    const userRole = await ask("3. Professional Role / Title", DEFAULT_ANSWERS.USER_ROLE);
    const userDomain = await ask("4. Engineering Domain & Focus Areas", DEFAULT_ANSWERS.USER_DOMAIN);
    const engineeringLevel = await ask("5. Engineering Level / Seniority", DEFAULT_ANSWERS.ENGINEERING_LEVEL);
    const primaryLanguages = await ask("6. Primary Programming Languages", DEFAULT_ANSWERS.PRIMARY_LANGUAGES);
    const coreStacks = await ask("7. Core Tech Stacks & Frameworks", DEFAULT_ANSWERS.CORE_STACKS);
    const archOrientation = await ask("8. Architectural Orientation / Core Principles", DEFAULT_ANSWERS.ARCHITECTURAL_ORIENTATION);
    const addressTr = await ask("9. Preferred Address in Turkish (e.g. Efendim, Bey, abi)", DEFAULT_ANSWERS.PREFERRED_ADDRESS_TR);
    const addressEn = await ask("10. Preferred Address in English (e.g. sir, first-name)", DEFAULT_ANSWERS.PREFERRED_ADDRESS_EN);

    return {
      USER_NAME: userName,
      USER_FULL_NAME: userFullName,
      USER_ROLE: userRole,
      USER_DOMAIN: userDomain,
      ENGINEERING_LEVEL: engineeringLevel,
      PRIMARY_LANGUAGES: primaryLanguages,
      CORE_STACKS: coreStacks,
      ARCHITECTURAL_ORIENTATION: archOrientation,
      PREFERRED_ADDRESS_TR: addressTr,
      PREFERRED_ADDRESS_EN: addressEn,
      PUSHBACK_SCENARIOS: DEFAULT_ANSWERS.PUSHBACK_SCENARIOS,
      GENERATED_DATE: new Date().toISOString().slice(0, 10)
    };
  } finally {
    rl.close();
  }
}

export async function runInitProfile(): Promise<void> {
  const { dryRun } = parseCliArgs();
  const answers = await promptUser();

  console.log("\n--- Configuration Summary ---");
  console.log(`User: ${answers.USER_NAME} (${answers.USER_FULL_NAME})`);
  console.log(`Role: ${answers.USER_ROLE}`);
  console.log(`Languages: ${answers.PRIMARY_LANGUAGES}`);
  console.log(`Stacks: ${answers.CORE_STACKS}`);
  console.log(`Address: TR="${answers.PREFERRED_ADDRESS_TR}", EN="${answers.PREFERRED_ADDRESS_EN}"`);
  console.log("-----------------------------\n");

  const renderedUsersFiles: Record<string, string> = {};

  for (const mapping of TEMPLATE_MAPPINGS) {
    if (!existsSync(mapping.templateFile)) {
      console.warn(`Template not found: ${mapping.templateFile}, skipping.`);
      continue;
    }

    const templateContent = readFileSync(mapping.templateFile, "utf8");
    const rendered = renderTemplate(templateContent, answers);

    if (mapping.destFile.includes("/users/")) {
      const basename = mapping.destFile.split("/").pop()!;
      renderedUsersFiles[basename] = rendered;
    }

    if (dryRun) {
      console.log(`[DRY-RUN] Would write ${mapping.destFile} (${rendered.length} bytes)`);
    } else {
      mkdirSync(dirname(mapping.destFile), { recursive: true });
      writeFileSync(mapping.destFile, rendered, "utf8");
      console.log(`✓ Wrote ${mapping.destFile}`);
    }
  }

  if (!dryRun) {
    // Keep user-profile.digest.md in sync with the new sha256 checksums
    updateDigestHashes(renderedUsersFiles);

    // Regenerate src/alfred/cognitive/context/user-profile.generated.ts
    syncUserProfileSourcesModule();
    console.log("✓ Synchronized user-profile.generated.ts and user-profile.digest.md hashes.");
    console.log("\nProfile initialization complete!");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runInitProfile().catch((err) => {
    console.error("Initialization failed:", err);
    process.exit(1);
  });
}
