import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../../src/alfred/control-plane/tool-router/tool-registry.js";
import { ToolRouter } from "../../src/alfred/control-plane/tool-router/tool-router.js";
import { GetCurrentTimeTool } from "../../src/ai/tools/time/get-current-time.tool.js";
import { ITool, ToolDefinition, ToolParameterSchema, ToolExecutionContext } from "../../src/ai/tools/types.js";
import { PermissionLevel } from "../../src/alfred/control-plane/permission-system/types.js";

class MockDestructiveTool implements ITool {
  public readonly name = "delete_database";
  public readonly description = "Destructive tool that purges database records.";
  public readonly permissionLevel = PermissionLevel.DESTRUCTIVE;
  public readonly parameterSchema: ToolParameterSchema = {
    type: "object",
    properties: { target: { type: "string" } },
    required: ["target"]
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

  public validateArgs(args: any) {
    if (!args || !args.target) return { valid: false, error: "Missing target" };
    return { valid: true, parsedArgs: args };
  }

  public async execute(args: any, _context: ToolExecutionContext) {
    return { deleted: true, target: args.target };
  }
}

describe("Tool Registry & Router Suite", () => {
  let registry: ToolRegistry;
  let router: ToolRouter;

  beforeEach(() => {
    registry = new ToolRegistry();
    router = new ToolRouter({ registry });
  });

  describe("ToolRegistry", () => {
    it("has get_current_time, ssh_connect, and ssh_list_directory pre-registered by default", () => {
      expect(registry.has("get_current_time")).toBe(true);
      expect(registry.has("ssh_connect")).toBe(true);
      expect(registry.has("ssh_list_directory")).toBe(true);
      const tool = registry.get("get_current_time");
      expect(tool).toBeInstanceOf(GetCurrentTimeTool);
    });

    it("registers and lists new tools", () => {
      const initialCount = registry.list().length;
      const mockTool = new MockDestructiveTool();
      registry.register(mockTool);

      expect(registry.has("delete_database")).toBe(true);
      expect(registry.get("delete_database")).toBe(mockTool);
      expect(registry.list().length).toBe(initialCount + 1);
    });

    it("generates OpenAI/Ollama-compatible tool definitions", () => {
      const defs = registry.getDefinitions();
      expect(defs.length).toBeGreaterThanOrEqual(1);
      const timeDef = defs.find((d) => d.function.name === "get_current_time");
      expect(timeDef).toBeDefined();
      expect(timeDef?.type).toBe("function");
      expect(timeDef?.function.parameters.required).toContain("city");
    });
  });

  describe("ToolRouter", () => {
    it("successfully routes and executes get_current_time", async () => {
      const result = await router.execute({
        id: "call_123",
        type: "function",
        function: {
          name: "get_current_time",
          arguments: JSON.stringify({ city: "London" })
        }
      });

      expect(result.success).toBe(true);
      expect(result.toolName).toBe("get_current_time");
      expect(result.toolCallId).toBe("call_123");
      expect((result.data as any)?.city).toBe("London");
      expect((result.data as any)?.timezone).toBe("Europe/London");
      expect(typeof result.executionTimeMs).toBe("number");
    });

    it("returns a clean error for an unknown tool", async () => {
      const result = await router.execute({
        id: "call_unknown",
        type: "function",
        function: {
          name: "launch_rocket",
          arguments: "{}"
        }
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Tool 'launch_rocket' is not registered");
    });

    it("handles malformed JSON arguments gracefully", async () => {
      const result = await router.execute({
        id: "call_bad_json",
        type: "function",
        function: {
          name: "get_current_time",
          arguments: "{ invalid json string ..."
        }
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to parse tool arguments JSON");
    });

    it("enforces argument schema validation before executing", async () => {
      const result = await router.execute({
        id: "call_bad_args",
        type: "function",
        function: {
          name: "get_current_time",
          arguments: JSON.stringify({ city: "" })
        }
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("city");
    });

    it("enforces permission checks for elevated operations", async () => {
      registry.register(new MockDestructiveTool());

      // Without confirmation -> denied
      const unconfirmed = await router.execute(
        {
          id: "call_delete",
          type: "function",
          function: {
            name: "delete_database",
            arguments: JSON.stringify({ target: "prod" })
          }
        },
        { userId: "baris", confirmed: false }
      );

      expect(unconfirmed.success).toBe(false);
      expect(unconfirmed.error).toContain("Confirmation required");

      // With confirmation -> allowed
      const confirmed = await router.execute(
        {
          id: "call_delete_ok",
          type: "function",
          function: {
            name: "delete_database",
            arguments: JSON.stringify({ target: "prod" })
          }
        },
        { userId: "baris", confirmed: true }
      );

      expect(confirmed.success).toBe(true);
      expect((confirmed.data as any)?.deleted).toBe(true);
    });

    it("executes batch tool calls via executeAll", async () => {
      const results = await router.executeAll([
        {
          id: "call_london",
          type: "function",
          function: {
            name: "get_current_time",
            arguments: JSON.stringify({ city: "London" })
          }
        },
        {
          id: "call_tokyo",
          type: "function",
          function: {
            name: "get_current_time",
            arguments: JSON.stringify({ city: "Tokyo" })
          }
        }
      ]);

      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect((results[0].data as any)?.city).toBe("London");
      expect(results[1].success).toBe(true);
      expect((results[1].data as any)?.city).toBe("Tokyo");
    });
  });
});
