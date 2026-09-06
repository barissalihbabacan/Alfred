import { describe, it, expect, beforeEach } from "vitest";
import { SSHConnectionManager } from "../../src/alfred/execution-plane/ssh/ssh-connection-manager.js";
import { MockSSHClient } from "../../src/alfred/execution-plane/ssh/mock-ssh-client.js";
import { getSSHConfig } from "../../src/core/config/ssh.config.js";

describe("SSHConnectionManager Suite", () => {
  let mockClient: MockSSHClient;
  let manager: SSHConnectionManager;

  beforeEach(() => {
    mockClient = new MockSSHClient("success", 5);
    manager = new SSHConnectionManager({
      clientFactory: () => mockClient,
      config: getSSHConfig()
    });
  });

  describe("verifyConnection", () => {
    it("successfully connects, measures latency, and disconnects immediately", async () => {
      const result = await manager.verifyConnection("home-server");

      expect(result.status).toBe("connected");
      expect(result.host).toBe("home-server");
      expect(result.message).toContain("Successfully connected");
      expect(typeof result.latencyMs).toBe("number");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);

      // Verify client lifecycle
      expect(mockClient.connectCalls.length).toBe(1);
      expect(mockClient.connectCalls[0].id).toBe("home-server");
      expect(mockClient.disconnectCalls).toBe(1);
      expect(mockClient.isConnected()).toBe(false);
    });

    it("resolves approved aliases like dev-sunucum to home-server", async () => {
      const result = await manager.verifyConnection("dev-sunucum");

      expect(result.status).toBe("connected");
      expect(result.host).toBe("home-server");
      expect(mockClient.connectCalls.length).toBe(1);
      expect(mockClient.disconnectCalls).toBe(1);
    });

    it("rejects unapproved hosts without attempting connection", async () => {
      await expect(manager.verifyConnection("unauthorized-box")).rejects.toThrow(
        /not recognized or permitted/i
      );

      expect(mockClient.connectCalls.length).toBe(0);
      expect(mockClient.disconnectCalls).toBe(0);
    });

    it("rejects empty or invalid host input", async () => {
      await expect(manager.verifyConnection("")).rejects.toThrow(/Invalid host parameter/i);
      await expect(manager.verifyConnection("   ")).rejects.toThrow(/Invalid host parameter/i);
      await expect(manager.verifyConnection(null as any)).rejects.toThrow(/Invalid host parameter/i);
    });

    it("handles connection timeouts and ensures disconnect is called", async () => {
      mockClient.behavior = "timeout";

      await expect(manager.verifyConnection("home-server")).rejects.toThrow(/timed out/i);
      expect(mockClient.connectCalls.length).toBe(1);
      expect(mockClient.disconnectCalls).toBe(1);
    });

    it("handles authentication failures and ensures disconnect is called", async () => {
      mockClient.behavior = "auth_failure";

      await expect(manager.verifyConnection("home-server")).rejects.toThrow(/Authentication failed/i);
      expect(mockClient.connectCalls.length).toBe(1);
      expect(mockClient.disconnectCalls).toBe(1);
    });

    it("handles connection refused and ensures disconnect is called", async () => {
      mockClient.behavior = "connection_refused";

      await expect(manager.verifyConnection("home-server")).rejects.toThrow(/Connection refused/i);
      expect(mockClient.connectCalls.length).toBe(1);
      expect(mockClient.disconnectCalls).toBe(1);
    });
  });
});
