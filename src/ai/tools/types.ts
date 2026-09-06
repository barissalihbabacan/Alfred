/**
 * B.U.T.L.E.R. Alfred — AI Tool Calling Core Types
 * Defines standard contracts for tool schemas, registrations, invocations, and results.
 */

import { PermissionLevel, PermissionContext } from "../../alfred/control-plane/permission-system/types.js";

export interface ToolParameterProperty {
  type: "string" | "number" | "boolean" | "object" | "array" | "integer";
  description?: string;
  enum?: (string | number)[];
  items?: ToolParameterProperty;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  default?: unknown;
}

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Standard OpenAI / Ollama compatible function tool definition.
 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
}

/**
 * Tool call invocation request issued by an LLM.
 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // Serialized JSON string
  };
}

/**
 * Execution context passed to tools at runtime.
 */
export interface ToolExecutionContext extends PermissionContext {
  conversationId?: string;
  toolCallId: string;
  timestamp?: number;
}

/**
 * Standard execution result returned by a tool after invocation.
 */
export interface ToolResult<T = unknown> {
  toolCallId: string;
  toolName: string;
  success: boolean;
  data?: T;
  error?: string;
  executionTimeMs?: number;
}

/**
 * Interface implemented by any executable Alfred tool.
 */
export interface ITool<TArgs = any, TResult = any> {
  readonly name: string;
  readonly description: string;
  readonly permissionLevel: PermissionLevel;
  readonly parameterSchema: ToolParameterSchema;

  /**
   * Returns standard tool definition suitable for passing to LLM providers.
   */
  getDefinition(): ToolDefinition;

  /**
   * Validates arguments extracted from LLM call before execution.
   */
  validateArgs(args: unknown): { valid: boolean; error?: string; parsedArgs?: TArgs };

  /**
   * Executes the deterministic tool action.
   */
  execute(args: TArgs, context: ToolExecutionContext): Promise<TResult>;
}
