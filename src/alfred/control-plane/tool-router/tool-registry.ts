/**
 * B.U.T.L.E.R. Alfred — Tool Registry
 * Central repository for registering, discovering, and providing schemas for all available tools.
 */

import { ITool, ToolDefinition } from "../../../ai/tools/types.js";
import { GetCurrentTimeTool } from "../../../ai/tools/time/get-current-time.tool.js";
import { SSHConnectTool } from "../../../ai/tools/ssh/ssh-connect.tool.js";

export class ToolRegistry {
  private tools = new Map<string, ITool>();

  constructor() {
    // Initialise with Stage 4 Milestone 1 & 2 tools
    this.register(new GetCurrentTimeTool());
    this.register(new SSHConnectTool());
  }

  /**
   * Registers a new tool. Replaces any existing tool with the same name.
   */
  public register(tool: ITool): void {
    if (!tool || !tool.name) {
      throw new Error("Cannot register an invalid tool without a valid name.");
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Retrieves a tool by its registered name.
   */
  public get(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  /**
   * Checks whether a tool name is registered.
   */
  public has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Returns all registered tools.
   */
  public list(): ITool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Returns standard OpenAI/Ollama compatible ToolDefinitions for all registered tools.
   */
  public getDefinitions(): ToolDefinition[] {
    return this.list().map((tool) => tool.getDefinition());
  }

  /**
   * Clears all registered tools (primarily used in testing).
   */
  public clear(): void {
    this.tools.clear();
  }
}

// Global default singleton registry
let defaultRegistryInstance: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!defaultRegistryInstance) {
    defaultRegistryInstance = new ToolRegistry();
  }
  return defaultRegistryInstance;
}
