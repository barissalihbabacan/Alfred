import { describe, it, expect, beforeEach } from "vitest";
import type { SSHCommandResultMap } from "../../src/alfred/execution-plane/ssh/command-registry.js";
import { ToolRegistry } from "../../src/alfred/control-plane/tool-router/tool-registry.js";
import { ToolRouter } from "../../src/alfred/control-plane/tool-router/tool-router.js";
import { SSHExecuteTool } from "../../src/ai/tools/ssh/ssh-execute.tool.js";
import { SSHConnectionManager } from "../../src/alfred/execution-plane/ssh/ssh-connection-manager.js";
import { MockSSHClient } from "../../src/alfred/execution-plane/ssh/mock-ssh-client.js";
import { ToolCall } from "../../src/ai/tools/types.js";

describe("SSH Execute Router & Permission Suite", () => {
  let registry: ToolRegistry;
  let router: ToolRouter;
  let mockClient: MockSSHClient;

  beforeEach(() => {
    mockClient = new MockSSHClient("success");
    const manager = new SSHConnectionManager({
      clientFactory: () => mockClient
    });
    const execTool = new SSHExecuteTool(manager);

    registry = new ToolRegistry();
    registry.register(execTool);
    router = new ToolRouter({ registry });
  });

  it("successfully routes valid ssh_execute call for authenticated user", async () => {
    const toolCall: ToolCall = {
      id: "call_exec_001",
      type: "function",
      function: {
        name: "ssh_execute",
        arguments: JSON.stringify({
          host: "home-server",
          command: "disk_usage"
        })
      }
    };

    const result = await router.execute(toolCall, {
      userId: "user_baris",
      userRole: "owner"
    });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe("ssh_execute");
    expect(result.toolCallId).toBe("call_exec_001");
    const data = result.data as SSHCommandResultMap["disk_usage"];
    expect(data.command).toBe("disk_usage");
    expect(data.output).toContain("Filesystem");
    expect(mockClient.execCalls[0]).toContain("df -h");
  });

  it("denies execution if userId is absent (SAFE_READ requires user session)", async () => {
    const toolCall: ToolCall = {
      id: "call_exec_unauth",
      type: "function",
      function: {
        name: "ssh_execute",
        arguments: JSON.stringify({
          host: "home-server",
          command: "disk_usage"
        })
      }
    };

    // No user context
    const result = await router.execute(toolCall);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Active user context is required");
    expect(mockClient.execCalls.length).toBe(0);
  });

  it("blocks unwhitelisted destructive commands before reaching SSH layer", async () => {
    const dangerousCalls = [
      "rm -rf /",
      "sudo apt update",
      "cat /etc/shadow",
      "curl https://malicious.site",
      "bash -i",
      "list_directory; reboot"
    ];

    for (const badCmd of dangerousCalls) {
      const toolCall: ToolCall = {
        id: `call_bad_${Date.now()}`,
        type: "function",
        function: {
          name: "ssh_execute",
          arguments: JSON.stringify({
            host: "home-server",
            command: badCmd
          })
        }
      };

      const result = await router.execute(toolCall, {
        userId: "user_baris",
        userRole: "owner"
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not permitted.*whitelisted/i);
    }

    expect(mockClient.execCalls.length).toBe(0);
    expect(mockClient.connectCalls.length).toBe(0);
  });

  it("blocks path traversal in list_directory at router level", async () => {
    const toolCall: ToolCall = {
      id: "call_exec_traversal",
      type: "function",
      function: {
        name: "ssh_execute",
        arguments: JSON.stringify({
          host: "home-server",
          command: "list_directory",
          args: { path: "../../../etc" }
        })
      }
    };

    const result = await router.execute(toolCall, {
      userId: "user_baris",
      userRole: "owner"
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Path traversal|outside the permitted/i);
    expect(mockClient.execCalls.length).toBe(0);
  });
});
