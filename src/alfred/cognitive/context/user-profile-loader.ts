import fs from "node:fs";
import path from "node:path";
import {
  CanonicalUserContext,
  ICanonicalProfileProvider,
  UserProfileSources
} from "./user-profile.types.js";
import { USER_PROFILE_SOURCES } from "./user-profile.generated.js";

/** File name of each canonical profile source under users/. */
const PROFILE_FILES: Readonly<Record<keyof UserProfileSources, string>> = {
  userProfile: "USER_PROFILE.md",
  preferences: "PREFERENCES.md",
  workingStyle: "WORKING_STYLE.md"
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
 * Loads the canonical user profile (users/*.md) from disk for src/ and local
 * use. Strictly READ-ONLY. No mutation, writing, or deletion operations exist.
 *
 * The files are returned as raw text; rendering them into the prompt is the
 * job of the pure renderUserProfileBlock() (./user-profile-renderer.ts),
 * which production also uses. Any file that cannot be read falls back to the
 * copy embedded at build time (./user-profile.generated.ts), i.e. the
 * committed content of users/*.md, so the profile never silently disappears.
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
    const sources: UserProfileSources = { ...USER_PROFILE_SOURCES };
    let readAll = usersDir !== null;

    if (usersDir) {
      for (const key of Object.keys(PROFILE_FILES) as Array<keyof UserProfileSources>) {
        const text = safeReadFile(path.join(usersDir, PROFILE_FILES[key]));
        if (text === null) {
          readAll = false;
        } else {
          sources[key] = text;
        }
      }
    }

    this.cachedContext = {
      sources,
      source: readAll ? "git" : "fallback",
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
