import { errorMessage } from "../../src/core/errors/index.js";

/**
 * Shared gating for tests/integration.
 *
 * `ALFRED_OFFLINE=1` (set by `npm run test:integration:offline`, which CI runs)
 * means: no network at all. Every suite that needs a real service (Groq,
 * Ollama, the home-server over SSH/Tailscale, the production API) is reported
 * as skipped, whatever credentials happen to be in the environment or `.env`.
 * Only the checks that are fully local and deterministic run.
 *
 * Without the flag the suites run as before: each one skips when its own
 * prerequisite (e.g. GROQ_API_KEY) is absent, and the SSH/Ollama tests skip
 * (explicitly, via the test context) when the host turns out to be unreachable.
 */
export const OFFLINE = /^(1|true|yes)$/i.test(process.env.ALFRED_OFFLINE?.trim() ?? "");

/** Network errors that mean "the host is not there", not "the code is broken". */
export function isUnreachableError(err: unknown): boolean {
  return /timed out|unreachable|refused/i.test(errorMessage(err));
}
