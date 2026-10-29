/**
 * Whose assistant this installation is: the name in users/USER_PROFILE.md
 * (`- **Name**: Alex (Full name: Alex Doe)`, as scripts/init-profile.ts
 * writes it). The prompts address the owner by this name instead of a
 * hard-coded one.
 *
 * Bundled into production, so it stays pure: it parses the profile text the
 * build embedded in user-profile.generated.ts and never reads files.
 */
import { USER_PROFILE_SOURCES } from "./user-profile.generated.js";

export interface ProfileOwner {
  /** Short name the prompts use, e.g. "Alex"; "" when the profile names nobody. */
  name: string;
  /** Full name, e.g. "Alex Doe"; the short name when no full name is given. */
  fullName: string;
}

/** How the prompts refer to an owner whose profile names nobody. */
export const UNNAMED_OWNER_LABEL = "the user";

const NAME_LINE = /^\s*-\s*\*\*Name\*\*:[ \t]*(.+?)[ \t]*$/m;
const FULL_NAME_SUFFIX = /\s*\(Full name:\s*([^)]*)\)\s*$/;

/** Reads the owner's name from the text of users/USER_PROFILE.md. */
export function parseProfileOwner(userProfile: string): ProfileOwner {
  const line = NAME_LINE.exec(userProfile)?.[1] ?? "";
  const name = line.replace(FULL_NAME_SUFFIX, "").trim();
  const fullName = (FULL_NAME_SUFFIX.exec(line)?.[1] ?? "").trim();
  return { name, fullName: fullName || name };
}

/** The owner of this installation, from the profile embedded at build time. */
export const PROFILE_OWNER: ProfileOwner = parseProfileOwner(USER_PROFILE_SOURCES.userProfile);

/** The name to put in a prompt: the owner's, or "the user" when there is none. */
export function ownerLabel(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed || UNNAMED_OWNER_LABEL;
}
