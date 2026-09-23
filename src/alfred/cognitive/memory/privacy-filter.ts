/**
 * Privacy and Secret Filter for B.U.T.L.E.R. Alfred Memory System
 *
 * Scans candidate memory content and rejects any items containing API keys,
 * passwords, private keys, bearer tokens, or sensitive credentials.
 *
 * This is the single filter for both the TypeScript core (MemoryService) and
 * production: functions/index.js imports it and ships it in the esbuild
 * bundle. It rejects everything either of the two former filters rejected,
 * plus the key formats this project actually uses (Groq `gsk_`, Google `AQ.`)
 * and Turkish password phrasing. Keep it dependency-free: it is bundled into
 * Cloud Functions.
 */

export interface PrivacyCheckResult {
  isSafe: boolean;
  reason?: string;
}

// A value that looks like a credential rather than a word: at least 4 chars
// and containing a digit or symbol. Used where there is no explicit ":" / "=".
const CREDENTIAL_LIKE = String.raw`(?=\S*[0-9!@#$%^&*_+=?<>~])\S{4,}`;

export const SENSITIVE_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  {
    name: "Private Key Header",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i
  },
  {
    name: "OpenAI / Anthropic style API Key",
    pattern: /sk-[a-zA-Z0-9_-]{20,}/i
  },
  {
    name: "Groq API Key",
    pattern: /\bgsk_[a-zA-Z0-9]{20,}/
  },
  {
    name: "Google API Key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/
  },
  {
    name: "Google API Key (AQ. format)",
    pattern: /\bAQ\.[A-Za-z0-9_-]{30,}/
  },
  {
    name: "GitHub / GitLab Token",
    pattern: /\b(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{20,}|glpat-[a-zA-Z0-9_-]{20,})/
  },
  {
    name: "Slack Token",
    pattern: /\bxox[baprs]-[0-9a-zA-Z-]{10,}/
  },
  {
    name: "Bearer Token",
    pattern: /\bbearer\s+[a-zA-Z0-9_\-.]{20,}/i
  },
  {
    name: "JSON Web Token",
    pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/
  },
  {
    // Any "password: x" / "password=x", however short (production rule).
    name: "Explicit Password Assignment",
    pattern: /\b(?:password|passwd|pwd)\s*[:=]\s*\S+/i
  },
  {
    name: "Explicit Secret Assignment",
    pattern: /\b(?:secret(?:_key)?|api[_-]?(?:key|secret)|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*['"]?[^\s'"]{6,}/i
  },
  {
    // "my password is hunter22" — only when the value looks like a credential.
    name: "Password Stated in Prose",
    pattern: new RegExp(String.raw`\bpassword\s+(?:is\s+)?` + CREDENTIAL_LIKE, "i")
  },
  {
    // Turkish: "şifrem: hunter22", "parolam hunter22", "şifresi şu: abc123".
    // "şifremi unuttum" and other ordinary sentences stay allowed.
    name: "Turkish Password Statement",
    pattern: new RegExp(
      String.raw`(?:şifre|parola)(?:m|si|sı|miz|niz)?\s*(?::|=|\s+(?:şu|şöyle)\s*:?)\s*\S+|(?:şifre|parola)(?:m|si|sı|miz|niz)?\s+` +
        CREDENTIAL_LIKE,
      "iu"
    )
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
