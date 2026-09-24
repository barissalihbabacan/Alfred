/**
 * B.U.T.L.E.R. Alfred — get_current_time: definition and pure implementation.
 *
 * Shared with functions/index.js (bundled via esbuild): production sends this
 * definition to the model and returns getCurrentTimeForCity()'s object as the
 * tool result. Keep it pure (no I/O, no imports with side effects).
 */

import type { ToolDefinition } from "../types.js";
import { resolveTimezone } from "./timezone-resolver.js";

export const GET_CURRENT_TIME_TOOL_NAME = "get_current_time";

/**
 * One call answers several cities. The model otherwise asks for cities one
 * per round, and production re-sends the whole prompt every round: a
 * two-city question took three calls (~7k tokens) against Groq's 8k/min cap,
 * and three cities ran out of rounds (24 Sep 2026, empty replies).
 */
export const MAX_CITIES_PER_CALL = 6;

export const GET_CURRENT_TIME_TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: GET_CURRENT_TIME_TOOL_NAME,
    description:
      "Returns the current local time, date, day of week, and timezone offset for one or more cities. " +
      "Pass every city the user asked about in a single call via `cities`.",
    parameters: {
      type: "object",
      properties: {
        cities: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: MAX_CITIES_PER_CALL,
          description: "All city or location names to look up, in one call, spelled as the user wrote them (e.g. ['İstanbul', 'New York'] or ['Londra', 'Sidney'])."
        },
        city: {
          type: "string",
          description: "Single city (legacy form; prefer `cities`)."
        }
      },
      required: ["cities"]
    }
  }
};

export interface CurrentTimeResult {
  /** The requested city, trimmed. */
  city: string;
  /** IANA identifier. */
  timezone: string;
  /** en-US 12-hour, e.g. "3:07 PM". */
  localTime: string;
  /** en-GB 24-hour, e.g. "15:07". */
  time24: string;
  /** en-US long date, e.g. "Wednesday, September 23, 2026". */
  date: string;
  /** en-US shortOffset, e.g. "GMT+3" or "GMT"; "UTC" if the runtime gives none. */
  utcOffset: string;
}

export interface CurrentTimeError {
  error: string;
}

/**
 * Current local time for a city or zone name, formatted exactly as production
 * returns it to the model. An unresolvable (or non-string) city yields
 * `{ error: "Unable to identify a valid timezone for city '<city>'." }`, with
 * `<city>` stringified as given. `now` exists for tests; production omits it.
 */
export function getCurrentTimeForCity(city: unknown, now?: Date): CurrentTimeResult | CurrentTimeError {
  const resolved = resolveTimezone(city);
  if (!resolved) {
    return { error: `Unable to identify a valid timezone for city '${String(city)}'.` };
  }
  const at = now ?? new Date();
  const tz = resolved.timezone;
  const time12 = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(at);
  const time24 = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  const dateStr = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(at);
  const offsetParts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at);
  const offset = offsetParts.find((p) => p.type === "timeZoneName")?.value || "UTC";

  return {
    city: resolved.matchedCity,
    timezone: tz,
    localTime: time12,
    time24,
    date: dateStr,
    utcOffset: offset
  };
}

export interface CurrentTimeMultiResult {
  results: Array<CurrentTimeResult | (CurrentTimeError & { city: string })>;
  /** Present when more than MAX_CITIES_PER_CALL cities were requested. */
  note?: string;
}

/**
 * Runs the get_current_time tool for the model's arguments, as production
 * does. `{ cities: [...] }` returns `{ results: [...] }` (one entry per city,
 * errors included, in order); the legacy `{ city }` form returns exactly what
 * getCurrentTimeForCity returns, so existing callers see no change.
 */
export function runGetCurrentTimeTool(
  args: unknown,
  now?: Date
): CurrentTimeResult | CurrentTimeError | CurrentTimeMultiResult {
  const record = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
  const rawCities = record.cities;
  if (Array.isArray(rawCities) && rawCities.length > 0) {
    const cities = rawCities.slice(0, MAX_CITIES_PER_CALL);
    const results = cities.map((city) => {
      const one = getCurrentTimeForCity(city, now);
      return "error" in one ? { city: String(city), error: one.error } : one;
    });
    const out: CurrentTimeMultiResult = { results };
    if (rawCities.length > MAX_CITIES_PER_CALL) {
      out.note = `Only the first ${MAX_CITIES_PER_CALL} cities were looked up.`;
    }
    return out;
  }
  return getCurrentTimeForCity(record.city, now);
}
