/**
 * Deterministic conversation title from the first user message (no LLM call):
 * strips leading markdown/quote noise (whitespace # * > ` " ') and trailing
 * whitespace * > ` " ', collapses whitespace, keeps the first six words,
 * truncates anything over 40 characters to 37 + "..." (36 when the cut would
 * split an emoji or other surrogate pair), and upper-cases the first character,
 * with Turkish rules (i -> İ) when the text contains Turkish letters. Returns
 * "New Conversation" when nothing is left.
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
  const truncated = words.length > 40 ? words.slice(0, cutAt(words, 37)) + "..." : words;
  const first = truncated.charAt(0);
  const upper = TURKISH_LETTERS.test(clean) ? first.toLocaleUpperCase("tr-TR") : first.toUpperCase();
  return upper + truncated.slice(1);
}

/** Letters only Turkish uses; with them, "istanbul'a uçuş" gets "İ", not "I". */
const TURKISH_LETTERS = /[çğışöüÇĞİŞÖÜ]/;

/** `end`, or one less when it would cut between the halves of a surrogate pair. */
function cutAt(text: string, end: number): number {
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
}
