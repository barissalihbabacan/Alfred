/**
 * Single source of truth for the allowed Firebase UID and Email in the web app
 * (imported and re-exported by lib/auth.ts).
 *
 * Real enforcement happens server-side in functions/index.js.
 * Override with NEXT_PUBLIC_ALLOWED_UID and NEXT_PUBLIC_ALLOWED_EMAIL at build time;
 * the NEXT_PUBLIC_ prefix makes Next.js inline the values into the static export.
 */
export const ALLOWED_UID: string = (process.env.NEXT_PUBLIC_ALLOWED_UID || "").trim();

export const ALLOWED_EMAIL: string = (
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL || ""
).toLowerCase().trim();

/**
 * Validates whether a user identity meets the dual UID + Email authorization criteria
 * with configurable allowlist values (useful for tests and dynamic checks).
 */
export function checkUserAuthorization(
  user: { uid?: string | null; email?: string | null } | null | undefined,
  allowedUid: string = ALLOWED_UID,
  allowedEmail: string = ALLOWED_EMAIL
): boolean {
  if (!user || !user.uid) return false;

  const normAllowedUid = (allowedUid || "").trim();
  const normAllowedEmail = (allowedEmail || "").toLowerCase().trim();
  const hasUidConfig = Boolean(normAllowedUid);
  const hasEmailConfig = Boolean(normAllowedEmail);

  // If neither is configured, fail closed (no open door access)
  if (!hasUidConfig && !hasEmailConfig) {
    return false;
  }

  // 1. UID verification (if configured)
  if (hasUidConfig && user.uid !== normAllowedUid) {
    return false;
  }

  // 2. Email verification (if email configured)
  // When UID is not configured, email is the sole authorization check (mandatory).
  // When UID is configured and user provides email, verify email matches as well.
  if (hasEmailConfig) {
    if (!hasUidConfig) {
      if (!user.email || user.email.toLowerCase().trim() !== normAllowedEmail) {
        return false;
      }
    } else if (user.email && user.email.toLowerCase().trim() !== normAllowedEmail) {
      return false;
    }
  }

  return true;
}

/**
 * Validates whether a user identity meets the configured authorization criteria.
 */
export function isAuthorizedUser(user: { uid?: string | null; email?: string | null } | null | undefined): boolean {
  return checkUserAuthorization(user, ALLOWED_UID, ALLOWED_EMAIL);
}
