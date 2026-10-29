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
        "system_info",
        "docker_ps",
        "docker_logs",
        "docker_restart"
      ]);
      expect(props.args.type).toBe("object");
    });
  });

  describe("Command Whitelist Validation & Shell Injection Rejection", () => {
    it("accepts all strictly whitelisted commands", () => {
      const allowed = [
        "list_directory",
        "disk_usage",
        "current_directory",
        "identity",
        "system_info",
        "docker_ps"
      ];
      for (const cmd of allowed) {
        const val = tool.validateArgs({ host: "home-server", command: cmd });
        expect(val.valid).toBe(true);
      }
      // docker_logs and docker_restart require container name
      const logsVal = tool.validateArgs({
        host: "home-server",
        command: "docker_logs",
        args: { container: "jellyfin" }
      });
      expect(logsVal.valid).toBe(true);

      const restartVal = tool.validateArgs({
        host: "home-server",
        command: "docker_restart",
        args: { container: "n8n" }
      });
      expect(restartVal.valid).toBe(true);
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

    it("ignores a raw string args parameter: nothing from it reaches the command", () => {
      // Production ignores args for every command but list_directory, and
      // reads only args.path there, so a string is accepted and dropped.
      const val = tool.validateArgs({
        host: "home-server",
        command: "disk_usage",
        args: "-h; rm -rf /"
      });

      expect(val.valid).toBe(true);
      expect(val.parsedArgs).toEqual({ host: "home-server", command: "disk_usage", args: {} });

      const listing = tool.validateArgs({
        host: "home-server",
        command: "list_directory",
        args: "../../etc; rm -rf /"
      });
      expect(listing.valid).toBe(true);
      expect(listing.parsedArgs?.args).toEqual({ path: "Belgeler" });
    });

    it("uses production's text for a missing, non-string or padded command", () => {
      const allowed = "list_directory, disk_usage, current_directory, identity, system_info, docker_ps, docker_logs, docker_restart";
      for (const [command, shown] of [
        [undefined, "undefined"],
        [null, "null"],
        [42, "42"],
        [" disk_usage", " disk_usage"],
        ["DISK_USAGE", "DISK_USAGE"]
      ] as const) {
        expect(tool.validateArgs({ host: "home-server", command })).toEqual({
          valid: false,
          error: `Command '${shown}' is not permitted. Only strictly whitelisted commands (${allowed}) may be executed.`
        });
      }
    });
  });

  describe("Filesystem Sandbox Validation in list_directory Command", () => {
    it("rejects path traversal attempts before reaching SSH layer", () => {
      const badPaths = [
        "../",
        "../../etc",
        "/etc",
        "/var/log",
        "/home/alfred",
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
      expect(result.currentDirectory).toBe("/home/alfred");
      expect(mockClient.execCalls).toEqual(["pwd"]);
    });

    it("executes identity returning whoami", async () => {
      const result = await tool.execute({
        host: "home-server",
        command: "identity"
      });

      expect(result.host).toBe("home-server");
      expect(result.command).toBe("identity");
      expect(result.user).toBe("alfred");
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

    it("executes docker_ps returning container status list", async () => {
      const result = await tool.execute({
        host: "home-server",
        command: "docker_ps",
        args: { all: true }
      });

      expect(result.host).toBe("home-server");
      expect(result.command).toBe("docker_ps");
      expect(result.output).toContain("jellyfin");
      expect(mockClient.execCalls).toEqual(["LC_ALL=C docker ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'"]);
    });

    it("executes docker_logs returning logs for specified container", async () => {
      const result = await tool.execute({
        host: "home-server",
        command: "docker_logs",
        args: { container: "jellyfin", lines: 100 }
      });

      expect(result.host).toBe("home-server");
      expect(result.command).toBe("docker_logs");
      expect(result.container).toBe("jellyfin");
      expect(result.logs).toContain("Server started successfully");
      expect(mockClient.execCalls).toEqual(["LC_ALL=C docker logs --tail 100 'jellyfin'"]);
    });

    it("executes docker_restart restarting the container", async () => {
      const result = await tool.execute({
        host: "home-server",
        command: "docker_restart",
        args: { container: "n8n" }
      });

      expect(result.host).toBe("home-server");
      expect(result.command).toBe("docker_restart");
      expect(result.container).toBe("n8n");
      expect(result.output).toBe("n8n");
      expect(mockClient.execCalls).toEqual(["LC_ALL=C docker restart 'n8n'"]);
    });
  });

  describe("Docker Command Argument Validation", () => {
    it("validates docker_ps with optional all flag", () => {
      const validWithoutArgs = tool.validateArgs({ host: "home-server", command: "docker_ps" });
      expect(validWithoutArgs.valid).toBe(true);

      const validWithAll = tool.validateArgs({
        host: "home-server",
        command: "docker_ps",
        args: { all: true }
      });
      expect(validWithAll.valid).toBe(true);
      expect(validWithAll.parsedArgs?.args).toEqual({ all: true });
    });

    it("validates docker_logs container and lines", () => {
      const valid = tool.validateArgs({
        host: "home-server",
        command: "docker_logs",
        args: { container: "jellyfin", lines: 50 }
      });
      expect(valid.valid).toBe(true);
      expect(valid.parsedArgs?.args).toEqual({ container: "jellyfin", lines: 50 });

      const missingContainer = tool.validateArgs({
        host: "home-server",
        command: "docker_logs"
      });
      expect(missingContainer.valid).toBe(false);
      expect(missingContainer.error).toContain("Invalid container name");
    });

    it("rejects shell injection in container name for docker_logs and docker_restart", () => {
      const badContainers = [
        "jellyfin; rm -rf /",
        "n8n && whoami",
        "$(whoami)",
        "`id`",
        "container|cat",
        "../etc",
        "-v",
        " "
      ];

      for (const container of badContainers) {
        const logsResult = tool.validateArgs({
          host: "home-server",
          command: "docker_logs",
          args: { container }
        });
        expect(logsResult.valid).toBe(false);

        const restartResult = tool.validateArgs({
          host: "home-server",
          command: "docker_restart",
          args: { container }
        });
        expect(restartResult.valid).toBe(false);
      }
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
