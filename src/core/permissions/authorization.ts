export interface AuthorizationResult {
  authorized: boolean;
  status?: number;
  error?: string;
}

/**
 * Validates backend request authorization according to configured ALLOWED_UID and ALLOWED_EMAIL.
 *
 * Rules:
 * - If neither UID nor Email is configured: fail closed (503 Service Unavailable).
 * - If UID is not configured and Email is configured: allows access if email matches and is verified (zero-touch onboarding).
 * - If both are configured: both UID and verified Email must match.
 * - If UID is configured and Email is not configured: UID must match.
 * - Otherwise: 403 Forbidden.
 */
export function verifyUserAuthorization(
  authenticatedUid: string | null | undefined,
  authenticatedEmail: string | null | undefined,
  isEmailVerified: boolean,
  configuredUid: string = "",
  configuredEmail: string = "",
  onUnconfigured?: () => void
): AuthorizationResult {
  const normAllowedUid = (configuredUid || "").trim();
  const normAllowedEmail = (configuredEmail || "").toLowerCase().trim();
  const hasUidConfig = Boolean(normAllowedUid);
  const hasEmailConfig = Boolean(normAllowedEmail);

  if (!hasUidConfig && !hasEmailConfig) {
    if (onUnconfigured) {
      onUnconfigured();
    }
    return {
      authorized: false,
      status: 503,
      error: "Service Unavailable: Authorization not configured on backend."
    };
  }

  const uidMatches = hasUidConfig ? authenticatedUid === normAllowedUid : true;
  const emailMatches = hasEmailConfig
    ? (authenticatedEmail || "").toLowerCase().trim() === normAllowedEmail && Boolean(isEmailVerified)
    : true;

  if (uidMatches && emailMatches) {
    return { authorized: true };
  }

  return {
    authorized: false,
    status: 403,
    error: "Forbidden: Unauthorized account."
  };
}
