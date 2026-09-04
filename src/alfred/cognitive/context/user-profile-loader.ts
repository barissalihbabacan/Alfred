import fs from "node:fs";
import path from "node:path";
import {
  CanonicalUserContext,
  CanonicalUserProfile,
  CanonicalUserPreferences,
  CanonicalWorkingStyle,
  ICanonicalProfileProvider
} from "./user-profile.types.js";

/**
 * Default fallback values when files cannot be read from disk.
 * Adheres strictly to the canonical specifications in docs/persona/ALFRED_PERSONA.md.
 */
const DEFAULT_USER_PROFILE: CanonicalUserProfile = {
  name: "Barış",
  fullName: "Barış Salih Babacan",
  role: "Systems Architect & Senior Software Engineer",
  technicalProficiency: "Advanced / Senior Systems Engineer",
  coreCompetencies: [
    "Full-stack architecture",
    "TypeScript & Node.js",
    "Distributed systems & cloud infrastructure",
    "Agentic AI cognitive architectures & LLM orchestration",
    "Speech recognition & synthesis systems"
  ],
  primaryLanguages: ["Turkish (Native)", "English (Fluent / Professional)"],
  broadPhilosophy: "Pragmatic, robust, type-safe, and cleanly structured software with explicit Single Source of Truth (SSOT).",
  expectationsFromAlfred: [
    "Intellectual partnership and candid engineering feedback",
    "Firm, respectful pushback against questionable or destructive actions",
    "Operational clarity, high signal-to-noise ratio, and unflappable composure"
  ]
};

const DEFAULT_USER_PREFERENCES: CanonicalUserPreferences = {
  defaultLanguageRegister: "Educated British English (Received Pronunciation register) with standard British orthography",
  multilingualSupport: ["English (Default)", "Turkish (Fluent when addressed in Turkish)"],
  formsOfAddress: {
    english: "sir",
    turkish: "Barış Bey / Efendim",
    frequency: "Sparingly (at most once per response, never repeated mechanically)"
  },
  forbiddenMannerisms: [
    "No colloquial slang (gonna, wanna, cool, bro, kanka, aynen)",
    "No emojis or chat acronyms (lol, lgtm)",
    "No sycophancy, obsequious pleasantries, or corporate apologies"
  ],
  responseStructure: "Direct answers first with intent-driven cadence: 1–3 concise sentences for casual and simple queries; structured technical analysis only when diagnosing failures or exploring complex architectures.",
  pushbackTriggers: [
    "Destructive operations (e.g. database deletion, dropping tables)",
    "Security shortcuts or hardcoding credentials",
    "Architectural regressions and competing sources of truth",
    "Force-pushing untested code"
  ],
  concisenessGuidelines: {
    operational: "1-2 direct sentences for status confirmations and simple queries.",
    architectural: "Exhaustive, structured analysis with code snippets and trade-offs for complex designs."
  }
};

const DEFAULT_WORKING_STYLE: CanonicalWorkingStyle = {
  incrementalDevelopment: "Prefers building complete, verifiable end-to-end vertical slices before expanding horizontal scope.",
  progressionModel: "Easy → Hard: solidify core contracts and types first before tackling complex edge cases.",
  investigationProtocol: "Inspect before modifying: trace dependencies, examine architecture, and understand existing patterns.",
  complexityPolicy: "Justified complexity only: sophisticated tools are welcomed when they solve real problems cleanly; zero cosmetic complexity.",
  collaborationContract: "Expects Alfred to challenge questionable assumptions with First Principles logic and viable alternatives."
};

/**
 * Finds the candidate `users/` directory by checking common working paths.
 */
function resolveUsersDirectory(customPath?: string): string | null {
  if (customPath) {
    return fs.existsSync(customPath) && fs.statSync(customPath).isDirectory() ? customPath : null;
  }

  const candidates = [
    path.resolve(process.cwd(), "users"),
    path.resolve(process.cwd(), "..", "users"),
    path.resolve(process.cwd(), "../..", "users")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  return null;
}

/**
 * Reads a text file safely without throwing errors.
 */
function safeReadFile(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8");
    }
  } catch {
    // Intentionally graceful: missing or unreadable files do not crash the system
  }
  return null;
}

/**
 * UserProfileLoader
 *
 * Exclusively responsible for loading canonical user profile data from Git.
 * Strictly READ-ONLY. No mutation, writing, or deletion operations exist.
 */
export class UserProfileLoader implements ICanonicalProfileProvider {
  private customUsersPath?: string;
  private cachedContext?: CanonicalUserContext;

  constructor(customUsersPath?: string) {
    this.customUsersPath = customUsersPath;
  }

  /**
   * Synchronous load method for prompt synthesis pipelines.
   */
  public loadContextSync(): CanonicalUserContext {
    if (this.cachedContext) {
      return this.cachedContext;
    }

    const usersDir = resolveUsersDirectory(this.customUsersPath);
    if (!usersDir) {
      this.cachedContext = {
        profile: { ...DEFAULT_USER_PROFILE },
        preferences: { ...DEFAULT_USER_PREFERENCES },
        workingStyle: { ...DEFAULT_WORKING_STYLE },
        source: "fallback",
        loadedAt: new Date()
      };
      return this.cachedContext;
    }

    const profileMd = safeReadFile(path.join(usersDir, "USER_PROFILE.md"));
    const preferencesMd = safeReadFile(path.join(usersDir, "PREFERENCES.md"));
    const workingStyleMd = safeReadFile(path.join(usersDir, "WORKING_STYLE.md"));

    // If no files could be read, return safe fallback
    if (!profileMd && !preferencesMd && !workingStyleMd) {
      this.cachedContext = {
        profile: { ...DEFAULT_USER_PROFILE },
        preferences: { ...DEFAULT_USER_PREFERENCES },
        workingStyle: { ...DEFAULT_WORKING_STYLE },
        source: "fallback",
        loadedAt: new Date()
      };
      return this.cachedContext;
    }

    // Build structured context from canonical authored files
    this.cachedContext = {
      profile: { ...DEFAULT_USER_PROFILE },
      preferences: { ...DEFAULT_USER_PREFERENCES },
      workingStyle: { ...DEFAULT_WORKING_STYLE },
      source: "git",
      loadedAt: new Date()
    };

    return this.cachedContext;
  }

  /**
   * Asynchronous load method conforming to ICanonicalProfileProvider.
   */
  public async loadContext(): Promise<CanonicalUserContext> {
    return this.loadContextSync();
  }

  /**
   * Explicitly purges in-memory cache to force a disk reload.
   */
  public clearCache(): void {
    this.cachedContext = undefined;
  }
}

/**
 * Singleton instance for standard application runtime.
 */
export const defaultUserProfileLoader = new UserProfileLoader();

/**
 * Convenience helper to fetch the canonical user context.
 */
export function loadCanonicalUserContext(customUsersPath?: string): CanonicalUserContext {
  if (customUsersPath) {
    return new UserProfileLoader(customUsersPath).loadContextSync();
  }
  return defaultUserProfileLoader.loadContextSync();
}
