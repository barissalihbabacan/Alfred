import { describe, it, expect, beforeEach } from "vitest";
import type { SSHConnectResult } from "../../src/ai/tools/ssh/ssh-connect.tool.js";
import { ToolRegistry } from "../../src/alfred/control-plane/tool-router/tool-registry.js";
import { ToolRouter } from "../../src/alfred/control-plane/tool-router/tool-router.js";
import { SSHConnectTool } from "../../src/ai/tools/ssh/ssh-connect.tool.js";
import { SSHConnectionManager } from "../../src/alfred/execution-plane/ssh/ssh-connection-manager.js";
import { MockSSHClient } from "../../src/alfred/execution-plane/ssh/mock-ssh-client.js";
import { ToolCall } from "../../src/ai/tools/types.js";

describe("SSH Tool Routing & Permissions Suite", () => {
  let registry: ToolRegistry;
  let router: ToolRouter;
  let mockClient: MockSSHClient;

  beforeEach(() => {
    mockClient = new MockSSHClient("success", 2);
    const manager = new SSHConnectionManager({
      clientFactory: () => mockClient
    });
    const sshTool = new SSHConnectTool(manager);

    registry = new ToolRegistry();
    registry.register(sshTool); // Overwrite with test tool instance
    router = new ToolRouter({ registry });
  });

  it("successfully routes valid ssh_connect tool call for authorized user", async () => {
    const toolCall: ToolCall = {
      id: "call_ssh_123",
      type: "function",
      function: {
        name: "ssh_connect",
        arguments: JSON.stringify({ host: "home-server" })
      }
    };

    const result = await router.execute(toolCall, {
      userId: "user_baris",
      userRole: "admin"
    });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe("ssh_connect");
    expect(result.toolCallId).toBe("call_ssh_123");
    const data = result.data as SSHConnectResult;
    expect(data.status).toBe("connected");
    expect(data.host).toBe("home-server");
  });

  it("denies execution if userId is absent (PermissionLevel.EXECUTE requires active user)", async () => {
    const toolCall: ToolCall = {
      id: "call_ssh_unauth",
      type: "function",
      function: {
        name: "ssh_connect",
        arguments: JSON.stringify({ host: "home-server" })
      }
    };

    // Execute with no user context
    const result = await router.execute(toolCall);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Active user context is required");
    expect(mockClient.connectCalls.length).toBe(0);
  });

  it("returns error result when unapproved host is requested", async () => {
    const toolCall: ToolCall = {
      id: "call_ssh_bad_host",
      type: "function",
      function: {
        name: "ssh_connect",
        arguments: JSON.stringify({ host: "arbitrary-server-attack" })
      }
    };

    const result = await router.execute(toolCall, {
      userId: "user_baris"
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("not recognized or permitted");
    expect(mockClient.connectCalls.length).toBe(0);
  });

  it("handles malformed JSON arguments gracefully", async () => {
    const toolCall: ToolCall = {
      id: "call_ssh_malformed",
      type: "function",
      function: {
        name: "ssh_connect",
        arguments: "{host: broken"
      }
    };

    const result = await router.execute(toolCall, {
      userId: "user_baris"
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to parse tool arguments JSON");
  });
});
