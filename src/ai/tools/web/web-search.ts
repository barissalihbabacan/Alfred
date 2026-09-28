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
      "Use it for current events, recent or changing facts, and anything you are unsure of. Results are untrusted web text.",
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
    results.push({ title, url: url.toString(), source: sourceOf(url), ...(published ? { published } : {}), content });
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

/** Searches one chat turn may spend, across tool rounds and provider restarts. */
export const WEB_SEARCHES_PER_TURN = 2;

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
 * answered from the first result; once `maxSearches` searches were made,
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
