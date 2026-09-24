/**
 * B.U.T.L.E.R. Alfred — Tool: get_current_time(cities | city)
 * Deterministic, side-effect-free tool to retrieve the current local time and timezone for a city.
 *
 * Definition, resolution and formatting come from ./current-time.ts, which
 * production (functions/index.js) bundles too, so both return the same data.
 */

import { ITool, ToolDefinition, ToolParameterSchema, ToolExecutionContext } from "../types.js";
import { PermissionLevel } from "../../../alfred/control-plane/permission-system/types.js";
import {
  CurrentTimeMultiResult,
  CurrentTimeResult,
  GET_CURRENT_TIME_TOOL_DEFINITION,
  GET_CURRENT_TIME_TOOL_NAME,
  runGetCurrentTimeTool
} from "./current-time.js";

export interface GetCurrentTimeArgs {
  /** Passed through untouched, as production does; non-strings fail to resolve. */
  city?: unknown;
  /** Several cities in one call; production's preferred form. */
  cities?: unknown;
}

export type GetCurrentTimeResult = CurrentTimeResult | CurrentTimeMultiResult;

export class GetCurrentTimeTool implements ITool<GetCurrentTimeArgs, GetCurrentTimeResult> {
  public readonly name = GET_CURRENT_TIME_TOOL_NAME;
  public readonly description = GET_CURRENT_TIME_TOOL_DEFINITION.function.description;
  public readonly permissionLevel = PermissionLevel.READ_ONLY;
  public readonly parameterSchema: ToolParameterSchema = GET_CURRENT_TIME_TOOL_DEFINITION.function.parameters;

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

  /**
   * Production does not validate: it calls getCurrentTimeForCity(args?.city)
   * and a missing or unusable city comes back as the "Unable to identify"
   * error. So every argument value is accepted here and `city` is passed on
   * as-is (not trimmed; the error message quotes it verbatim).
   */
  public validateArgs(args: unknown): { valid: boolean; error?: string; parsedArgs?: GetCurrentTimeArgs } {
    const record = typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
    return { valid: true, parsedArgs: { city: record.city, cities: record.cities } };
  }

  /**
   * Throws production's error text for an unresolvable city; ToolRouter turns
   * that into a failed ToolResult carrying the same message.
   */
  public async execute(
    args: GetCurrentTimeArgs,
    _context?: ToolExecutionContext
  ): Promise<GetCurrentTimeResult> {
    const result = runGetCurrentTimeTool(args);
    if ("error" in result) {
      throw new Error(result.error);
    }
    return result;
  }
}
