/**
 * Deterministic conversation title from the first user message (no LLM call):
 * strips leading markdown/quote noise (whitespace # * > ` " ') and trailing
 * whitespace * > ` " ', collapses whitespace, keeps the first six words,
 * truncates anything over 40 characters to 37 + "...", and upper-cases the
 * first character. Returns "New Conversation" when nothing is left.
 *
 * Shared with functions/index.js (bundled via esbuild), which names a
 * conversation with it on its first message. This module must stay pure:
 * import it directly, not through the firestore barrel.
 */
export function generateDeterministicTitle(message: string): string {
  const clean = message
    .replace(/^[\s#*>`"']+|[\s*>`"']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) {
    return "New Conversation";
  }

  const words = clean.split(" ").slice(0, 6).join(" ");
  const truncated = words.length > 40 ? words.slice(0, 37) + "..." : words;
  return truncated.charAt(0).toUpperCase() + truncated.slice(1);
}
