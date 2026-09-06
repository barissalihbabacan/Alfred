/**
 * B.U.T.L.E.R. Alfred — Tool Router
 * Central dispatcher that receives tool calls from the AI provider, validates arguments,
 * checks permission policies, executes the matching tool, and returns structured results.
 */

import { ToolCall, ToolResult, ToolExecutionContext } from "../../../ai/tools/types.js";
import { ToolRegistry, getToolRegistry } from "./tool-registry.js";
import { PermissionManager } from "../permission-system/permission-manager.js";

export interface ToolRouterOptions {
  registry?: ToolRegistry;
}

export class ToolRouter {
  private registry: ToolRegistry;

  constructor(options?: ToolRouterOptions) {
    this.registry = options?.registry || getToolRegistry();
  }

  /**
   * Executes a single tool call request dispatched by the AI model.
   * Handles JSON parsing, permission verification, schema validation, and safe execution.
   */
  public async execute(
    toolCall: ToolCall,
    context?: Partial<ToolExecutionContext>
  ): Promise<ToolResult> {
    const startTime = performance.now();
    const toolName = toolCall.function.name;
    const toolCallId = toolCall.id || `call_${Date.now()}`;

    // 1. Resolve tool from registry
    const tool = this.registry.get(toolName);
    if (!tool) {
      return {
        toolCallId,
        toolName,
        success: false,
        error: `Tool '${toolName}' is not registered or available in Alfred's tool catalog.`,
        executionTimeMs: Math.round(performance.now() - startTime)
      };
    }

    // 2. Check permission
    const permContext = context?.userId
      ? { userId: context.userId, userRole: context.userRole, confirmed: context.confirmed }
      : undefined;
    const permissionResult = PermissionManager.checkPermission(tool.permissionLevel, permContext);
    if (!permissionResult.granted) {
      return {
        toolCallId,
        toolName,
        success: false,
        error: permissionResult.reason || "Permission denied for tool execution.",
        executionTimeMs: Math.round(performance.now() - startTime)
      };
    }

    // 3. Parse JSON arguments
    let rawArgs: unknown;
    try {
      rawArgs =
        typeof toolCall.function.arguments === "string" && toolCall.function.arguments.trim().length > 0
          ? JSON.parse(toolCall.function.arguments)
          : {};
    } catch (parseErr: any) {
      return {
        toolCallId,
        toolName,
        success: false,
        error: `Failed to parse tool arguments JSON: ${parseErr?.message || parseErr}`,
        executionTimeMs: Math.round(performance.now() - startTime)
      };
    }

    // 4. Validate arguments using tool's schema validator
    const validation = tool.validateArgs(rawArgs);
    if (!validation.valid) {
      return {
        toolCallId,
        toolName,
        success: false,
        error: validation.error || "Arguments validation failed.",
        executionTimeMs: Math.round(performance.now() - startTime)
      };
    }

    // 5. Execute tool safely
    const fullContext: ToolExecutionContext = {
      userId: context?.userId || "guest_default",
      userRole: context?.userRole || "guest",
      confirmed: context?.confirmed,
      conversationId: context?.conversationId,
      toolCallId,
      timestamp: Date.now()
    };

    try {
      const data = await tool.execute(validation.parsedArgs, fullContext);
      const executionTimeMs = Math.round(performance.now() - startTime);

      return {
        toolCallId,
        toolName,
        success: true,
        data,
        executionTimeMs
      };
    } catch (execErr: any) {
      const executionTimeMs = Math.round(performance.now() - startTime);
      return {
        toolCallId,
        toolName,
        success: false,
        error: execErr?.message || `Execution of tool '${toolName}' failed unexpectedly.`,
        executionTimeMs
      };
    }
  }

  /**
   * Batch executes multiple tool calls sequentially or concurrently.
   */
  public async executeAll(
    toolCalls: ToolCall[],
    context?: Partial<ToolExecutionContext>
  ): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map((tc) => this.execute(tc, context)));
  }
}

// Global default singleton router
let defaultRouterInstance: ToolRouter | null = null;

export function getToolRouter(): ToolRouter {
  if (!defaultRouterInstance) {
    defaultRouterInstance = new ToolRouter();
  }
  return defaultRouterInstance;
}
