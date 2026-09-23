/**
 * Helpers for working with `unknown` values caught in `catch` clauses.
 */

function readProperty(value: unknown, key: string): unknown {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}

/**
 * Returns the `message` of a caught value when it has a non-empty string one
 * (an `Error` or an error-like object), otherwise `fallback`, otherwise
 * `String(err)`. Equivalent to the old `err?.message || fallback` /
 * `err?.message || String(err)` idioms, without `any`.
 */
export function errorMessage(err: unknown, fallback?: string): string {
  const message = readProperty(err, "message");
  if (typeof message === "string" && message.length > 0) return message;
  return fallback ?? String(err);
}

/** Returns the string `name` of a caught value (e.g. `"AbortError"`), if any. */
export function errorName(err: unknown): string | undefined {
  const name = readProperty(err, "name");
  return typeof name === "string" ? name : undefined;
}

/** True when a caught value is an abort (fetch/AbortController timeout). */
export function isAbortError(err: unknown): boolean {
  return errorName(err) === "AbortError";
}
