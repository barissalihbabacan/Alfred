import { describe, it, expect } from "vitest";
import { SSHPathSandbox } from "../../src/alfred/execution-plane/ssh/ssh-path-sandbox.js";

describe("SSHPathSandbox Suite", () => {
  describe("validateSandboxPath", () => {
    it("accepts valid root sandbox designations and normalizes to Belgeler", () => {
      const rootCandidates = ["Belgeler", "Belgeler/", "", "Documents", "documents/", "  Belgeler  "];

      for (const candidate of rootCandidates) {
        const result = SSHPathSandbox.validateSandboxPath(candidate);
        expect(result.valid).toBe(true);
        expect(result.normalizedSandboxPath).toBe("Belgeler");
      }
    });

    it("accepts valid subdirectories and files within Belgeler", () => {
      const validSubpaths = [
        { input: "Belgeler/project", expected: "Belgeler/project" },
        { input: "Belgeler/project/src", expected: "Belgeler/project/src" },
        { input: "project/src", expected: "Belgeler/project/src" },
        { input: "notes.txt", expected: "Belgeler/notes.txt" },
        { input: "Belgeler/nested/deep/folder", expected: "Belgeler/nested/deep/folder" },
        { input: "Documents/my-project", expected: "Belgeler/my-project" },
        { input: "home/baris/Belgeler/my-project", expected: "Belgeler/my-project" }
      ];

      for (const { input, expected } of validSubpaths) {
        const result = SSHPathSandbox.validateSandboxPath(input);
        expect(result.valid).toBe(true);
        expect(result.normalizedSandboxPath).toBe(expected);
      }
    });

    it("normalizes redundant slashes, backslashes, and relative dot segments", () => {
      const dirty = "Belgeler//project\\\\src/./sub";
      const result = SSHPathSandbox.validateSandboxPath(dirty);
      expect(result.valid).toBe(true);
      expect(result.normalizedSandboxPath).toBe("Belgeler/project/src/sub");
    });

    it("rejects path traversal attempts using ..", () => {
      const traversalAttempts = [
        "../",
        "../../",
        "Belgeler/../.ssh",
        "Belgeler/../../etc",
        "project/../../etc/passwd",
        "Belgeler/project/../../..",
        "../Belgeler",
        "../../Belgeler"
      ];

      for (const attempt of traversalAttempts) {
        const result = SSHPathSandbox.validateSandboxPath(attempt);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/Path traversal|outside the permitted/i);
      }
    });

    it("rejects absolute paths outside the sandbox root", () => {
      const forbiddenRoots = [
        "/",
        "/etc",
        "/etc/passwd",
        "/var",
        "/var/log",
        "/tmp",
        "/home",
        "/home/baris",
        "/home/baris/.ssh",
        "/usr",
        "/bin",
        "/root"
      ];

      for (const forbidden of forbiddenRoots) {
        const result = SSHPathSandbox.validateSandboxPath(forbidden);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/outside the permitted|Access denied/i);
      }
    });

    it("rejects paths with null byte injection", () => {
      const nullByteAttacks = [
        "Belgeler/project\0/evil",
        "\0/etc",
        "Belgeler\0"
      ];

      for (const attack of nullByteAttacks) {
        const result = SSHPathSandbox.validateSandboxPath(attack);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("null byte");
      }
    });

    it("decodes URI-encoded traversal attempts and rejects them", () => {
      const uriAttacks = [
        "Belgeler/%2e%2e/.ssh",
        "%2e%2e%2f%2e%2e%2fetc",
        "Belgeler/%252e%252e/secret"
      ];

      for (const attack of uriAttacks) {
        const result = SSHPathSandbox.validateSandboxPath(attack);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/Path traversal|outside the permitted/i);
      }
    });

    it("handles null or undefined input safely", () => {
      expect(SSHPathSandbox.validateSandboxPath(null as any).valid).toBe(false);
      expect(SSHPathSandbox.validateSandboxPath(undefined as any).valid).toBe(false);
    });
  });

  describe("isRealpathContained", () => {
    const sandboxRoot = "/home/baris/Belgeler";

    it("returns true when target is identical to sandbox root", () => {
      expect(SSHPathSandbox.isRealpathContained("/home/baris/Belgeler", sandboxRoot)).toBe(true);
      expect(SSHPathSandbox.isRealpathContained("/home/baris/Belgeler/", sandboxRoot)).toBe(true);
    });

    it("returns true for descendants inside the sandbox root", () => {
      expect(SSHPathSandbox.isRealpathContained("/home/baris/Belgeler/project", sandboxRoot)).toBe(true);
      expect(SSHPathSandbox.isRealpathContained("/home/baris/Belgeler/project/src", sandboxRoot)).toBe(true);
      expect(SSHPathSandbox.isRealpathContained("/home/baris/Belgeler/notes.txt", sandboxRoot)).toBe(true);
    });

    it("returns false for targets outside the sandbox root", () => {
      expect(SSHPathSandbox.isRealpathContained("/etc", sandboxRoot)).toBe(false);
      expect(SSHPathSandbox.isRealpathContained("/etc/passwd", sandboxRoot)).toBe(false);
      expect(SSHPathSandbox.isRealpathContained("/home/baris", sandboxRoot)).toBe(false);
      expect(SSHPathSandbox.isRealpathContained("/home/baris/.ssh", sandboxRoot)).toBe(false);
      expect(SSHPathSandbox.isRealpathContained("/tmp", sandboxRoot)).toBe(false);
    });

    it("returns false for prefix collisions (e.g. /home/baris/Belgeler-other)", () => {
      expect(SSHPathSandbox.isRealpathContained("/home/baris/Belgeler-other", sandboxRoot)).toBe(false);
      expect(SSHPathSandbox.isRealpathContained("/home/baris/Belgeler_backup", sandboxRoot)).toBe(false);
    });

    it("handles empty or missing parameters safely", () => {
      expect(SSHPathSandbox.isRealpathContained("", sandboxRoot)).toBe(false);
      expect(SSHPathSandbox.isRealpathContained("/home/baris/Belgeler", "")).toBe(false);
    });
  });
});
