/**
 * Privacy and Secret Filter for B.U.T.L.E.R. Alfred Memory System
 *
 * Scans candidate memory content and rejects any items containing API keys,
 * passwords, private keys, bearer tokens, or sensitive credentials.
 */

export interface PrivacyCheckResult {
  isSafe: boolean;
  reason?: string;
}

const SENSITIVE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "Private Key Header",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i
  },
  {
    name: "OpenAI / Claude / Cloud API Key",
    pattern: /\b(?:sk-[a-zA-Z0-9_\-]{20,}|AIza[0-9A-Za-z-_]{35})\b/
  },
  {
    name: "GitHub / GitLab Token",
    pattern: /\b(?:ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9_-]{20,})\b/
  },
  {
    name: "Slack Token",
    pattern: /\bxox[baprs]-[0-9a-zA-Z]{10,}/
  },
  {
    name: "Bearer / Auth Token",
    pattern: /\b(?:bearer\s+[a-zA-Z0-9_\-\.]{25,}|eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,})\b/i
  },
  {
    name: "Explicit Password Assignment",
    pattern: /\b(?:password|passwd|secret_key|api_secret|access_token)\s*[:=]\s*['"]?[^\s'"]{6,}['"]?/i
  }
];

export class PrivacyFilter {
  /**
   * Evaluates text for sensitive tokens, credentials, and secrets.
   */
  public static check(text: string): PrivacyCheckResult {
    if (!text || typeof text !== "string") {
      return { isSafe: true };
    }

    for (const item of SENSITIVE_PATTERNS) {
      if (item.pattern.test(text)) {
        return {
          isSafe: false,
          reason: `Contains sensitive pattern (${item.name})`
        };
      }
    }

    return { isSafe: true };
  }
}
