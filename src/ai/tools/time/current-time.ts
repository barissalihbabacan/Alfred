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

export const GET_CURRENT_TIME_TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: GET_CURRENT_TIME_TOOL_NAME,
    description: "Returns the current local time, date, day of week, and timezone offset for a specified city or location.",
    parameters: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "The city or geographic location name to look up (e.g. 'London', 'Tokyo', 'Istanbul', 'New York', 'Paris')."
        }
      },
      required: ["city"]
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
