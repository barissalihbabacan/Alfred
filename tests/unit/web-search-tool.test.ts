import { describe, it, expect } from "vitest";
import {
  TAVILY_SEARCH_URL,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_SNIPPET_CHARS,
  WEB_SEARCH_TOOL_DEFINITION,
  WEB_SEARCHES_PER_TURN,
  createTurnWebSearch,
  parseWebSearchArgs,
  runWebSearchTool,
  shapeTavilyResponse
} from "../../src/ai/tools/web/web-search.js";

const KEY = "tvly-test-secret-key";

function mockFetch(reply: { status?: number; body?: unknown } | Error) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
  };
  return { fetch, calls };
}

const TAVILY_REPLY = {
  query: "istanbul hava durumu",
  results: [
    { title: "İstanbul Hava Durumu", url: "https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx?il=Istanbul", content: "Bugün   parçalı\n bulutlu, 22°C.", score: 0.9, published_date: "2026-09-28" },
    { title: "", url: "https://example.com/a", content: "x".repeat(WEB_SEARCH_SNIPPET_CHARS + 50), score: 0.8 },
    { title: "Bad scheme", url: "javascript:alert(1)", content: "nope" },
    { title: "Not a URL", url: "not a url", content: "nope" },
    { title: "No url" },
    { title: "Four", url: "https://four.example/", content: "4" },
    { title: "Five", url: "http://five.example/", content: "5" },
    { title: "Six", url: "https://six.example/", content: "6" },
    { title: "Seven", url: "https://seven.example/", content: "7" }
  ],
  response_time: 0.8
};

describe("web_search tool (src/ai/tools/web/web-search.ts)", () => {
  it("declares one required query plus optional topic / time_range", () => {
    expect(WEB_SEARCH_TOOL_DEFINITION.function.name).toBe("web_search");
    expect(WEB_SEARCH_TOOL_DEFINITION.function.parameters).toMatchObject({
      required: ["query"],
      properties: { topic: { enum: ["general", "news"] }, time_range: { enum: ["day", "week", "month", "year"] } }
    });
  });

  it("sends a basic Tavily search with the key as a bearer token", async () => {
    const m = mockFetch({ body: TAVILY_REPLY });
    await runWebSearchTool({ query: "  istanbul   hava durumu ", topic: "news", time_range: "day" }, { apiKey: KEY, fetch: m.fetch });
    expect(m.calls).toHaveLength(1);
    expect(m.calls[0].url).toBe(TAVILY_SEARCH_URL);
    expect(m.calls[0].init.method).toBe("POST");
    expect((m.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(m.calls[0].init.body))).toEqual({
      query: "istanbul hava durumu",
      search_depth: "basic",
      topic: "news",
      max_results: WEB_SEARCH_MAX_RESULTS,
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      time_range: "day"
    });
    expect(m.calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns at most five http(s) results with trimmed text and a source name", async () => {
    const m = mockFetch({ body: TAVILY_REPLY });
    const out = await runWebSearchTool({ query: "istanbul hava durumu" }, { apiKey: KEY, fetch: m.fetch });
    expect("results" in out && out.results).toHaveLength(5);
    if (!("results" in out)) throw new Error("expected results");
    expect(out.results[0]).toEqual({
      title: "İstanbul Hava Durumu",
      url: "https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx?il=Istanbul",
      source: "mgm.gov.tr",
      published: "2026-09-28",
      content: "Bugün parçalı bulutlu, 22°C."
    });
    // Missing title falls back to the site; long text is cut with an ellipsis.
    expect(out.results[1].title).toBe("example.com");
    expect(out.results[1].content.length).toBeLessThanOrEqual(WEB_SEARCH_SNIPPET_CHARS + 1);
    expect(out.results[1].content.endsWith("…")).toBe(true);
    expect(out.results.map((r) => r.source)).toEqual(["mgm.gov.tr", "example.com", "four.example", "five.example", "six.example"]);
    expect(JSON.stringify(out)).not.toContain("javascript:");
  });

  it("defaults bad topic / time_range and rejects an empty query without calling out", async () => {
    expect(parseWebSearchArgs({ query: "x", topic: "sports", time_range: "decade" })).toEqual({ query: "x", topic: "general" });
    expect(parseWebSearchArgs("plain string query")).toEqual({ query: "plain string query", topic: "general" });
    const m = mockFetch({ body: TAVILY_REPLY });
    for (const bad of [{}, { query: "   " }, { query: 42 }, null, undefined]) {
      expect(await runWebSearchTool(bad, { apiKey: KEY, fetch: m.fetch })).toEqual({ error: "web_search needs a non-empty `query` string." });
    }
    expect(m.calls).toHaveLength(0);
  });

  it("turns HTTP errors, timeouts and network failures into short errors that never contain the key", async () => {
    const cases: Array<[{ status?: number; body?: unknown } | Error, RegExp]> = [
      [{ status: 401, body: { detail: { error: `Invalid key ${KEY}` } } }, /rejected the API key/],
      [{ status: 432, body: {} }, /quota or rate limit/],
      [{ status: 429, body: {} }, /quota or rate limit/],
      [{ status: 500, body: {} }, /failed \(HTTP 500\)/],
      [{ status: 400, body: {} }, /Web search failed \(HTTP 400\)/],
      [Object.assign(new Error("timed out"), { name: "TimeoutError" }), /did not respond in time/],
      [new Error(`connect ECONNREFUSED with ${KEY}`), /could not be reached/]
    ];
    for (const [reply, message] of cases) {
      const out = await runWebSearchTool({ query: "q" }, { apiKey: KEY, fetch: mockFetch(reply).fetch });
      expect(out).toHaveProperty("error");
      expect((out as { error: string }).error).toMatch(message);
      expect(JSON.stringify(out)).not.toContain(KEY);
    }
  });

  it("copes with an unexpected response shape", () => {
    expect(shapeTavilyResponse("q", null)).toEqual({ query: "q", results: [] });
    expect(shapeTavilyResponse("q", { results: "nope" })).toEqual({ query: "q", results: [] });
  });

  describe("createTurnWebSearch (one turn, across tool rounds and provider restarts)", () => {
    function counting(replies: Array<{ status?: number; body?: unknown }>) {
      let n = 0;
      const queries: string[] = [];
      const fetch = async (_url: string, init: RequestInit) => {
        queries.push(JSON.parse(String(init.body)).query);
        const reply = replies[Math.min(n++, replies.length - 1)];
        return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
      };
      return { fetch, queries, count: () => n };
    }
    const reply = (q: string) => ({ body: { results: [{ title: q, url: `https://${q.replace(/\W+/g, "")}.test/`, content: q }] } });

    it("answers a repeated query (case and spacing ignored) without a new search", async () => {
      const m = counting([reply("a")]);
      const search = createTurnWebSearch({ apiKey: KEY, fetch: m.fetch });
      const first = await search({ query: "Teknoloji haberleri" });
      const again = await search({ query: "  teknoloji   HABERLERI " });
      expect(m.count()).toBe(1);
      expect(again).toEqual({ ...first, reused: "same_query" });
    });

    it(`spends at most ${WEB_SEARCHES_PER_TURN} search; a provider restart gets those results back`, async () => {
      expect(WEB_SEARCHES_PER_TURN).toBe(1);
      const m = counting([reply("one"), reply("two")]);
      const search = createTurnWebSearch({ apiKey: KEY, fetch: m.fetch });
      const first = await search({ query: "q1" });
      // The next provider asks again with its own wording: no second search.
      const restart = await search({ query: "q2 other wording" });
      expect(m.queries).toEqual(["q1"]);
      expect(restart).toEqual({ ...first, reused: "turn_limit" });
      // A larger budget is still honoured when asked for.
      const two = counting([reply("a"), reply("b"), reply("c")]);
      const search2 = createTurnWebSearch({ apiKey: KEY, fetch: two.fetch }, 2);
      await search2({ query: "x" }); await search2({ query: "y" }); await search2({ query: "z" });
      expect(two.queries).toEqual(["x", "y"]);
    });

    it("does not cache errors, and reports the limit when nothing was found", async () => {
      const m = counting([{ status: 500 }, { status: 500 }]);
      const search = createTurnWebSearch({ apiKey: KEY, fetch: m.fetch });
      expect(await search({ query: "q" })).toHaveProperty("error");
      // The failed search was not cached, but it used the turn's one search.
      expect(await search({ query: "q" })).toEqual({ error: "The web search limit for this question was reached." });
      expect(m.count()).toBe(1);
      expect(await search({})).toEqual({ error: "web_search needs a non-empty `query` string." });
    });
  });
});
