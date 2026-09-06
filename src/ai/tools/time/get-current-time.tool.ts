/**
 * B.U.T.L.E.R. Alfred — Tool: get_current_time(city)
 * Deterministic, side-effect-free tool to retrieve the current local time and timezone for a city.
 */

import { ITool, ToolDefinition, ToolParameterSchema, ToolExecutionContext } from "../types.js";
import { PermissionLevel } from "../../../alfred/control-plane/permission-system/types.js";
import { timezoneResolver } from "./timezone-resolver.js";

export interface GetCurrentTimeArgs {
  city: string;
}

export interface GetCurrentTimeResult {
  city: string;
  timezone: string;
  localTime: string;
  time24: string;
  date: string;
  utcOffset: string;
  dayOfWeek: string;
  isDaytime: boolean;
}

export class GetCurrentTimeTool implements ITool<GetCurrentTimeArgs, GetCurrentTimeResult> {
  public readonly name = "get_current_time";
  public readonly description =
    "Returns the current local time, date, day of week, and timezone offset for a specified city or location. Use this whenever the user inquires about the current time in any city.";
  public readonly permissionLevel = PermissionLevel.READ_ONLY;

  public readonly parameterSchema: ToolParameterSchema = {
    type: "object",
    properties: {
      city: {
        type: "string",
        description: "The city or geographic location name to look up (e.g. 'London', 'Tokyo', 'Istanbul', 'New York', 'Paris')."
      }
    },
    required: ["city"],
    additionalProperties: false
  };

  public getDefinition(): ToolDefinition {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameterSchema
      }
    };
  }

  public validateArgs(args: unknown): { valid: boolean; error?: string; parsedArgs?: GetCurrentTimeArgs } {
    if (!args || typeof args !== "object") {
      return {
        valid: false,
        error: "Invalid arguments: expected an object containing a 'city' string property."
      };
    }

    const cast = args as Record<string, unknown>;
    if (typeof cast.city !== "string" || !cast.city.trim()) {
      return {
        valid: false,
        error: "Missing required argument 'city'. Please specify a valid city name (e.g., 'London', 'Tokyo', 'Istanbul')."
      };
    }

    return {
      valid: true,
      parsedArgs: {
        city: cast.city.trim()
      }
    };
  }

  public async execute(
    args: GetCurrentTimeArgs,
    _context?: ToolExecutionContext
  ): Promise<GetCurrentTimeResult> {
    const resolved = timezoneResolver.resolve(args.city);

    if (!resolved) {
      throw new Error(
        `Unable to identify a valid timezone for city '${args.city}'. Please check the city spelling or specify an alternate nearby major city.`
      );
    }

    const now = new Date();
    const tz = resolved.timezone;

    const time12 = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(now);

    const time24 = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(now);

    const dateStr = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    }).format(now);

    const dayOfWeek = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "long"
    }).format(now);

    const offsetParts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset"
    }).formatToParts(now);

    const offset = offsetParts.find((p) => p.type === "timeZoneName")?.value || "UTC";

    // Approximate daytime calculation based on 24-hour hour
    const hour24 = parseInt(time24.split(":")[0], 10);
    const isDaytime = hour24 >= 6 && hour24 < 20;

    return {
      city: resolved.matchedCity,
      timezone: tz,
      localTime: time12,
      time24,
      date: dateStr,
      utcOffset: offset,
      dayOfWeek,
      isDaytime
    };
  }
}
