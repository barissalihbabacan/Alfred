import { describe, it, expect } from "vitest";
import type { SSHCommandResultMap } from "../../src/alfred/execution-plane/ssh/command-registry.js";
import type { SSHListDirectoryResult } from "../../src/alfred/execution-plane/ssh/ssh-client.interface.js";
import { errorMessage } from "../../src/core/errors/index.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SSHConnectionManager } from "../../src/alfred/execution-plane/ssh/ssh-connection-manager.js";
import { SSHListDirectoryTool } from "../../src/ai/tools/ssh/ssh-list-directory.tool.js";
import { ToolRouter } from "../../src/alfred/control-plane/tool-router/tool-router.js";
import { ToolRegistry } from "../../src/alfred/control-plane/tool-router/tool-registry.js";
import { ToolCall } from "../../src/ai/tools/types.js";

describe("SSH List Directory Integration Suite (Real Home Server)", () => {
  const manager = new SSHConnectionManager();
  const tool = new SSHListDirectoryTool(manager);

  it("lists real Belgeler directory on home-server via SSH exec (no SFTP)", async () => {
    try {
      const result = await tool.execute({
        host: "home-server",
        path: "Belgeler"
      });

      expect(result.host).toBe("home-server");
      expect(result.path).toBe("Belgeler");
      expect(result.totalCount).toBeGreaterThan(0);
      expect(result.entries.length).toBeGreaterThan(0);

      // Verify known folder is present
      const hasAlfred = result.entries.some(
        (e) => e.name === "B.U.T.L.E.R. Alfred" && e.type === "directory"
      );
      expect(hasAlfred).toBe(true);

      // Verify deterministic sorting: all directories precede all files
      let seenNonDir = false;
      for (const entry of result.entries) {
        if (entry.type !== "directory") {
          seenNonDir = true;
        } else if (seenNonDir) {
          // If we see a directory after a non-directory, sorting failed
          expect.unreachable("Found directory entry after non-directory entry in sorted results.");
        }
      }
    } catch (err: unknown) {
      if (/timed out|unreachable|refused/i.test(errorMessage(err))) {
        console.warn("[Integration Note] Home server offline or unreachable:", errorMessage(err));
        return;
      }
      throw err;
    }
  }, 15000);

  it("lists real nested subdirectory Belgeler/B.U.T.L.E.R. Alfred", async () => {
    try {
      const result = await tool.execute({
        host: "home-server",
        path: "Belgeler/B.U.T.L.E.R. Alfred"
      });

      expect(result.host).toBe("home-server");
      expect(result.path).toBe("Belgeler/B.U.T.L.E.R. Alfred");
      expect(result.totalCount).toBeGreaterThan(0);

      const hasPackageJson = result.entries.some(
        (e) => e.name === "package.json" && e.type === "file"
      );
      expect(hasPackageJson).toBe(true);
    } catch (err: unknown) {
      if (/timed out|unreachable|refused/i.test(errorMessage(err))) {
        console.warn("[Integration Note] Home server offline or unreachable:", errorMessage(err));
        return;
      }
      throw err;
    }
  }, 15000);

  it("strictly rejects path traversal attempts against real server", async () => {
    const invalidPaths = [
      "/etc",
      "../",
      "../../",
      "/home/baris",
      "Belgeler/../.ssh",
      "Belgeler/../../etc"
    ];

    for (const badPath of invalidPaths) {
      await expect(
        tool.execute({ host: "home-server", path: badPath })
      ).rejects.toThrow(/outside the permitted|Path traversal/i);
    }
  }, 15000);

  it("strictly rejects symlinks pointing outside the sandbox on real server", async () => {
    const testLinkPath = path.join(os.homedir(), "Belgeler", ".temp_symlink_breakout_test");
    try {
      // Create temporary symlink to /etc
      try {
        fs.symlinkSync("/etc", testLinkPath);
      } catch {
        // If symlink cannot be created, skip test safely
        return;
      }

      await expect(
        tool.execute({
          host: "home-server",
          path: "Belgeler/.temp_symlink_breakout_test"
        })
      ).rejects.toThrow(/Access denied|outside the permitted/i);
    } finally {
      try {
        if (fs.existsSync(testLinkPath)) {
          fs.unlinkSync(testLinkPath);
        }
      } catch {
        // Ignore cleanup error
      }
    }
  }, 15000);

  it("executes end-to-end tool dispatch through ToolRegistry and ToolRouter", async () => {
    const registry = new ToolRegistry();
    const router = new ToolRouter({ registry });

    const toolCall: ToolCall = {
      id: "call_e2e_dir_01",
      type: "function",
      function: {
        name: "ssh_list_directory",
        arguments: JSON.stringify({ host: "home-server", path: "Belgeler" })
      }
    };

    try {
      const toolResult = await router.execute(toolCall, {
        userId: "user_baris",
        userRole: "admin"
      });

      expect(toolResult.success).toBe(true);
      expect(toolResult.toolName).toBe("ssh_list_directory");
      const data = toolResult.data as SSHListDirectoryResult;
      expect(data.host).toBe("home-server");
      expect(data.totalCount).toBeGreaterThan(0);
    } catch (err: unknown) {
      if (/timed out|unreachable|refused/i.test(errorMessage(err))) {
        console.warn("[Integration Note] Home server offline or unreachable:", errorMessage(err));
        return;
      }
      throw err;
    }
  }, 15000);

  it("executes whitelisted ssh_execute commands (disk_usage, identity) on real server", async () => {
    const registry = new ToolRegistry();
    const router = new ToolRouter({ registry });

    try {
      const execCall: ToolCall = {
        id: "call_e2e_exec_01",
        type: "function",
        function: {
          name: "ssh_execute",
          arguments: JSON.stringify({ host: "home-server", command: "disk_usage" })
        }
      };

      const result = await router.execute(execCall, {
        userId: "user_baris",
        userRole: "admin"
      });

      expect(result.success).toBe(true);
      const data = result.data as SSHCommandResultMap["disk_usage"];
      expect(data.command).toBe("disk_usage");
      expect(data.output).toContain("Filesystem");
    } catch (err: unknown) {
      if (/timed out|unreachable|refused/i.test(errorMessage(err))) {
        console.warn("[Integration Note] Home server offline or unreachable:", errorMessage(err));
        return;
      }
      throw err;
    }
  }, 15000);
});

