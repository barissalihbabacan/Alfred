import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../../src/alfred/control-plane/tool-router/tool-registry.js";
import { ToolRouter } from "../../src/alfred/control-plane/tool-router/tool-router.js";
import { SSHListDirectoryTool } from "../../src/ai/tools/ssh/ssh-list-directory.tool.js";
import { SSHConnectionManager } from "../../src/alfred/execution-plane/ssh/ssh-connection-manager.js";
import { MockSSHClient } from "../../src/alfred/execution-plane/ssh/mock-ssh-client.js";
import { ToolCall } from "../../src/ai/tools/types.js";

describe("SSH List Directory Router & Permission Suite", () => {
  let registry: ToolRegistry;
  let router: ToolRouter;
  let mockClient: MockSSHClient;

  beforeEach(() => {
    mockClient = new MockSSHClient("success");
    const manager = new SSHConnectionManager({
      clientFactory: () => mockClient
    });
    const listTool = new SSHListDirectoryTool(manager);

    registry = new ToolRegistry();
    registry.register(listTool); // Overwrite with test manager
    router = new ToolRouter({ registry });
  });

  it("successfully routes valid ssh_list_directory tool call for authenticated user", async () => {
    const toolCall: ToolCall = {
      id: "call_dir_001",
      type: "function",
      function: {
        name: "ssh_list_directory",
        arguments: JSON.stringify({ host: "home-server", path: "Belgeler" })
      }
    };

    const result = await router.execute(toolCall, {
      userId: "user_baris",
      userRole: "admin"
    });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe("ssh_list_directory");
    expect(result.toolCallId).toBe("call_dir_001");
    expect((result.data as any).host).toBe("home-server");
    expect((result.data as any).totalCount).toBe(4);
    expect((result.data as any).entries.length).toBe(4);
  });

  it("denies execution if userId is absent (SAFE_READ requires active user session)", async () => {
    const toolCall: ToolCall = {
      id: "call_dir_unauth",
      type: "function",
      function: {
        name: "ssh_list_directory",
        arguments: JSON.stringify({ host: "home-server", path: "Belgeler" })
      }
    };

    // No user context supplied
    const result = await router.execute(toolCall);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Active user context is required");
    expect(mockClient.connectCalls.length).toBe(0);
  });

  it("returns error result when traversal path is requested", async () => {
    const toolCall: ToolCall = {
      id: "call_dir_traversal",
      type: "function",
      function: {
        name: "ssh_list_directory",
        arguments: JSON.stringify({ host: "home-server", path: "../../etc" })
      }
    };

    const result = await router.execute(toolCall, {
      userId: "user_baris"
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Path traversal|outside the permitted/i);
    expect(mockClient.connectCalls.length).toBe(0);
  });

  it("returns error result when unapproved host is requested", async () => {
    const toolCall: ToolCall = {
      id: "call_dir_bad_host",
      type: "function",
      function: {
        name: "ssh_list_directory",
        arguments: JSON.stringify({ host: "rogue-server", path: "Belgeler" })
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
      id: "call_dir_malformed",
      type: "function",
      function: {
        name: "ssh_list_directory",
        arguments: "{broken_json:"
      }
    };

    const result = await router.execute(toolCall, {
      userId: "user_baris"
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to parse tool arguments JSON");
  });
});
