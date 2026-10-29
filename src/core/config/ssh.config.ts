/**
 * B.U.T.L.E.R. Alfred — SSH Configuration & Host Allowlist
 * Defines server-side configuration and strictly controlled host allowlist for SSH connections.
 * Ensures credentials and network endpoints are never exposed to the LLM.
 */

import os from "node:os";
import path from "node:path";

export interface SSHHostConfig {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: "privateKey" | "password" | "agent";
  privateKeyPath?: string;
  privateKey?: string;
  passphrase?: string;
  connectionTimeoutMs: number;
}

export interface SSHConfig {
  defaultTimeoutMs: number;
  hosts: Record<string, SSHHostConfig>;
  aliases: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 7000;

function resolveDefaultHomeKey(): string {
  return path.join(os.homedir(), ".ssh", "id_ed25519");
}

export function getSSHConfig(): SSHConfig {
  const defaultTimeoutMs =
    Number(process.env.SSH_DEFAULT_TIMEOUT_MS) > 0
      ? Number(process.env.SSH_DEFAULT_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;

  // No owner-specific defaults: the hostname falls back to the alias itself,
  // resolved by ~/.ssh/config, /etc/hosts or MagicDNS. Further machines go in
  // SSH_HOSTS_JSON.
  const homeServerHost: SSHHostConfig = {
    id: "home-server",
    name: "Home Development Server (Linux)",
    hostname: process.env.SSH_HOME_SERVER_HOSTNAME?.trim() || "home-server",
    port: Number(process.env.SSH_HOME_SERVER_PORT) || 22,
    username: process.env.SSH_HOME_SERVER_USERNAME?.trim() || process.env.USER || "alfred",
    authMethod: "privateKey",
    privateKeyPath: process.env.SSH_HOME_SERVER_KEY_PATH || resolveDefaultHomeKey(),
    connectionTimeoutMs:
      Number(process.env.SSH_HOME_SERVER_TIMEOUT_MS) > 0
        ? Number(process.env.SSH_HOME_SERVER_TIMEOUT_MS)
        : defaultTimeoutMs
  };

  const hosts: Record<string, SSHHostConfig> = {
    "home-server": homeServerHost
  };

  // Support additional hosts dynamically defined via JSON environment variable
  if (process.env.SSH_HOSTS_JSON) {
    try {
      const parsed = JSON.parse(process.env.SSH_HOSTS_JSON);
      if (typeof parsed === "object" && parsed !== null) {
        for (const [key, val] of Object.entries(parsed)) {
          const v = val as Partial<SSHHostConfig>;
          if (v && v.hostname && v.username) {
            hosts[key.toLowerCase()] = {
              id: key.toLowerCase(),
              name: v.name || key,
              hostname: v.hostname,
              port: Number(v.port) || 22,
              username: v.username,
              authMethod: v.authMethod || "privateKey",
              privateKeyPath: v.privateKeyPath,
              privateKey: v.privateKey,
              passphrase: v.passphrase,
              connectionTimeoutMs: Number(v.connectionTimeoutMs) || defaultTimeoutMs
            };
          }
        }
      }
    } catch {
      // Ignore malformed custom hosts JSON
    }
  }

  // Canonical alias resolution mapping
  const aliases: Record<string, string> = {
    "home-server": "home-server",
    "homeserver": "home-server",
    "home server": "home-server",
    "dev-sunucum": "home-server",
    "dev sunucum": "home-server",
    "devsunucum": "home-server"
  };

  return {
    defaultTimeoutMs,
    hosts,
    aliases
  };
}

/**
 * Normalizes host identifier strings (strips whitespace, lowercase, punctuation).
 */
export function normalizeHostId(host: string): string {
  if (!host || typeof host !== "string") return "";
  return host
    .trim()
    .toLowerCase()
    .replace(/[_.]/g, "-")
    .replace(/\s+/g, " ");
}

/**
 * Resolves a requested logical host name or alias to its server-side SSHHostConfig.
 * Returns null if the host is not registered in the approved allowlist.
 */
export function resolveSSHHost(hostIdentifier: string, customConfig?: SSHConfig): SSHHostConfig | null {
  if (!hostIdentifier || typeof hostIdentifier !== "string") {
    return null;
  }

  const config = customConfig || getSSHConfig();
  const normalized = normalizeHostId(hostIdentifier);

  // 1. Direct match on hosts record
  if (config.hosts[normalized]) {
    return config.hosts[normalized];
  }

  // 2. Direct match with dashes replaced by spaces or vice versa
  const withDashes = normalized.replace(/\s+/g, "-");
  if (config.hosts[withDashes]) {
    return config.hosts[withDashes];
  }

  // 3. Match via alias dictionary
  const aliasedId = config.aliases[normalized] || config.aliases[withDashes];
  if (aliasedId && config.hosts[aliasedId]) {
    return config.hosts[aliasedId];
  }

  return null;
}

/**
 * Checks whether a host identifier belongs to the approved host allowlist.
 */
export function isHostAllowed(hostIdentifier: string, customConfig?: SSHConfig): boolean {
  return resolveSSHHost(hostIdentifier, customConfig) !== null;
}
