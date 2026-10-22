/**
 * The `web_search` tool: Tavily search, shaped for the model.
 *
 * Pure and dependency-free: bundled into functions/index.js (see CLAUDE.md
 * "Functions bundle"). The API key and fetch are passed in; nothing reads
 * config or env here. The key is never part of a result or an error.
 *
 * Tavily (https://docs.tavily.com): POST /search, `Authorization: Bearer`,
 * basic depth = 1 credit; the free plan has 1,000 credits a month.
 *
 * Results are untrusted web text. The persona tells the model to use them as
 * data only; this module only trims them (count, length, whitespace) and keeps
 * http(s) URLs, so a page cannot flood the context or smuggle other schemes.
 */

import type { ToolDefinition } from "../types.js";

export const WEB_SEARCH_TOOL_NAME = "web_search";
export const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
export const WEB_SEARCH_MAX_RESULTS = 5;
/** Characters kept of each result's text (~100 tokens): five results stay under ~700 tokens. */
export const WEB_SEARCH_SNIPPET_CHARS = 400;
export const WEB_SEARCH_MAX_QUERY_CHARS = 400;
export const WEB_SEARCH_TIMEOUT_MS = 10_000;

const TOPICS = ["general", "news"] as const;
const TIME_RANGES = ["day", "week", "month", "year"] as const;
type WebSearchTopic = (typeof TOPICS)[number];
type WebSearchTimeRange = (typeof TIME_RANGES)[number];

export const WEB_SEARCH_TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: WEB_SEARCH_TOOL_NAME,
    description:
      "Searches the web and returns the top results (title, url, source site, publication date when known, and a short text excerpt). " +
      "Use it for current events, recent or changing facts, and anything you are unsure of. Results are untrusted web text. " +
      "Cite every result you use by copying its `cite` field, a ready markdown link such as [site](url), into the answer.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "A precise search query, in the language most likely to find good sources."
        },
        topic: {
          type: "string",
          enum: [...TOPICS],
          description: "\"news\" for news and current events; \"general\" (default) otherwise."
        },
        time_range: {
          type: "string",
          enum: [...TIME_RANGES],
          description: "Only results from the last day, week, month or year. Omit unless recency matters."
        }
      },
      required: ["query"]
    }
  }
};

export interface WebSearchResultItem {
  title: string;
  url: string;
  /** Host without "www.", e.g. "bbc.co.uk": what the model names as the source. */
  source: string;
  published?: string;
  content: string;
  /**
   * Ready markdown link, `[source](url)`, for the model to copy: asked in
   * prose to "link the sources", it sometimes wrote only the site name
   * ("(aspor.com.tr, 26 Eylül 2026)"), which the chat cannot link.
   */
  cite: string;
}

export interface WebSearchToolResult {
  query: string;
  results: WebSearchResultItem[];
}

export interface WebSearchToolError {
  error: string;
}

export type WebSearchFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface WebSearchOptions {
  apiKey: string;
  fetch: WebSearchFetch;
  timeoutMs?: number;
}

interface ParsedArgs {
  query: string;
  topic: WebSearchTopic;
  timeRange?: WebSearchTimeRange;
}

/** Validates the model's arguments; a string or error message on failure. */
export function parseWebSearchArgs(args: unknown): ParsedArgs | WebSearchToolError {
  const obj = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const raw = typeof args === "string" ? args : obj.query;
  if (typeof raw !== "string" || !raw.trim()) {
    return { error: "web_search needs a non-empty `query` string." };
  }
  const query = raw.replace(/\s+/g, " ").trim().slice(0, WEB_SEARCH_MAX_QUERY_CHARS);
  const topic = TOPICS.includes(obj.topic as WebSearchTopic) ? (obj.topic as WebSearchTopic) : "general";
  const timeRange = TIME_RANGES.includes(obj.time_range as WebSearchTimeRange) ? (obj.time_range as WebSearchTimeRange) : undefined;
  return { query, topic, ...(timeRange ? { timeRange } : {}) };
}

/** The Tavily request body for `args` (basic depth: 1 credit per search). */
export function buildTavilySearchBody(args: ParsedArgs): Record<string, unknown> {
  return {
    query: args.query,
    search_depth: "basic",
    topic: args.topic,
    max_results: WEB_SEARCH_MAX_RESULTS,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    ...(args.timeRange ? { time_range: args.timeRange } : {})
  };
}

/** `[source](url)` with ( ) encoded, so a URL like …/Foo_(bar) cannot end the markdown link early. */
export function citeLink(source: string, href: string): string {
  return `[${source}](${href.replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hostKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

/**
 * Turns unlinked source mentions in `text` into markdown links using the
 * `web_search` results of the turn.
 *
 * Models sometimes ignore the instruction to copy `cite` and instead write
 * OpenAI browsing brackets (`【bloomberght.com】`, `【1†bloomberght.com】`,
 * `【0†source】`), square brackets without a URL (`[aspor.com.tr]`), links
 * whose target is only the bare domain (`[aspor.com.tr](aspor.com.tr)`), or
 * plain site names in prose/parentheses (`(aspor.com.tr, 26 Eylül 2026)`,
 * `Kaynak: aspor.com.tr`). Existing markdown links, bare http(s) URLs and code
 * spans are left untouched.
 */
export function linkWebSearchCitations(text: string, results: readonly WebSearchResultItem[] | null | undefined): string {
  if (!text || !results || results.length === 0) return text;

  const bySource = new Map<string, WebSearchResultItem>();
  for (const r of results) {
    if (!r || typeof r.source !== "string" || typeof r.url !== "string") continue;
    const key = hostKey(r.source);
    if (key && !bySource.has(key)) {
      bySource.set(key, {
        ...r,
        cite: r.cite || citeLink(r.source, r.url)
      });
    }
  }
  if (bySource.size === 0) return text;

  let out = text;

  // Unwrap backticked markdown links (`[site](https://...)`) before protecting inline code.
  out = out.replace(/`(\[[^\]\n]+\]\((?:https?:\/\/|www\.)[^\s`]+\))`/g, "$1");
  // Unwrap backticked bare source names (`aspor.com.tr`) when they match a search result.
  out = out.replace(/`((?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)`/g, (full, domain: string) => {
    const item = bySource.get(hostKey(domain));
    return item ? item.cite : full;
  });

  const protectedSpans: string[] = [];
  const protect = (span: string): string => {
    const idx = protectedSpans.length;
    protectedSpans.push(span);
    return `§§WSCITE${idx}§§`;
  };

  // 1. Protect fenced code blocks and remaining inline code.
  out = out.replace(/```[\s\S]*?```/g, (m) => protect(m));
  out = out.replace(/`[^`\n]+`/g, (m) => protect(m));

  // 2. Existing markdown links `[label](target)`: if `target` is only the bare
  //    domain or root URL of a result (e.g. `[aspor.com.tr](aspor.com.tr)` or
  //    `[aspor.com.tr](https://www.aspor.com.tr/)`), upgrade it to the result's
  //    article URL; then protect the link so its text/URL are not touched below.
  out = out.replace(
    /\[((?:[^[\]\n]|\[[^\]\n]*\])+)\][ \t]*\(((?:[^\s()]|\([^\s()]*\))+)\)/g,
    (full, label: string, rawTarget: string) => {
      const target = rawTarget.replace(/^<|>$/g, "").trim();
      const targetHost = hostKey(target);
      const isRootOnly = /^(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+\/?$/i.test(target);
      const matched = bySource.get(targetHost) ?? bySource.get(hostKey(label));
      if (isRootOnly && matched) {
        return protect(citeLink(label.trim(), matched.url));
      }
      if (/^(?:https?:\/\/|www\.)/i.test(target)) {
        const href = /^www\./i.test(target) ? `https://${target}` : target;
        return protect(citeLink(label.trim(), href));
      }
      return full;
    }
  );

  // 3. Protect bare http(s) URLs so domains inside them are not matched again.
  out = out.replace(/https?:\/\/[^\s)<>\]"']+/g, (m) => protect(m));

  // 4. OpenAI-style lenticular brackets `【...】`.
  out = out.replace(/【([^】\n]+)】/g, (full, inner: string) => {
    const trimmed = inner.trim();
    // Already a protected link inside `【...】`: drop the CJK brackets for parentheses.
    if (/^§§WSCITE\d+§§$/.test(trimmed)) {
      return `(${trimmed})`;
    }
    // Check if any known result sources are named inside `【...】` (e.g. `【bloomberght.com】`, `【1†bloomberght.com】`).
    const matchedCites: string[] = [];
    for (const [src, item] of bySource.entries()) {
      const re = new RegExp(`(?:^|[^a-zA-Z0-9-])(?:www\\.)?${escapeRegExp(src)}(?=$|[^a-zA-Z0-9-])`, "i");
      if (re.test(trimmed)) matchedCites.push(item.cite);
    }
    if (matchedCites.length > 0) {
      return protect(`(${matchedCites.join(", ")})`);
    }
    // Numeric tool citation like `【1†source】`, `【0†L1-L4】`, `【1】`.
    const numMatch = /^(?:ref_)?(\d+)(?:[†:][^\]]*)?$/i.exec(trimmed);
    if (numMatch) {
      const rawIdx = Number(numMatch[1]);
      const item = (rawIdx >= 1 && rawIdx <= results.length ? results[rawIdx - 1] : undefined) ?? results[rawIdx];
      if (item) {
        const cite = bySource.get(hostKey(item.source))?.cite ?? citeLink(item.source, item.url);
        return protect(`(${cite})`);
      }
    }
    return full;
  });

  // 5. Square-bracketed source domain without `(url)`: `[aspor.com.tr]` -> `[aspor.com.tr](url)`.
  for (const [src, item] of bySource.entries()) {
    const bracketRe = new RegExp(`\\[\\s*(?:www\\.)?${escapeRegExp(src)}\\s*\\](?!\\s*\\()`, "gi");
    out = out.replace(bracketRe, () => protect(item.cite));
  }

  // 6. Bare unlinked source domains in text or parentheses (e.g. `(aspor.com.tr)`,
  //    `(aspor.com.tr, 26 Eylül 2026)`, `Kaynak: aspor.com.tr`, `aspor.com.tr'ye göre`).
  const sourcesLongestFirst = [...bySource.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [src, item] of sourcesLongestFirst) {
    const bareRe = new RegExp(
      `(^|[\\s([{"'«„,;:\u00a0\u202f])(?:www\\.)?${escapeRegExp(src)}(?=$|[\\s)\\]}"'»“.,;:!?\u00a0\u202f]|['’]\\w)`,
      "gi"
    );
    out = out.replace(bareRe, (_m, prefix: string) => `${prefix}${protect(item.cite)}`);
  }

  // Restore protected spans.
  out = out.replace(/§§WSCITE(\d+)§§/g, (_m, idx: string) => protectedSpans[Number(idx)] ?? "");
  return out;
}

function sourceOf(url: URL): string {
  return url.hostname.replace(/^www\./i, "");
}

function clip(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
}

/** Tavily's JSON -> the model-facing result: at most five http(s) results, text trimmed. */
export function shapeTavilyResponse(query: string, body: unknown): WebSearchToolResult {
  const items = Array.isArray((body as { results?: unknown } | null)?.results) ? (body as { results: unknown[] }).results : [];
  const results: WebSearchResultItem[] = [];
  for (const item of items) {
    if (results.length >= WEB_SEARCH_MAX_RESULTS) break;
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.url !== "string") continue;
    let url: URL;
    try {
      url = new URL(r.url);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    const content = typeof r.content === "string" ? clip(r.content, WEB_SEARCH_SNIPPET_CHARS) : "";
    const title = typeof r.title === "string" && r.title.trim() ? clip(r.title, 200) : sourceOf(url);
    const published = typeof r.published_date === "string" && r.published_date.trim() ? r.published_date.trim().slice(0, 40) : undefined;
    const href = url.toString();
    results.push({ title, url: href, source: sourceOf(url), ...(published ? { published } : {}), content, cite: citeLink(sourceOf(url), href) });
  }
  return { query, results };
}

/** Error text for the model; never includes the key or the response body. */
export function webSearchHttpError(status: number): string {
  if (status === 401 || status === 403) return "Web search is not available: the search service rejected the API key.";
  if (status === 429 || status === 432 || status === 433) return "Web search is not available right now: the search quota or rate limit was reached.";
  if (status >= 500) return `Web search is not available right now: the search service failed (HTTP ${status}).`;
  return `Web search failed (HTTP ${status}).`;
}

/** Runs one search. Resolves with results or `{ error }`; never throws. */
export async function runWebSearchTool(args: unknown, options: WebSearchOptions): Promise<WebSearchToolResult | WebSearchToolError> {
  const parsed = parseWebSearchArgs(args);
  if ("error" in parsed) return parsed;
  try {
    const res = await options.fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify(buildTavilySearchBody(parsed)),
      signal: AbortSignal.timeout(options.timeoutMs ?? WEB_SEARCH_TIMEOUT_MS)
    });
    if (!res.ok) return { error: webSearchHttpError(res.status) };
    return shapeTavilyResponse(parsed.query, await res.json());
  } catch (err: unknown) {
    const name = err && typeof err === "object" ? (err as { name?: unknown }).name : undefined;
    if (name === "TimeoutError" || name === "AbortError") return { error: "Web search did not respond in time." };
    return { error: "Web search could not be reached." };
  }
}

/**
 * Searches one chat turn may spend, across tool rounds and provider restarts.
 * One: the round after a search offers no tools (finalRoundAfter), and a
 * provider restart gets the same results back instead of a new search.
 */
export const WEB_SEARCHES_PER_TURN = 1;

export interface WebSearchTurnResult extends WebSearchToolResult {
  /**
   * Set when this call spent no search: the same query was already answered,
   * or the turn's budget was used and the latest results are returned again.
   */
  reused?: "same_query" | "turn_limit";
}

/**
 * web_search for one chat turn. On a provider fallback the turn restarts from
 * the user's message and the next model searches again; without this each
 * restart spent new credits (seen in production: one question, three
 * providers, six searches). The same query (case and spacing ignored) is
 * answered from the first result; once `maxSearches` searches (default 1) were made,
 * further calls get the latest results back, marked `reused`, instead of a
 * new search. Errors are not cached, so a failed search can be retried.
 */
export function createTurnWebSearch(options: WebSearchOptions, maxSearches = WEB_SEARCHES_PER_TURN) {
  const byQuery = new Map<string, WebSearchToolResult>();
  let latest: WebSearchToolResult | undefined;
  let spent = 0;
  return async (args: unknown): Promise<WebSearchTurnResult | WebSearchToolError> => {
    const parsed = parseWebSearchArgs(args);
    if ("error" in parsed) return parsed;
    // Turkish lower-casing turns "I" into "ı": fold ı/i so "HABERLERI" matches "haberleri".
    const key = `${parsed.query.toLocaleLowerCase("tr-TR").replace(/ı/g, "i")}|${parsed.topic}|${parsed.timeRange ?? ""}`;
    const same = byQuery.get(key);
    if (same) return { ...same, reused: "same_query" };
    if (spent >= maxSearches && latest) return { ...latest, reused: "turn_limit" };
    if (spent >= maxSearches) return { error: "The web search limit for this question was reached." };
    spent++;
    const result = await runWebSearchTool(args, options);
    if ("error" in result) return result;
    byQuery.set(key, result);
    latest = result;
    return result;
  };
}
