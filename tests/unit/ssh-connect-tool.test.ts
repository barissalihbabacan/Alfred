import { describe, it, expect } from "vitest";
import { SSHConnectTool } from "../../src/ai/tools/ssh/ssh-connect.tool.js";
import { SSH_CONNECT_TOOL_DEFINITION } from "../../src/ai/tools/ssh/ssh-tool-definitions.js";
import { SSHConnectionManager } from "../../src/alfred/execution-plane/ssh/ssh-connection-manager.js";
import { MockSSHClient } from "../../src/alfred/execution-plane/ssh/mock-ssh-client.js";
import { PermissionLevel } from "../../src/alfred/control-plane/permission-system/types.js";
import { getSSHConfig } from "../../src/core/config/ssh.config.js";

describe("SSHConnectTool Suite", () => {
  const createTestTool = (mockClient: MockSSHClient) => {
    const manager = new SSHConnectionManager({
      clientFactory: () => mockClient,
      config: getSSHConfig()
    });
    return new SSHConnectTool(manager);
  };

  describe("Tool Definition & Metadata", () => {
    const defaultTool = new SSHConnectTool();

    it("exposes correct tool name, description, and EXECUTE permission level", () => {
      expect(defaultTool.name).toBe("ssh_connect");
      expect(defaultTool.permissionLevel).toBe(PermissionLevel.EXECUTE);
      expect(defaultTool.description).toContain("SSH");
    });

    it("generates OpenAI/Ollama compatible ToolDefinition", () => {
      const def = defaultTool.getDefinition();
      expect(def.type).toBe("function");
      expect(def.function.name).toBe("ssh_connect");
      expect(def.function.parameters.type).toBe("object");
      expect(def.function.parameters.properties.host).toBeDefined();
      expect(def.function.parameters.required).toEqual(["host"]);
      // Production's definition, which sets no additionalProperties.
      expect(def).toEqual(SSH_CONNECT_TOOL_DEFINITION);
    });
  });

  describe("Argument Validation", () => {
    const defaultTool = new SSHConnectTool();

    it("accepts valid host argument object", () => {
      const valid = defaultTool.validateArgs({ host: "home-server" });
      expect(valid.valid).toBe(true);
      expect(valid.parsedArgs).toEqual({ host: "home-server" });
    });

    it("trims whitespace from host argument", () => {
      const valid = defaultTool.validateArgs({ host: "  dev-sunucum  " });
      expect(valid.valid).toBe(true);
      expect(valid.parsedArgs).toEqual({ host: "dev-sunucum" });
    });

    it("defaults a missing or empty host to 'home-server', as production does", () => {
      for (const args of [{}, { host: "" }, { host: null }, { host: 0 }, null, undefined, "home-server"]) {
        const val = defaultTool.validateArgs(args);
        expect(val.valid).toBe(true);
        expect(val.parsedArgs).toEqual({ host: "home-server" });
      }
    });

    it("rejects a whitespace-only or non-string host (no registry alias can match)", () => {
      expect(defaultTool.validateArgs({ host: "   " }).valid).toBe(false);
      expect(defaultTool.validateArgs({ host: 123 }).valid).toBe(false);
      expect(defaultTool.validateArgs({ host: ["home-server"] }).valid).toBe(false);
    });
  });

  describe("Execution", () => {
    it("executes successfully and returns structured verification result", async () => {
      const mockClient = new MockSSHClient("success");
      const tool = createTestTool(mockClient);

      const result = await tool.execute({ host: "home-server" });
      expect(result.status).toBe("connected");
      expect(result.host).toBe("home-server");
      expect(result.message).toBe(
        "Successfully connected to host 'home-server'. All credentials and handshakes are verified."
      );
      expect(typeof result.latencyMs).toBe("number");

      // Verify no sensitive keys or raw host IPs leaked
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("100.108.234.65");
      expect(serialized).not.toContain("100.64.0.53");
      expect(serialized).not.toContain("privateKey");
      expect(serialized).not.toContain("id_ed25519");
    });

    it("throws error when remote connection fails", async () => {
      const mockClient = new MockSSHClient("auth_failure");
      const tool = createTestTool(mockClient);

      await expect(tool.execute({ host: "home-server" })).rejects.toThrow(
        /Authentication failed/i
      );
    });
  });
});
