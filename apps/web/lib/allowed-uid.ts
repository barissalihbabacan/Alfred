/**
 * Single source of truth for the allowed Firebase UID in the web app
 * (imported and re-exported by lib/auth.ts).
 *
 * The UID is not a secret; real enforcement happens server-side in
 * functions/index.js (which reads its own ALLOWED_UID env var). Override
 * with NEXT_PUBLIC_ALLOWED_UID at build time; the NEXT_PUBLIC_ prefix makes
 * Next.js inline the value into the static export.
 */
export const ALLOWED_UID: string =
  process.env.NEXT_PUBLIC_ALLOWED_UID || "test-owner-uid-123456";
