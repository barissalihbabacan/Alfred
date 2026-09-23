/**
 * B.U.T.L.E.R. Alfred — Timezone Resolver
 * Resolves a city name or IANA zone to an IANA timezone identifier.
 *
 * Shared with functions/index.js (bundled via esbuild): this is exactly the
 * resolution production's get_current_time tool uses. Keep it pure (no I/O,
 * no imports with side effects).
 */

/**
 * Cities looked up before the Intl scan, keyed by the normalized input
 * (trimmed, lower-cased, "," and "." removed, whitespace collapsed).
 */
export const CITY_TIMEZONE_ALIASES: Readonly<Record<string, string>> = {
  "london": "Europe/London",
  "manchester": "Europe/London",
  "birmingham": "Europe/London",
  "edinburgh": "Europe/London",
  "istanbul": "Europe/Istanbul",
  "ankara": "Europe/Istanbul",
  "izmir": "Europe/Istanbul",
  "tokyo": "Asia/Tokyo",
  "kyoto": "Asia/Tokyo",
  "osaka": "Asia/Tokyo",
  "new york": "America/New_York",
  "washington": "America/New_York",
  "boston": "America/New_York",
  "san francisco": "America/Los_Angeles",
  "los angeles": "America/Los_Angeles",
  "seattle": "America/Los_Angeles",
  "chicago": "America/Chicago",
  "paris": "Europe/Paris",
  "berlin": "Europe/Berlin",
  "frankfurt": "Europe/Berlin",
  "rome": "Europe/Rome",
  "madrid": "Europe/Madrid",
  "amsterdam": "Europe/Amsterdam",
  "dubai": "Asia/Dubai",
  "singapore": "Asia/Singapore",
  "sydney": "Australia/Sydney",
  "melbourne": "Australia/Melbourne",
  "toronto": "America/Toronto",
  "beijing": "Asia/Shanghai",
  "shanghai": "Asia/Shanghai",
  "utc": "UTC",
  "gmt": "Etc/GMT"
};

export interface ResolvedTimezone {
  timezone: string;
  /** The caller's input, trimmed (not the normalized form). */
  matchedCity: string;
}

/**
 * Resolves a city or zone name, in this order:
 * 1. CITY_TIMEZONE_ALIASES on the normalized input;
 * 2. the first zone in `Intl.supportedValuesOf("timeZone")` (runtime order)
 *    whose lower-cased name equals the normalized input, or ends with
 *    "/" + the normalized input with spaces as underscores
 *    ("sao paulo" -> America/Sao_Paulo, "europe/london" -> Europe/London);
 * 3. the result must be accepted by `Intl.DateTimeFormat`, otherwise null.
 * Non-string or empty input returns null.
 */
export function resolveTimezone(cityOrZone: unknown): ResolvedTimezone | null {
  if (!cityOrZone || typeof cityOrZone !== "string") return null;
  const cleaned = cityOrZone.trim().toLowerCase().replace(/[,.]/g, "").replace(/\s+/g, " ");

  // Plain-object lookup, as production does: inherited keys ("constructor",
  // "__proto__") yield a non-string, which Intl then rejects below.
  let tz: string | undefined = CITY_TIMEZONE_ALIASES[cleaned];
  if (!tz) {
    try {
      const parts = Intl.supportedValuesOf("timeZone");
      for (const z of parts) {
        if (z.toLowerCase() === cleaned || z.toLowerCase().endsWith("/" + cleaned.replace(/\s+/g, "_"))) {
          tz = z;
          break;
        }
      }
    } catch {
      // Intl.supportedValuesOf unavailable: aliases only.
    }
  }

  if (tz) {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: tz });
      return { timezone: tz, matchedCity: cityOrZone.trim() };
    } catch {
      // Not a timezone this runtime accepts.
    }
  }
  return null;
}
