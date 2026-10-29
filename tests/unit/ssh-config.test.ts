import { describe, it, expect, vi } from "vitest";
import {
  getSSHConfig,
  normalizeHostId,
  resolveSSHHost,
  isHostAllowed
} from "../../src/core/config/ssh.config.js";

describe("SSH Configuration & Allowlist Suite", () => {
  describe("getSSHConfig", () => {
    it("provides default timeout and home-server host configuration", () => {
      const config = getSSHConfig();
      expect(config.defaultTimeoutMs).toBeGreaterThanOrEqual(1000);
      expect(config.hosts["home-server"]).toBeDefined();

      const homeServer = config.hosts["home-server"];
      expect(homeServer.id).toBe("home-server");
      expect(homeServer.hostname).toBeTruthy();
      expect(homeServer.port).toBe(22);
      expect(homeServer.username).toBeTruthy();
      expect(homeServer.authMethod).toBe("privateKey");
    });

    it("parses custom hosts dynamically if SSH_HOSTS_JSON is configured", () => {
      const originalEnv = process.env.SSH_HOSTS_JSON;
      try {
        process.env.SSH_HOSTS_JSON = JSON.stringify({
          "staging-box": {
            hostname: "192.168.10.50",
            username: "deploy",
            port: 2222
          }
        });
        const config = getSSHConfig();
        expect(config.hosts["staging-box"]).toBeDefined();
        expect(config.hosts["staging-box"].hostname).toBe("192.168.10.50");
        expect(config.hosts["staging-box"].port).toBe(2222);
        expect(config.hosts["staging-box"].username).toBe("deploy");
      } finally {
        process.env.SSH_HOSTS_JSON = originalEnv;
      }
    });
  });

  describe("normalizeHostId", () => {
    it("handles casing, trimming, whitespace, and punctuation", () => {
      expect(normalizeHostId("  Home-Server  ")).toBe("home-server");
      expect(normalizeHostId("DEV_SUNUCUM")).toBe("dev-sunucum");
      expect(normalizeHostId("MacBook.Pro")).toBe("macbook-pro");
      expect(normalizeHostId("  dev   sunucum  ")).toBe("dev sunucum");
      expect(normalizeHostId("")).toBe("");
    });
  });

  describe("resolveSSHHost and isHostAllowed", () => {
    it("resolves canonical home-server and known aliases", () => {
      const homeAliases = [
        "home-server",
        "home server",
        "homeserver",
        "dev-sunucum",
        "dev sunucum",
        "devsunucum"
      ];

      for (const alias of homeAliases) {
        const resolved = resolveSSHHost(alias);
        expect(resolved).not.toBeNull();
        expect(resolved?.id).toBe("home-server");
        expect(isHostAllowed(alias)).toBe(true);
      }
    });

    it("takes the home-server address from env, never from the model", () => {
      vi.stubEnv("SSH_HOME_SERVER_HOSTNAME", "100.64.0.42");
      vi.stubEnv("SSH_HOME_SERVER_USERNAME", "owner");
      try {
        const resolved = resolveSSHHost("Home Server");
        expect(resolved?.hostname).toBe("100.64.0.42");
        expect(resolved?.username).toBe("owner");
        // The address itself is not an approved identifier.
        expect(resolveSSHHost("100.64.0.42")).toBeNull();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("resolves extra hosts from SSH_HOSTS_JSON by their id only", () => {
      vi.stubEnv("SSH_HOSTS_JSON", JSON.stringify({ NAS: { hostname: "nas.lan", username: "me" } }));
      try {
        expect(resolveSSHHost("nas")?.hostname).toBe("nas.lan");
        expect(isHostAllowed("nas.lan")).toBe(false);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("rejects unauthorized, arbitrary, or unlisted hosts", () => {
      const invalidHosts = [
        "unknown-server",
        "192.168.1.100",
        "100.64.0.42", // Direct IP is disallowed: only approved logical identifiers
        "macbook-pro",
        "localhost",
        "google.com",
        "aws-ec2",
        "",
        "   "
      ];

      for (const invalid of invalidHosts) {
        expect(resolveSSHHost(invalid)).toBeNull();
        expect(isHostAllowed(invalid)).toBe(false);
      }
    });
  });
});
