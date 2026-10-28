/**
 * Single source of truth for the allowed Firebase UID and Email in the web app
 * (imported and re-exported by lib/auth.ts).
 *
 * Real enforcement happens server-side in functions/index.js.
 * Override with NEXT_PUBLIC_ALLOWED_UID and NEXT_PUBLIC_ALLOWED_EMAIL at build time;
 * the NEXT_PUBLIC_ prefix makes Next.js inline the values into the static export.
 */
export const ALLOWED_UID: string =
  process.env.NEXT_PUBLIC_ALLOWED_UID || "test-owner-uid-123456";

export const ALLOWED_EMAIL: string = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL || "owner@example.invalid"
).toLowerCase().trim();

/**
 * Validates whether a user identity meets the dual UID + Email authorization criteria.
 */
export function isAuthorizedUser(user: { uid?: string | null; email?: string | null } | null | undefined): boolean {
  if (!user || !user.uid) return false;

  // 1. UID verification (if configured)
  if (ALLOWED_UID && user.uid !== ALLOWED_UID) {
    return false;
  }

  // 2. Email verification (if configured and user provided email)
  if (ALLOWED_EMAIL && user.email) {
    if (user.email.toLowerCase().trim() !== ALLOWED_EMAIL) {
      return false;
    }
  }

  return true;
}
