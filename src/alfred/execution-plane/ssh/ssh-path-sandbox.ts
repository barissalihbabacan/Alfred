/**
 * B.U.T.L.E.R. Alfred — SSH Filesystem Sandbox & Path Validator
 * Strictly confines remote filesystem operations to the approved "Belgeler/" sandbox root.
 * Protects against path traversal, absolute path escape, URL encoding tricks, and symlink breakouts.
 */

import path from "node:path";
import { errorMessage } from "../../../core/errors/index.js";

export const SANDBOX_ROOT_NAME = "Belgeler";

export interface PathValidationResult {
  valid: boolean;
  /**
   * Sanitized normalized path relative to the remote user root or sandbox.
   * Always begins with "Belgeler" (e.g. "Belgeler" or "Belgeler/subfolder").
   */
  normalizedSandboxPath?: string;
  error?: string;
}

export class SSHPathSandbox {
  /**
   * Normalizes a raw input path by removing null bytes, decoding URI components,
   * converting backslashes, and removing duplicate slashes.
   */
  public static sanitizeRawPath(rawPath: string): string {
    if (!rawPath || typeof rawPath !== "string") {
      return "";
    }

    // Reject or strip null bytes immediately
    if (rawPath.includes("\0")) {
      throw new Error("Path contains illegal null byte characters.");
    }

    // Iteratively decode URI components to thwart double-encoding (e.g. %252e%252e)
    let decoded = rawPath;
    try {
      let prev = "";
      let iterations = 0;
      while (decoded !== prev && iterations < 3) {
        prev = decoded;
        decoded = decodeURIComponent(decoded);
        iterations++;
      }
    } catch {
      // If URI malformed, keep current decoded string
    }

    // Normalize slashes
    return decoded.replace(/\\/g, "/").trim();
  }

  /**
   * Validates that a requested path strictly resides within the "Belgeler/" sandbox.
   * Performs lexical analysis before any filesystem operations occur.
   */
  public static validateSandboxPath(rawPath: string): PathValidationResult {
    if (rawPath === undefined || rawPath === null) {
      return {
        valid: false,
        error: "Missing required argument 'path'."
      };
    }

    let sanitized: string;
    try {
      sanitized = this.sanitizeRawPath(rawPath);
    } catch (err: unknown) {
      return {
        valid: false,
        error: `Invalid path: ${errorMessage(err)}`
      };
    }

    if (!sanitized) {
      // Empty path defaults to sandbox root "Belgeler"
      return {
        valid: true,
        normalizedSandboxPath: SANDBOX_ROOT_NAME
      };
    }

    // 1. Handle absolute paths or home paths: reject any path outside the sandbox
    if (sanitized.startsWith("/") || sanitized.startsWith("home/")) {
      const withoutSlash = sanitized.replace(/^\/+/, "");
      if (withoutSlash === SANDBOX_ROOT_NAME || withoutSlash.startsWith(`${SANDBOX_ROOT_NAME}/`)) {
        sanitized = withoutSlash;
      } else if (withoutSlash.startsWith("home/")) {
        const parts = withoutSlash.split("/");
        // e.g. parts[0]='home', parts[1]='alfred', parts[2]='Belgeler'
        if (parts.length >= 3 && parts[2] === SANDBOX_ROOT_NAME) {
          sanitized = parts.slice(2).join("/");
        } else {
          return {
            valid: false,
            error: `Access denied: Path '${rawPath}' is outside the permitted '${SANDBOX_ROOT_NAME}/' sandbox.`
          };
        }
      } else {
        return {
          valid: false,
          error: `Access denied: Path '${rawPath}' is outside the permitted '${SANDBOX_ROOT_NAME}/' sandbox.`
        };
      }
    }

    // 2. Traversal checks: reject any path containing ".." that escapes or is not prefixed by Belgeler
    if (sanitized.split("/").some((segment) => segment === "..")) {
      const testNormalized = path.posix.normalize(sanitized);
      if (
        testNormalized.startsWith("..") ||
        testNormalized === "." ||
        testNormalized === "/" ||
        (testNormalized !== SANDBOX_ROOT_NAME && !testNormalized.startsWith(`${SANDBOX_ROOT_NAME}/`))
      ) {
        return {
          valid: false,
          error: `Path traversal detected: Path '${rawPath}' attempts to escape the sandbox.`
        };
      }
    }

    // 3. Map "Documents" or "documents" to "Belgeler"
    let candidatePath = sanitized;
    if (candidatePath.toLowerCase().startsWith("documents/")) {
      candidatePath = SANDBOX_ROOT_NAME + candidatePath.slice("documents".length);
    } else if (candidatePath.toLowerCase() === "documents") {
      candidatePath = SANDBOX_ROOT_NAME;
    }

    // 4. Ensure sandbox root prefix
    if (!candidatePath.startsWith(SANDBOX_ROOT_NAME)) {
      candidatePath = `${SANDBOX_ROOT_NAME}/${candidatePath}`;
    }

    // 5. Canonicalize with posix.normalize and strip trailing slashes
    const normalized = path.posix.normalize(candidatePath).replace(/\/+$/, "") || SANDBOX_ROOT_NAME;

    // 6. Strict final boundary check
    if (normalized !== SANDBOX_ROOT_NAME && !normalized.startsWith(`${SANDBOX_ROOT_NAME}/`)) {
      return {
        valid: false,
        error: `Access denied: Path '${rawPath}' resolves outside the permitted '${SANDBOX_ROOT_NAME}/' sandbox.`
      };
    }

    return {
      valid: true,
      normalizedSandboxPath: normalized
    };
  }

  /**
   * Programmatically verifies that a real resolved target path (after following symlinks)
   * strictly resides within the real sandbox root path.
   */
  public static isRealpathContained(realTargetPath: string, realSandboxRoot: string): boolean {
    if (!realTargetPath || !realSandboxRoot) return false;

    const normalizedTarget = path.resolve(realTargetPath);
    const normalizedRoot = path.resolve(realSandboxRoot);

    if (normalizedTarget === normalizedRoot) {
      return true;
    }

    // Target must be a descendant of root: starts with root + separator
    const rootPrefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
    return normalizedTarget.startsWith(rootPrefix);
  }
}
