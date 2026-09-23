/**
 * Single source of truth for the allowed Firebase UID in the Next.js app
 * (both client components and route handlers import this).
 *
 * The UID is not a secret; real enforcement happens server-side in
 * functions/index.js (which reads its own ALLOWED_UID env var). Override
 * locally with NEXT_PUBLIC_ALLOWED_UID; the NEXT_PUBLIC_ prefix makes Next.js
 * inline the same value into client bundles so client and server agree.
 */
export const ALLOWED_UID: string =
  process.env.NEXT_PUBLIC_ALLOWED_UID || "test-owner-uid-123456";
