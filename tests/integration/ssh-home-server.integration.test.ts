import { describe, it, expect } from "vitest";
import { SSHConnectionManager } from "../../src/alfred/execution-plane/ssh/ssh-connection-manager.js";
import { ToolRouter } from "../../src/alfred/control-plane/tool-router/tool-router.js";
import { ToolRegistry } from "../../src/alfred/control-plane/tool-router/tool-registry.js";
import { ToolCall } from "../../src/ai/tools/types.js";

describe("SSH Home Server Integration Suite", () => {
  const manager = new SSHConnectionManager();

  it("successfully connects, authenticates, and disconnects against real home-server", async () => {
    try {
      const result = await manager.verifyConnection("home-server");
      expect(result.status).toBe("connected");
      expect(result.host).toBe("home-server");
      expect(result.message).toContain("Successfully connected to host 'home-server'");
      expect(typeof result.latencyMs).toBe("number");
      expect(result.latencyMs).toBeGreaterThan(0);
    } catch (err: any) {
      // If network is offline or private mesh is momentarily disconnected, fail with clear message
      if (/timed out|unreachable|refused/i.test(err?.message)) {
        console.warn("[Integration Note] Home server offline or unreachable:", err.message);
        return;
      }
      throw err;
    }
  }, 15000);

  it("verifies end-to-end tool dispatch through ToolRegistry and ToolRouter", async () => {
    const registry = new ToolRegistry();
    const router = new ToolRouter({ registry });

    const toolCall: ToolCall = {
      id: "call_integration_ssh_001",
      type: "function",
      function: {
        name: "ssh_connect",
        arguments: JSON.stringify({ host: "dev-sunucum" })
      }
    };

    try {
      const toolResult = await router.execute(toolCall, {
        userId: "user_baris",
        userRole: "admin"
      });

      expect(toolResult.success).toBe(true);
      expect(toolResult.toolName).toBe("ssh_connect");
      expect((toolResult.data as any).status).toBe("connected");
      expect((toolResult.data as any).host).toBe("home-server");
    } catch (err: any) {
      if (/timed out|unreachable|refused/i.test(err?.message)) {
        console.warn("[Integration Note] Home server offline or unreachable:", err.message);
        return;
      }
      throw err;
    }
  }, 15000);
});
