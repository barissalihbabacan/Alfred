/**
 * B.U.T.L.E.R. Alfred — LS Parser
 * Parses output from remote `ls -la` / `ls -la --full-time` executions into structured DirectoryEntry arrays.
 * Handles spaces in filenames, unicode/Turkish characters, symlinks, file sizes, and timestamps.
 * Enforces deterministic sorting: directories first, then files alphabetically.
 */

import { DirectoryEntry, FileType } from "./ssh-client.interface.js";

// Matches `LC_ALL=C ls -la --full-time`
// Columns: permissions, links, owner, group, size, YYYY-MM-DD HH:MM:SS.NNNNNNNNN +ZZZZ, name
// Permission column: a file-type letter and nine mode letters, including the
// setuid/setgid/sticky forms (s S t T), optionally followed by the ACL "+",
// SELinux "." or macOS "@" marker ("drwxrwxr-x+", "drwxrwxrwt", "-rw-r--r--.").
const FULL_TIME_REGEX =
  /^([-dlbcpsD][-rwxsStTl]{9})[+.@]?\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\s+[+-]?\d{4})\s+(.+)$/;

// Matches standard POSIX `ls -la`
// Columns: permissions, links, owner, group, size, Month Day (Time or Year), name
const STANDARD_LS_REGEX =
  /^([-dlbcpsD][-rwxsStTl]{9})[+.@]?\s+\d+\s+\S+\s+\S+\s+(\d+)\s+([A-Za-z]{3}\s+\d+\s+[\d:]{4,5})\s+(.+)$/;

export class LSParser {
  /**
   * Parses raw `ls -la` or `ls -la --full-time` stdout into structured DirectoryEntry items.
   */
  public static parse(output: string): DirectoryEntry[] {
    if (!output || typeof output !== "string") {
      return [];
    }

    const lines = output.split(/\r?\n/);
    const entries: DirectoryEntry[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip empty lines, summary lines ("total 84", "toplam 84"), or dividers
      if (!trimmed || /^total\s+\d+/i.test(trimmed) || /^toplam\s+\d+/i.test(trimmed)) {
        continue;
      }

      let permissions: string;
      let sizeStr: string;
      let dateStr: string;
      let rawName: string;

      const fullMatch = trimmed.match(FULL_TIME_REGEX);
      if (fullMatch) {
        permissions = fullMatch[1];
        sizeStr = fullMatch[2];
        dateStr = fullMatch[3];
        rawName = fullMatch[4];
      } else {
        const stdMatch = trimmed.match(STANDARD_LS_REGEX);
        if (stdMatch) {
          permissions = stdMatch[1];
          sizeStr = stdMatch[2];
          dateStr = stdMatch[3];
          rawName = stdMatch[4];
        } else {
          // Unrecognized format or header line, skip safely
          continue;
        }
      }

      // Determine file type from leading permission character
      let type: FileType = "other";
      const leadChar = permissions.charAt(0);
      if (leadChar === "d") {
        type = "directory";
      } else if (leadChar === "-") {
        type = "file";
      } else if (leadChar === "l") {
        type = "symlink";
      }

      // Extract clean filename (handling symlink `linkname -> target`)
      let name = rawName.trim();
      if (type === "symlink") {
        const arrowIndex = name.indexOf(" -> ");
        if (arrowIndex !== -1) {
          name = name.slice(0, arrowIndex).trim();
        }
      }

      // Skip current and parent directory pointers
      if (name === "." || name === "..") {
        continue;
      }

      const entry: DirectoryEntry = {
        name,
        type
      };

      // Extract size for regular files
      const size = parseInt(sizeStr, 10);
      if (!isNaN(size) && type === "file") {
        entry.size = size;
      }

      // Parse timestamp if possible
      if (dateStr) {
        const parsedDate = new Date(dateStr);
        if (!isNaN(parsedDate.getTime())) {
          entry.modifiedTime = parsedDate.toISOString();
        }
      }

      entries.push(entry);
    }

    // Deterministic sorting:
    // 1. Directories first alphabetically (case-insensitive)
    // 2. Files afterward alphabetically (case-insensitive)
    entries.sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (a.type !== "directory" && b.type === "directory") return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return entries;
  }
}
