import { describe, it, expect } from "vitest";
import { LSParser } from "../../src/alfred/execution-plane/ssh/ls-parser.js";

describe("LSParser Unit Suite", () => {
  it("parses full-time ls output with directories and files", () => {
    const raw = [
      "total 24",
      "drwxrwxr-x  15 baris baris 4096 2026-09-06 19:43:03.506103459 +0300 .",
      "drwxr-xr-x  21 baris baris 4096 2026-09-06 17:20:01.817546887 +0300 ..",
      "drwxrwxr-x   4 baris baris 4096 2026-07-10 17:45:40.224251534 +0300 projects",
      "-rw-rw-r--   1 baris baris 1024 2026-09-05 23:41:02.849924596 +0300 notes.txt",
      "lrwxrwxrwx   1 baris baris   11 2026-09-06 12:00:00.000000000 +0300 shortcut -> notes.txt"
    ].join("\n");

    const entries = LSParser.parse(raw);

    expect(entries.length).toBe(3);
    // Deterministic order: directory first, then files alphabetically
    expect(entries[0]).toEqual({
      name: "projects",
      type: "directory",
      modifiedTime: new Date("2026-07-10 17:45:40.224251534 +0300").toISOString()
    });
    expect(entries[1]).toEqual({
      name: "notes.txt",
      type: "file",
      size: 1024,
      modifiedTime: new Date("2026-09-05 23:41:02.849924596 +0300").toISOString()
    });
    expect(entries[2]).toEqual({
      name: "shortcut",
      type: "symlink",
      modifiedTime: new Date("2026-09-06 12:00:00.000000000 +0300").toISOString()
    });
  });

  it("handles filenames with spaces and Turkish characters", () => {
    const raw = [
      "total 16",
      "drwxrwxr-x  3 baris baris 4096 2026-07-10 22:18:21.000000000 +0300 Açık Kaynak",
      "drwxrwxr-x 15 baris baris 4096 2026-09-06 19:43:03.000000000 +0300 B.U.T.L.E.R. Alfred",
      "-rw-r--r--  1 baris baris 2048 2026-08-01 10:00:00.000000000 +0300 my project plan.pdf"
    ].join("\n");

    const entries = LSParser.parse(raw);

    expect(entries.length).toBe(3);
    expect(entries[0].name).toBe("Açık Kaynak");
    expect(entries[0].type).toBe("directory");
    expect(entries[1].name).toBe("B.U.T.L.E.R. Alfred");
    expect(entries[1].type).toBe("directory");
    expect(entries[2].name).toBe("my project plan.pdf");
    expect(entries[2].type).toBe("file");
    expect(entries[2].size).toBe(2048);
  });

  it("parses standard POSIX ls -la output fallback format", () => {
    const raw = [
      "total 8",
      "drwxr-xr-x 2 baris baris 4096 Sep  6 17:20 docs",
      "-rw-r--r-- 1 baris baris  512 Sep  6 17:21 todo.md"
    ].join("\n");

    const entries = LSParser.parse(raw);

    expect(entries.length).toBe(2);
    expect(entries[0]).toMatchObject({ name: "docs", type: "directory" });
    expect(entries[1].name).toBe("todo.md");
    expect(entries[1].type).toBe("file");
    expect(entries[1].size).toBe(512);
  });

  it("filters out '.' and '..' directory entries", () => {
    const raw = [
      "total 4",
      "drwxr-xr-x 2 baris baris 4096 2026-09-01 12:00:00.000000000 +0000 .",
      "drwxr-xr-x 2 baris baris 4096 2026-09-01 12:00:00.000000000 +0000 .."
    ].join("\n");

    const entries = LSParser.parse(raw);
    expect(entries).toEqual([]);
  });

  it("handles empty or blank output gracefully", () => {
    expect(LSParser.parse("")).toEqual([]);
    expect(LSParser.parse("   \n\n  ")).toEqual([]);
    expect(LSParser.parse("total 0")).toEqual([]);
  });
});
