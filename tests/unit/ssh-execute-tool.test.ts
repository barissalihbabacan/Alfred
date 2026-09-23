import { describe, it, expect, beforeEach } from "vitest";
import { SSHExecuteTool } from "../../src/ai/tools/ssh/ssh-execute.tool.js";
import { SSHConnectionManager } from "../../src/alfred/execution-plane/ssh/ssh-connection-manager.js";
import { MockSSHClient } from "../../src/alfred/execution-plane/ssh/mock-ssh-client.js";
import { PermissionLevel } from "../../src/alfred/control-plane/permission-system/types.js";
import { getSSHConfig } from "../../src/core/config/ssh.config.js";

describe("SSHExecuteTool Unit Suite", () => {
  let mockClient: MockSSHClient;
  let manager: SSHConnectionManager;
  let tool: SSHExecuteTool;

  beforeEach(() => {
    mockClient = new MockSSHClient("success");
    manager = new SSHConnectionManager({
      clientFactory: () => mockClient,
      config: getSSHConfig()
    });
    tool = new SSHExecuteTool(manager);
  });

  describe("Tool Contract & Permissions", () => {
    it("declares name, description, and SAFE_READ permission level", () => {
      expect(tool.name).toBe("ssh_execute");
      expect(tool.permissionLevel).toBe(PermissionLevel.SAFE_READ);
      expect(tool.description).toContain("whitelisted");
    });

    it("declares parameter schema with command enum and structured args", () => {
      const def = tool.getDefinition();
      expect(def.type).toBe("function");
      expect(def.function.name).toBe("ssh_execute");
      expect(def.function.parameters.required).toEqual(["host", "command"]);

      const props = def.function.parameters.properties;
      expect(props.host).toBeDefined();
      expect(props.command.enum).toEqual([
        "list_directory",
        "disk_usage",
        "current_directory",
        "identity",
        "system_info"
      ]);
      expect(props.args.type).toBe("object");
    });
  });

  describe("Command Whitelist Validation & Shell Injection Rejection", () => {
    it("accepts all 5 strictly whitelisted commands", () => {
      const allowed = ["list_directory", "disk_usage", "current_directory", "identity", "system_info"];
      for (const cmd of allowed) {
        const val = tool.validateArgs({ host: "home-server", command: cmd });
        expect(val.valid).toBe(true);
      }
    });

    it("rejects dangerous destructive commands before reaching SSH layer", () => {
      const dangerous = [
        "rm",
        "rm -rf /",
        "sudo",
        "reboot",
        "shutdown",
        "chmod",
        "chown",
        "mv",
        "cp",
        "curl",
        "wget",
        "bash",
        "sh",
        "zsh",
        "python",
        "node",
        "npm",
        "git",
        "docker"
      ];

      for (const cmd of dangerous) {
        const val = tool.validateArgs({ host: "home-server", command: cmd });
        expect(val.valid).toBe(false);
        expect(val.error).toMatch(/not permitted.*whitelisted/i);
      }

      // Guarantee that malicious commands never touched SSH
      expect(mockClient.execCalls.length).toBe(0);
      expect(mockClient.connectCalls.length).toBe(0);
    });

    it("rejects shell injection syntax before reaching SSH layer", () => {
      const injections = [
        "list_directory; rm -rf /",
        "ls; rm -rf /",
        "ls && whoami",
        "$(whoami)",
        "`whoami`",
        "echo hello | sh",
        "cat /etc/passwd",
        "ls > /tmp/out"
      ];

      for (const cmd of injections) {
        const val = tool.validateArgs({ host: "home-server", command: cmd });
        expect(val.valid).toBe(false);
        expect(val.error).toMatch(/not permitted.*whitelisted/i);
      }

      expect(mockClient.execCalls.length).toBe(0);
    });

    it("rejects raw string argument for args parameter", () => {
      const val = tool.validateArgs({
        host: "home-server",
        command: "disk_usage",
        args: "-h; rm -rf /"
      });

      expect(val.valid).toBe(false);
      expect(val.error).toContain("structured key-value object");
    });
  });

  describe("Filesystem Sandbox Validation in list_directory Command", () => {
    it("rejects path traversal attempts before reaching SSH layer", () => {
      const badPaths = [
        "../",
        "../../etc",
        "/etc",
        "/var/log",
        "/home/baris",
        "Belgeler/../.ssh",
        "Belgeler/%2e%2e/secret",
        "Belgeler/\0invalid"
      ];

      for (const badPath of badPaths) {
        const val = tool.validateArgs({
          host: "home-server",
          command: "list_directory",
          args: { path: badPath }
        });
        expect(val.valid).toBe(false);
        expect(val.error).toMatch(/outside the permitted|traversal|null byte/i);
      }

      expect(mockClient.execCalls.length).toBe(0);
    });

    it("rejects symlink escape outside sandbox during execution", async () => {
      await expect(
        tool.execute({
          host: "home-server",
          command: "list_directory",
          args: { path: "Belgeler/external-link" }
        })
      ).rejects.toThrow(/outside the permitted.*sandbox/i);

      expect(mockClient.disconnectCalls).toBe(1);
    });
  });

  describe("Successful Controlled Executions", () => {
    it("executes list_directory returning structured DirectoryEntry records", async () => {
      const result = await tool.execute({
        host: "home-server",
        command: "list_directory",
        args: { path: "Belgeler" }
      });

      expect(result.host).toBe("home-server");
      expect(result.path).toBe("Belgeler");
      expect(result.totalCount).toBe(4);
      expect(result.entries.length).toBe(4);
      expect(result.entries[0]).toMatchObject({ name: "docs", type: "directory" });
      expect(result.entries[1]).toMatchObject({ name: "project", type: "directory" });

      expect(mockClient.execCalls.length).toBe(1);
      expect(mockClient.execCalls[0]).toContain("ls -la");
      expect(mockClient.disconnectCalls).toBe(1);
      expect(mockClient.isConnected()).toBe(false);
    });

    it("executes disk_usage returning df -h output", async () => {
      const result = await tool.execute({
        host: "home-server",
        command: "disk_usage",
        args: {}
      });

      expect(result.host).toBe("home-server");
      expect(result.command).toBe("disk_usage");
      expect(result.output).toContain("Filesystem");
      expect(mockClient.execCalls[0]).toContain("df -h");
      expect(mockClient.disconnectCalls).toBe(1);
    });

    it("executes current_directory returning pwd", async () => {
      const result = await tool.execute({
        host: "home-server",
        command: "current_directory"
      });

      expect(result.host).toBe("home-server");
      expect(result.command).toBe("current_directory");
      expect(result.currentDirectory).toBe("/home/baris");
      expect(mockClient.execCalls).toEqual(["pwd"]);
    });

    it("executes identity returning whoami", async () => {
      const result = await tool.execute({
        host: "home-server",
        command: "identity"
      });

      expect(result.host).toBe("home-server");
      expect(result.command).toBe("identity");
      expect(result.user).toBe("baris");
      expect(mockClient.execCalls).toEqual(["whoami"]);
    });

    it("executes system_info returning uname -a", async () => {
      const result = await tool.execute({
        host: "home-server",
        command: "system_info"
      });

      expect(result.host).toBe("home-server");
      expect(result.command).toBe("system_info");
      expect(result.systemInfo).toContain("Linux");
      expect(mockClient.execCalls).toEqual(["uname -a"]);
    });
  });

  describe("Host Allowlist Enforcements", () => {
    it("rejects unapproved remote hosts", async () => {
      await expect(
        tool.execute({ host: "untrusted-server", command: "disk_usage" })
      ).rejects.toThrow(/not recognized or permitted/i);

      expect(mockClient.execCalls.length).toBe(0);
    });
  });
});
