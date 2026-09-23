/**
 * Canonical user profile renderer — B.U.T.L.E.R. Alfred
 *
 * Turns the contents of users/USER_PROFILE.md, PREFERENCES.md and
 * WORKING_STYLE.md into the "CANONICAL USER PROFILE" block of Alfred's system
 * prompt. It is the ONE renderer for that block: src/'s ContextBuilder feeds
 * it the files UserProfileLoader read from disk, and production
 * (src/ai/prompts/alfred-system-prompt.ts -> functions/index.js) feeds it the
 * copy embedded at build time in ./user-profile.generated.ts.
 *
 * Pure: strings in, string out. No imports, no file access, so it is safe to
 * bundle into the Cloud Functions.
 *
 * The files' prose is kept verbatim; only document scaffolding and Markdown
 * syntax that would be noise (or would invite Markdown replies, which the
 * browser reads aloud) are removed:
 *   - the `# ` title line, `>` metadata blockquotes, `---` rules, blank lines;
 *   - `## 1. Heading` becomes `Heading:`;
 *   - `**bold**` and `*italic*` markers are dropped outside `code spans`.
 * List markers, indentation, numbering and code spans are kept.
 */

import type { UserProfileSources } from "./user-profile.types.js";

export const USER_PROFILE_BLOCK_HEADER = "=== CANONICAL USER PROFILE (GIT AUTHORITATIVE) ===";
export const USER_PROFILE_BLOCK_FOOTER = "=".repeat(50);

/** Section label for each file, in prompt order. */
const SECTIONS: ReadonlyArray<readonly [keyof UserProfileSources, string]> = [
  ["userProfile", "USER PROFILE:"],
  ["preferences", "INTERACTION PREFERENCES:"],
  ["workingStyle", "WORKING STYLE & ENGINEERING PRINCIPLES:"]
];

/** Matches a CommonMark code span: a backtick run closed by a run of the same length. */
const CODE_SPAN = /(`+)(.+?)(?<!`)\1(?!`)/g;

function stripEmphasis(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?![\w*])/g, "$1$2");
}

/** Removes emphasis markers from a line while leaving code spans untouched. */
function stripEmphasisOutsideCode(line: string): string {
  let out = "";
  let last = 0;
  for (const match of line.matchAll(CODE_SPAN)) {
    out += stripEmphasis(line.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  return out + stripEmphasis(line.slice(last));
}

/**
 * Renders one Markdown file into prompt lines (no blank lines, no title,
 * no metadata). Exported for tests.
 */
export function renderUserProfileMarkdown(markdown: string): string {
  const lines: string[] = [];
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#\s/.test(trimmed)) continue; // document title
    if (trimmed.startsWith(">")) continue; // status / source-of-truth metadata
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) continue; // horizontal rule

    const heading = /^#{2,6}\s+(?:\d+\.\s+)?(.+?)\s*#*$/.exec(trimmed);
    if (heading) {
      lines.push(`${stripEmphasisOutsideCode(heading[1]!)}:`);
      continue;
    }
    lines.push(stripEmphasisOutsideCode(line));
  }
  return lines.join("\n");
}

/**
 * Renders the canonical user profile block from the three users/*.md files.
 * A file that renders to nothing is left out.
 */
export function renderUserProfileBlock(sources: UserProfileSources): string {
  const sections = SECTIONS
    .map(([key, label]) => {
      const body = renderUserProfileMarkdown(sources[key] ?? "");
      return body ? `${label}\n${body}` : "";
    })
    .filter(Boolean);
  return [USER_PROFILE_BLOCK_HEADER, sections.join("\n\n"), USER_PROFILE_BLOCK_FOOTER].join("\n");
}
