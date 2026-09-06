import { describe, it, expect, beforeEach } from "vitest";
import { SSHListDirectoryTool } from "../../src/ai/tools/ssh/ssh-list-directory.tool.js";
import { SSHConnectionManager } from "../../src/alfred/execution-plane/ssh/ssh-connection-manager.js";
import { MockSSHClient } from "../../src/alfred/execution-plane/ssh/mock-ssh-client.js";
import { PermissionLevel } from "../../src/alfred/control-plane/permission-system/types.js";
import { getSSHConfig } from "../../src/core/config/ssh.config.js";

describe("SSHListDirectoryTool Suite", () => {
  let mockClient: MockSSHClient;
  let tool: SSHListDirectoryTool;
  let manager: SSHConnectionManager;

  beforeEach(() => {
    mockClient = new MockSSHClient("success");
    manager = new SSHConnectionManager({
      clientFactory: () => mockClient,
      config: getSSHConfig()
    });
    tool = new SSHListDirectoryTool(manager);
  });

  describe("Tool Metadata & Contract", () => {
    it("declares name, description, and SAFE_READ permission level", () => {
      expect(tool.name).toBe("ssh_list_directory");
      expect(tool.permissionLevel).toBe(PermissionLevel.SAFE_READ);
      expect(tool.description).toContain("sandbox");
    });

    it("declares OpenAI/Ollama compatible ToolDefinition with required host and path", () => {
      const def = tool.getDefinition();
      expect(def.type).toBe("function");
      expect(def.function.name).toBe("ssh_list_directory");
      expect(def.function.parameters.type).toBe("object");
      expect(def.function.parameters.properties.host).toBeDefined();
      expect(def.function.parameters.properties.path).toBeDefined();
      expect(def.function.parameters.required).toEqual(["host", "path"]);
      expect(def.function.parameters.additionalProperties).toBe(false);
    });
  });

  describe("Argument Validation", () => {
    it("accepts valid host and path arguments", () => {
      const valid = tool.validateArgs({ host: "home-server", path: "Belgeler" });
      expect(valid.valid).toBe(true);
      expect(valid.parsedArgs).toEqual({ host: "home-server", path: "Belgeler" });
    });

    it("trims whitespace from host and path arguments", () => {
      const valid = tool.validateArgs({ host: "  home-server  ", path: "  Belgeler/project  " });
      expect(valid.valid).toBe(true);
      expect(valid.parsedArgs).toEqual({ host: "home-server", path: "Belgeler/project" });
    });

    it("rejects missing host or missing path", () => {
      expect(tool.validateArgs({ path: "Belgeler" }).valid).toBe(false);
      expect(tool.validateArgs({ host: "home-server" }).valid).toBe(false);
      expect(tool.validateArgs({ host: "", path: "Belgeler" }).valid).toBe(false);
      expect(tool.validateArgs({ host: "home-server", path: null as any }).valid).toBe(false);
      expect(tool.validateArgs(null).valid).toBe(false);
      expect(tool.validateArgs("string").valid).toBe(false);
    });
  });

  describe("Execution & Sandbox Enforcements", () => {
    it("lists sandbox root directory contents with deterministic ordering", async () => {
      const result = await tool.execute({ host: "home-server", path: "Belgeler" });

      expect(result.host).toBe("home-server");
      expect(result.path).toBe("Belgeler");
      expect(result.totalCount).toBe(4);
      expect(result.entries.length).toBe(4);

      // Deterministic order: directories first alphabetically, then files alphabetically
      expect(result.entries[0]).toMatchObject({ name: "docs", type: "directory" });
      expect(result.entries[1]).toMatchObject({ name: "project", type: "directory" });
      expect(result.entries[2].name).toBe("notes.txt");
      expect(result.entries[2].type).toBe("file");
      expect(result.entries[2].size).toBe(1234);
      expect(result.entries[3].name).toBe("todo.md");
      expect(result.entries[3].type).toBe("file");

      // Verify SSH exec was invoked with trusted command and SFTP was never used
      expect(mockClient.execCalls.length).toBe(1);
      expect(mockClient.execCalls[0]).toContain("ls -la");
      expect((mockClient as any).sftp).toBeUndefined();

      // Connection must be closed
      expect(mockClient.disconnectCalls).toBe(1);
      expect(mockClient.isConnected()).toBe(false);
    });

    it("lists nested subdirectory contents", async () => {
      const result = await tool.execute({ host: "home-server", path: "Belgeler/project" });

      expect(result.host).toBe("home-server");
      expect(result.path).toBe("Belgeler/project");
      expect(result.totalCount).toBe(3);

      // Directories first (src), then files (package.json, README.md)
      expect(result.entries[0]).toMatchObject({ name: "src", type: "directory" });
      expect(result.entries[1].name).toBe("package.json");
      expect(result.entries[2].name).toBe("README.md");
      expect(mockClient.execCalls.length).toBe(1);
    });

    it("lists empty directory safely returning totalCount: 0", async () => {
      const result = await tool.execute({ host: "home-server", path: "Belgeler/empty-dir" });

      expect(result.host).toBe("home-server");
      expect(result.path).toBe("Belgeler/empty-dir");
      expect(result.totalCount).toBe(0);
      expect(result.entries).toEqual([]);
    });

    it("rejects listing when target path is a file, not a directory", async () => {
      await expect(
        tool.execute({ host: "home-server", path: "Belgeler/notes.txt" })
      ).rejects.toThrow(/is a file, not a directory/i);

      expect(mockClient.disconnectCalls).toBe(1);
    });

    it("rejects symlinks pointing outside the sandbox root", async () => {
      await expect(
        tool.execute({ host: "home-server", path: "Belgeler/external-link" })
      ).rejects.toThrow(/outside the permitted.*sandbox/i);

      expect(mockClient.disconnectCalls).toBe(1);
    });

    it("rejects path traversal attempts prior to remote operations", async () => {
      const badPaths = [
        "../",
        "../../",
        "/etc",
        "/var/log",
        "/home/baris",
        "Belgeler/../.ssh"
      ];

      for (const badPath of badPaths) {
        await expect(
          tool.execute({ host: "home-server", path: badPath })
        ).rejects.toThrow(/outside the permitted|Path traversal/i);
      }
    });

    it("rejects unapproved remote hosts", async () => {
      await expect(
        tool.execute({ host: "evil-server", path: "Belgeler" })
      ).rejects.toThrow(/not recognized or permitted/i);
    });

    it("does not leak private keys, secrets, or internal server IPs in output", async () => {
      const result = await tool.execute({ host: "home-server", path: "Belgeler" });
      const serialized = JSON.stringify(result);

      expect(serialized).not.toContain("100.108.234.65");
      expect(serialized).not.toContain("100.64.0.53");
      expect(serialized).not.toContain("privateKey");
      expect(serialized).not.toContain("id_ed25519");
    });
  });
});
