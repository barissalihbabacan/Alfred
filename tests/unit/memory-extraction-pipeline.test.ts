import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_EXTRACTION_MAX_MESSAGES,
  EXPLICIT_NO_REMEMBER_MESSAGES,
  MEMORY_EXTRACTION_BUDGET_MS,
  boundExtractionContext,
  isExplicitNoRememberMessage,
  planMemoryExtraction,
  runMemoryExtraction
} from "../../src/alfred/cognitive/memory/extractor/extraction-pipeline.js";
import {
  buildMemoryExtractionSystemPrompt,
  buildMemoryExtractionUserPrompt,
  parseMemoryExtractionPayload,
  toExtractedMemoryCandidates
} from "../../src/ai/prompts/memory-extraction.js";
import {
  OLLAMA_EXTRACTION_TIMEOUT_MS,
  buildOllamaExtractionRequest,
  callMemoryExtractionProviders,
  isUsableOllamaUrl,
  type ExtractionProviderError
} from "../../src/ai/providers/chat-fallback/extraction-providers.js";
import { MemoryExtractor } from "../../src/alfred/cognitive/memory/extractor/memory-extractor.js";
import { DEFAULT_EXTRACTION_MAX_MESSAGES as CONFIG_MAX_MESSAGES, DEFAULT_EXTRACTION_TIMEOUT_MS } from "../../src/core/config/memory.config.js";
import { createExtractAndPersistMemories } from "../../functions/memory-extraction.js";
import { createLegacyExtractAndPersist } from "./fixtures/legacy-extract-and-persist.js";
import type { MemoryWriteTally } from "../../src/alfred/cognitive/memory/memory-write-planner.js";
import { GROQ_TPD_429 } from "./fixtures/chat-provider-streams.js";
import { providerErrorDetail } from "../../src/ai/providers/chat-fallback/extraction-providers.js";

/**
 * Memory extraction *calling* is shared by production
 * (functions/memory-extraction.js) and src (MemoryExtractor) through
 * extraction-pipeline.ts and callMemoryExtractionProviders (Groq -> Gemini ->
 * Ollama).
 *
 * The differential suite runs production's new module and a verbatim copy of
 * the former inline code (fixtures/legacy-extract-and-persist.js: the old
 * extractAndPersistMemories plus the old callMemoryExtractionProviders)
 * against the same fake providers. Two changes are intended:
 *
 * A. an empty (whitespace-only) user message or an exact "don't remember
 *    this" (src's short-circuit) no longer calls a model: the summary is
 *    "nothing" with `skip_reason`, and nothing is fetched or persisted;
 * B. an Ollama answer whose `message.content` is a truthy non-string used to
 *    reach extractJsonPayload and throw (the turn logged "Extraction skipped:
 *    rawText.replace is not a function"); it now counts as no answer, so the
 *    turn ends "failed" like every other provider failure.
 *
 * Every other turn must produce identical fetch calls (URL, method, headers,
 * body, timeout), log lines (verbatim), embedding/persist calls and return
 * value, or the identical error.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.floor(r() * items.length)]!;
}

const MESSAGES = [
  "Remember that I prefer dark roast coffee.",
  "I switched our CI to GitHub Actions.",
  "hello",
  "What time is it in Tokyo?",
  "Forget that I use Jenkins.",
  "don't remember this",
  "  Don't Remember This  ",
  "do not remember this",
  "bunu hatırlama",
  "Sakın kaydetme",
  "Don't remember this.", // not exact: still goes to the model
  "don't remember this, but I like tea", // not exact
  "BUNU HATIRLAMA", // lower-cases to "bunu hatirlama": not exact
  "",
  "   \n "
];

const MODEL_TEXTS = [
  JSON.stringify({ shouldRemember: true, memories: [{ content: "Barış prefers dark roast coffee.", memoryType: "user_preference", confidence: 0.97, action: "create" }] }),
  JSON.stringify({ shouldRemember: true, memories: [{ content: "Barış moved CI to GitHub Actions.", confidence: 0.9, action: "supersede" }, null, { content: "abc", confidence: 0.99 }] }),
  JSON.stringify({ shouldRemember: true, memories: [{ content: "Jenkins", confidence: "0.95", action: "forget" }, { content: "Barış uses Vim daily.", confidence: 0.5 }, { content: "Barış works from Istanbul.", confidence: 0.8 }] }),
  JSON.stringify({ shouldRemember: true, memories: [{ content: "Barış likes tea.", confidence: 0.9 }, { content: "Barış likes tea a lot.", confidence: 0.9 }] }),
  JSON.stringify({ shouldRemember: false, memories: [] }),
  JSON.stringify({ shouldRemember: true, memories: "not an array" }),
  "```json\n{\"shouldRemember\": true, \"memories\": [{\"content\": \"Barış likes green tea.\", \"confidence\": 0.9}]}\n```",
  "<think>the user states a preference</think>{\"shouldRemember\": true, \"memories\": [{\"content\": \"Barış likes jazz.\", \"confidence\": 0.92, \"action\": \"CREATE\"}]}",
  "I could not decide, sorry.",
  "{\"shouldRemember\": true, \"memories\": [",
  "null"
];

type OpenAIReply = "ok" | "okEmpty" | "okNonString" | "okNoChoices" | "okBadJson" | "rateLimited" | "rateLimitedHeader" | "serverError" | "throws";
type OllamaReply = "ok" | "okEmpty" | "okNonString" | "okNoMessage" | "okNull" | "okBadJson" | "serverError" | "throws";

const OPENAI_REPLIES: readonly OpenAIReply[] = ["ok", "ok", "ok", "ok", "ok", "ok", "okEmpty", "okNonString", "okNoChoices", "okBadJson", "rateLimited", "rateLimitedHeader", "serverError", "throws"];
const OLLAMA_REPLIES: readonly OllamaReply[] = ["ok", "ok", "okEmpty", "okNonString", "okNoMessage", "okNull", "okBadJson", "serverError", "throws"];

interface Scenario {
  seed: number;
  userMessage: string;
  assistantResponse: string | undefined;
  recentHistory: Array<{ role: string; content: string }>;
  groqKey: string | undefined;
  geminiKey: string | undefined;
  ollamaUrl: string | undefined;
  ollamaModel: string;
  replies: { groq: OpenAIReply; gemini: OpenAIReply; ollama: OllamaReply };
  texts: { groq: string; gemini: string; ollama: string };
}

function makeScenario(seed: number): Scenario {
  const r = mulberry32(seed);
  const history = Array.from({ length: Math.floor(r() * 11) }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: pick(r, [...MESSAGES, "Certainly, sir.", "Right away, sir. It is 09:14 in Tokyo."])
  }));
  return {
    seed,
    // A quarter of the turns hit the short-circuit candidates (exact or not).
    userMessage: r() < 0.25 ? pick(r, MESSAGES.slice(5)) : pick(r, MESSAGES.slice(0, 5)),
    assistantResponse: pick(r, ["Noted, sir.", "It is 09:14 in Tokyo, sir.", "", undefined]),
    recentHistory: history,
    groqKey: pick(r, ["gsk_live", "gsk_live", "gsk_live", "", "unset", undefined]),
    geminiKey: pick(r, ["AQ.gemini", "AQ.gemini", "none", "", undefined]),
    ollamaUrl: pick(r, ["http://ollama.test:11434", "http://ollama.test:11434///", "https://mac.tail.ts.net", "http://placeholder.invalid", "", undefined]),
    ollamaModel: "gemma4:12b-mlx",
    replies: { groq: pick(r, OPENAI_REPLIES), gemini: pick(r, OPENAI_REPLIES), ollama: pick(r, OLLAMA_REPLIES) },
    texts: { groq: pick(r, MODEL_TEXTS), gemini: pick(r, MODEL_TEXTS), ollama: pick(r, MODEL_TEXTS) }
  };
}

function openAIResponse(kind: OpenAIReply, text: string): Response {
  switch (kind) {
    case "ok": return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: text } }] }));
    case "okEmpty": return new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }));
    case "okNonString": return new Response(JSON.stringify({ choices: [{ message: { content: { text } } }] }));
    case "okNoChoices": return new Response(JSON.stringify({ id: "x" }));
    case "okBadJson": return new Response("<html>gateway</html>");
    case "rateLimited": return new Response(JSON.stringify(GROQ_TPD_429), { status: 429 });
    case "rateLimitedHeader": return new Response("slow down", { status: 429, headers: { "retry-after": "7" } });
    case "serverError": return new Response("internal error ".repeat(60), { status: 500 });
    case "throws": throw new TypeError("fetch failed");
  }
}

function ollamaResponse(kind: OllamaReply, text: string): Response {
  switch (kind) {
    case "ok": return new Response(JSON.stringify({ message: { role: "assistant", content: text } }));
    case "okEmpty": return new Response(JSON.stringify({ message: { content: "" } }));
    case "okNonString": return new Response(JSON.stringify({ message: { content: { text } } }));
    case "okNoMessage": return new Response(JSON.stringify({ done: true }));
    case "okNull": return new Response("null");
    case "okBadJson": return new Response("not json");
    case "serverError": return new Response("model not loaded", { status: 500 });
    case "throws": throw new Error("The operation was aborted due to timeout");
  }
}

type Rec = Record<string, unknown>;

/** Fake persistence: records its input and moves the tally deterministically. */
function fakePersist(calls: Rec[]) {
  return async (p: Rec & { memories: unknown[]; tally: MemoryWriteTally; embed: (t: string) => Promise<unknown>; now: () => unknown }) => {
    const embedded = await p.embed("probe text");
    calls.push({
      memories: structuredClone(p.memories),
      userId: p.userId,
      conversationId: p.conversationId,
      sourceMessageIds: p.sourceMessageIds,
      db: p.db,
      embedded,
      now: p.now(),
      hasLogger: typeof p.logger === "object",
      errMessage: typeof p.errMessage === "function" ? (p.errMessage as (e: unknown) => string)(new Error("boom")) : null
    });
    if (p.memories.length === 3) throw new Error("persist exploded");
    p.tally.stored += p.memories.length % 2;
    p.tally.duplicate += p.memories.length > 1 ? 1 : 0;
    p.tally.invalid += p.memories.filter((m) => m === null).length;
  };
}

type Runner = "legacy" | "shared";

async function run(runner: Runner, s: Scenario) {
  const fetches: Rec[] = [];
  const logs: unknown[][] = [];
  const persistCalls: Rec[] = [];
  const embeds: unknown[][] = [];
  const timeouts: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    timeouts.push(ms);
    return new AbortController().signal;
  });
  const fetch = async (url: string, init: RequestInit) => {
    const { signal, ...rest } = init;
    fetches.push({ url, ...rest, headers: structuredClone(rest.headers), hasSignal: signal instanceof AbortSignal });
    if (url.startsWith("https://api.groq.com/")) return openAIResponse(s.replies.groq, s.texts.groq);
    if (url.startsWith("https://generativelanguage.googleapis.com/")) return openAIResponse(s.replies.gemini, s.texts.gemini);
    return ollamaResponse(s.replies.ollama, s.texts.ollama);
  };
  const logger = {
    info: (...args: unknown[]) => { logs.push(["info", ...structuredClone(args)]); },
    warn: (...args: unknown[]) => { logs.push(["warn", ...structuredClone(args)]); }
  };
  let ts = 0;
  const Timestamp = { now: () => ({ ts: ++ts }) };
  const getEmbedding = async (text: string, ollamaUrl: unknown, geminiKey: unknown) => {
    embeds.push([text, ollamaUrl, geminiKey]);
    return { values: [1, 0], model: "gemini-embedding-001" };
  };
  const errMessage = (err: unknown) => String((err as Error)?.message || err || "unknown error").slice(0, 300);
  const persist = fakePersist(persistCalls);
  const models = { groq: "openai/gpt-oss-20b", gemini: "gemini-3.1-flash-lite" };

  const extract = runner === "legacy"
    ? createLegacyExtractAndPersist({
      fetch, logger, Timestamp, getEmbedding, errMessage, persistMemoryCandidates: persist,
      MEMORY_EXTRACTION_MODEL: models.groq, GEMINI_EXTRACTION_MODEL: models.gemini
    })
    : createExtractAndPersistMemories({
      fetch, logger, now: () => Timestamp.now(), getEmbedding, errMessage,
      memoryExtractionModel: models.groq, geminiExtractionModel: models.gemini, persist,
      // The former code hard-coded "Barış"; the same name keeps the comparison exact.
      userName: "Barış"
    });

  let result: unknown;
  let error: string | null = null;
  try {
    result = await extract({
      db: { fake: "db" },
      ollamaUrl: s.ollamaUrl,
      ollamaModel: s.ollamaModel,
      evrenKey: undefined,
      groqKey: s.groqKey,
      geminiKey: s.geminiKey,
      userMessage: s.userMessage,
      assistantResponse: s.assistantResponse,
      userId: "user_1",
      projectId: null,
      conversationId: "conv_1",
      sourceMessageIds: ["m_u", "m_a"],
      recentHistory: structuredClone(s.recentHistory)
    });
  } catch (err) {
    error = errMessage(err);
  } finally {
    vi.restoreAllMocks();
  }
  return { fetches, timeouts, logs, persistCalls, embeds, result, error };
}

type ChangeReason = "A-short-circuit" | "B-ollama-non-string" | "C-json-error-detail";

/**
 * Change C: a JSON HTTP error body is logged as its `error.code: error.message`
 * only (providerErrorDetail), so fields such as Groq's `failed_generation`
 * (the model's output about the user) never reach the logs. Applies that to
 * the former code's log lines; everything else in them stays as it was.
 */
function withSanitizedErrorBodies(logs: unknown[][]): unknown[][] {
  return logs.map((entry) => {
    const [level, message, ...rest] = entry;
    const m = typeof message === "string" ? /^(\[Memory\] \S+ extraction HTTP \d+: )([\s\S]*)$/.exec(message) : null;
    if (!m) return entry;
    return [level, m[1] + providerErrorDetail(m[2]).slice(0, 500), ...rest];
  });
}

function intendedChange(s: Scenario, legacy: Awaited<ReturnType<typeof run>>): ChangeReason | null {
  if (!s.userMessage.trim() || isExplicitNoRememberMessage(s.userMessage)) return "A-short-circuit";
  const askedOllama = legacy.fetches.some((f) => !String(f.url).startsWith("https://api.groq.com/") && !String(f.url).startsWith("https://generativelanguage.googleapis.com/"));
  if (askedOllama && s.replies.ollama === "okNonString") return "B-ollama-non-string";
  return null;
}

describe("functions/memory-extraction.js vs the former inline extraction (differential)", () => {
  it("is identical on every turn outside changes A, B and C, and A/B/C behave as intended (8000 random turns)", async () => {
    const changed: Record<ChangeReason, number> = { "A-short-circuit": 0, "B-ollama-non-string": 0, "C-json-error-detail": 0 };
    const outcomes: Record<string, number> = {};
    const providers: Record<string, number> = {};
    let identical = 0;

    for (let seed = 1; seed <= 8000; seed++) {
      const s = makeScenario(seed);
      const legacy = await run("legacy", s);
      const shared = await run("shared", s);
      const where = `seed ${seed}`;
      const reason = intendedChange(s, legacy);

      if (reason === "A-short-circuit") {
        changed[reason]++;
        expect(shared.fetches, where).toEqual([]);
        expect(shared.logs, where).toEqual([]);
        expect(shared.persistCalls, where).toEqual([]);
        expect(shared.error, where).toBeNull();
        expect(shared.result, where).toMatchObject({
          outcome: "nothing",
          count: 0,
          extractor_provider: null,
          skip_reason: s.userMessage.trim() ? "explicit_no_remember" : "empty_message"
        });
        continue;
      }
      if (reason === "B-ollama-non-string") {
        changed[reason]++;
        expect(legacy.error, where).toMatch(/is not a function/);
        expect(shared.error, where).toBeNull();
        expect(shared.fetches, where).toEqual(legacy.fetches);
        expect(shared.logs, where).toEqual(withSanitizedErrorBodies(legacy.logs));
        expect(shared.result, where).toMatchObject({ outcome: "failed", extractor_provider: null });
        continue;
      }

      const sanitizedLogs = withSanitizedErrorBodies(legacy.logs);
      if (JSON.stringify(sanitizedLogs) !== JSON.stringify(legacy.logs)) {
        changed["C-json-error-detail"]++;
        expect(shared, where).toEqual({ ...legacy, logs: sanitizedLogs });
        continue;
      }

      identical++;
      expect(shared, where).toEqual(legacy);
      const outcome = legacy.error ? "error" : String((legacy.result as Rec).outcome);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      const provider = legacy.error ? "error" : String((legacy.result as Rec).extractor_provider);
      providers[provider] = (providers[provider] ?? 0) + 1;
    }

    if (process.env.PRINT_COVERAGE) console.log({ identical, changed, outcomes, providers });
    expect(identical).toBeGreaterThan(5000);
    for (const [key, count] of Object.entries(changed)) expect(count, key).toBeGreaterThan(20);
    for (const outcome of ["stored", "duplicate", "failed", "nothing", "error"]) expect(outcomes[outcome] ?? 0, outcome).toBeGreaterThan(20);
    for (const provider of ["groq", "gemini", "ollama", "null"]) expect(providers[provider] ?? 0, provider).toBeGreaterThan(20);
  }, 180_000);
});

describe("src MemoryExtractor and production send the same requests and accept the same candidates", () => {
  it("matches production on 3000 random turns (default chain, injected fetch)", async () => {
    let compared = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const s = makeScenario(seed);
      // src always has an Ollama URL (OLLAMA_BASE_URL or its default).
      if (!s.ollamaUrl) continue;
      const production = await run("shared", s);

      vi.stubEnv("GROQ_API_KEY", s.groqKey ?? "");
      vi.stubEnv("GEMINI_API_KEY", s.geminiKey ?? "");
      vi.stubEnv("OLLAMA_BASE_URL", s.ollamaUrl);
      vi.stubEnv("OLLAMA_MODEL", s.ollamaModel);
      const fetches: Rec[] = [];
      const timeouts: number[] = [];
      vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
        timeouts.push(ms);
        return new AbortController().signal;
      });
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});
      const extractor = new MemoryExtractor({
        fetch: async (url: string, init: RequestInit) => {
          const { signal, ...rest } = init;
          fetches.push({ url, ...rest, headers: structuredClone(rest.headers), hasSignal: signal instanceof AbortSignal });
          if (url.startsWith("https://api.groq.com/")) return openAIResponse(s.replies.groq, s.texts.groq);
          if (url.startsWith("https://generativelanguage.googleapis.com/")) return openAIResponse(s.replies.gemini, s.texts.gemini);
          return ollamaResponse(s.replies.ollama, s.texts.ollama);
        },
        config: { enabled: true, minConfidence: 0.7, maxContextMessages: DEFAULT_EXTRACTION_MAX_MESSAGES, model: "openai/gpt-oss-20b", geminiModel: "gemini-3.1-flash-lite", timeoutMs: 10_000 }
      });
      const result = await extractor.extract({
        currentMessage: s.userMessage,
        assistantResponse: s.assistantResponse,
        recentMessages: structuredClone(s.recentHistory),
        userId: "user_1",
        userName: "Barış" // the name run() gives production for parity with the former code
      });
      vi.restoreAllMocks();
      vi.unstubAllEnvs();

      const where = `seed ${seed}`;
      expect(fetches, where).toEqual(production.fetches);
      expect(timeouts, where).toEqual(production.timeouts);
      const productionCandidates = production.persistCalls.length > 0
        ? toExtractedMemoryCandidates(production.persistCalls[0]!.memories as unknown[]).map(({ reasoning: _r, ...c }) => c)
        : [];
      expect(result.candidates.map(({ reasoning: _r, ...c }) => c), where).toEqual(productionCandidates);
      compared++;
    }
    expect(compared).toBeGreaterThan(1500);
  }, 180_000);
});

describe("planMemoryExtraction", () => {
  it("short-circuits an empty message and the exact 'don't remember' phrases", () => {
    for (const message of ["", "   ", "\n\t"]) {
      expect(planMemoryExtraction({ currentMessage: message })).toEqual({ kind: "skip", reason: "empty_message" });
    }
    for (const message of [...EXPLICIT_NO_REMEMBER_MESSAGES, "  DON'T REMEMBER THIS ", "Sakın Kaydetme"]) {
      expect(planMemoryExtraction({ currentMessage: message }), message).toEqual({ kind: "skip", reason: "explicit_no_remember" });
    }
    // Exact only: anything more goes to the model, whose prompt handles it.
    for (const message of ["Don't remember this.", "don't remember this, but I like tea", "please don't remember this"]) {
      expect(planMemoryExtraction({ currentMessage: message }).kind, message).toBe("call");
    }
  });

  it("builds production's prompts from the last maxContextMessages messages (default 10)", () => {
    expect(DEFAULT_EXTRACTION_MAX_MESSAGES).toBe(10);
    expect(CONFIG_MAX_MESSAGES).toBe(10);
    const history = Array.from({ length: 13 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `Msg ${i}` }));
    const plan = planMemoryExtraction({ currentMessage: "I use Vim.", assistantResponse: "Noted, sir.", recentMessages: history });
    expect(plan).toEqual({
      kind: "call",
      // Defaults to the owner in users/USER_PROFILE.md (the committed example, "Alex").
      system: buildMemoryExtractionSystemPrompt("Alex"),
      user: buildMemoryExtractionUserPrompt({ currentMessage: "I use Vim.", assistantResponse: "Noted, sir.", recentMessages: history.slice(-10) })
    });
    const four = planMemoryExtraction({ currentMessage: "I use Vim.", recentMessages: history, userName: "Bruce" }, 4);
    expect(four).toMatchObject({ system: buildMemoryExtractionSystemPrompt("Bruce") });
    expect(four.kind === "call" && four.user).toBe(buildMemoryExtractionUserPrompt({ currentMessage: "I use Vim.", recentMessages: history.slice(-4) }));
    expect(four.kind === "call" && four.user.includes("Msg 8")).toBe(false);
  });

  it("boundExtractionContext keeps the tail, and nothing for a non-positive bound", () => {
    expect(boundExtractionContext(undefined)).toBeUndefined();
    expect(boundExtractionContext([1, 2, 3], 2)).toEqual([2, 3]);
    expect(boundExtractionContext([1, 2, 3], 10)).toEqual([1, 2, 3]);
    expect(boundExtractionContext([1, 2, 3], 0)).toEqual([]);
  });

  it("uses production's 10 s budget as src's default timeout", () => {
    expect(MEMORY_EXTRACTION_BUDGET_MS).toBe(10_000);
    expect(DEFAULT_EXTRACTION_TIMEOUT_MS).toBe(10_000);
    const index = readFileSync(new URL("../../functions/api.ts", import.meta.url), "utf8");
    expect(index).toContain('import { MEMORY_EXTRACTION_BUDGET_MS } from "../src/alfred/cognitive/memory/extractor/extraction-pipeline.js";');
    expect(index).not.toMatch(/const MEMORY_EXTRACTION_BUDGET_MS\s*=/);
  });
});

describe("runMemoryExtraction", () => {
  const call = (text: string | null) => async () => (text === null ? null : { text, provider: "groq" });

  it("maps the answer to production's outcomes", async () => {
    const turn = { currentMessage: "I use Vim." };
    expect(await runMemoryExtraction({ turn, call: call(null) })).toEqual({ outcome: "failed", provider: null });
    expect(await runMemoryExtraction({ turn, call: call("") })).toEqual({ outcome: "failed", provider: null });
    expect(await runMemoryExtraction({ turn, call: call("nope") })).toEqual({ outcome: "invalid_json", provider: "groq", text: "nope" });
    expect(await runMemoryExtraction({ turn, call: call("{\"shouldRemember\": false}") })).toMatchObject({ outcome: "nothing", provider: "groq" });
    expect(await runMemoryExtraction({ turn, call: call("{\"shouldRemember\": true, \"memories\": [1]}") })).toMatchObject({ outcome: "candidates", memories: [1] });
    const never = vi.fn();
    expect(await runMemoryExtraction({ turn: { currentMessage: "bunu hatırlama" }, call: never })).toEqual({ outcome: "skipped", reason: "explicit_no_remember", provider: null });
    expect(never).not.toHaveBeenCalled();
  });

  it("parseMemoryExtractionPayload follows extractJsonPayload + getMemoryExtractionCandidates", () => {
    expect(parseMemoryExtractionPayload("<think>x</think>```json\n{\"shouldRemember\": true, \"memories\": []}\n```")).toEqual({ kind: "candidates", memories: [] });
    expect(parseMemoryExtractionPayload("null")).toEqual({ kind: "nothing" });
    expect(parseMemoryExtractionPayload("{")).toEqual({ kind: "invalid_json" });
  });
});

describe("callMemoryExtractionProviders: the Ollama step", () => {
  function mockFetch(reply: () => Response) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    return { calls, fetch: async (url: string, init: RequestInit) => { calls.push({ url, init }); return reply(); } };
  }
  const base = { system: "SYS", user: "USER" };

  it("sends production's former inline request after Groq and Gemini fail", async () => {
    const timeouts: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => { timeouts.push(ms); return new AbortController().signal; });
    const replies = [new Response("down", { status: 503 }), new Response(JSON.stringify({ message: { content: "{\"x\":1}" } }))];
    const m = mockFetch(() => replies.shift()!);
    const out = await callMemoryExtractionProviders({ ...base, fetch: m.fetch, groqKey: "gsk_k", ollamaUrl: "http://ollama.test:11434//", ollamaModel: "gemma4:12b-mlx" });
    expect(out).toEqual({ text: "{\"x\":1}", provider: "ollama", model: "gemma4:12b-mlx" });
    expect(m.calls.map((c) => c.url)).toEqual(["https://api.groq.com/openai/v1/chat/completions", "http://ollama.test:11434/api/chat"]);
    const req = buildOllamaExtractionRequest("http://ollama.test:11434//", "gemma4:12b-mlx", "SYS", "USER");
    expect(m.calls[1]!.init).toMatchObject(req.init);
    expect(req.init).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemma4:12b-mlx",
        messages: [{ role: "system", content: "SYS" }, { role: "user", content: "USER" }],
        stream: false,
        options: { temperature: 0.1 }
      })
    });
    expect(timeouts).toEqual([20_000, OLLAMA_EXTRACTION_TIMEOUT_MS]);
    expect(OLLAMA_EXTRACTION_TIMEOUT_MS).toBe(30_000);
  });

  it("skips a missing or placeholder URL", async () => {
    for (const url of [undefined, null, "", "https://placeholder.example"]) {
      expect(isUsableOllamaUrl(url)).toBe(false);
      const m = mockFetch(() => new Response("{}"));
      expect(await callMemoryExtractionProviders({ ...base, fetch: m.fetch, ollamaUrl: url })).toBeNull();
      expect(m.calls).toEqual([]);
    }
  });

  it("reports only a thrown error, with the error itself; HTTP errors and empty or non-string answers are silent", async () => {
    const errors: ExtractionProviderError[] = [];
    const onProviderError = (e: ExtractionProviderError) => errors.push(e);
    const boom = new Error("connect ECONNREFUSED");
    for (const reply of [
      () => new Response("model not loaded", { status: 500 }),
      () => new Response(JSON.stringify({ message: { content: "" } })),
      () => new Response(JSON.stringify({ message: { content: { nested: true } } })),
      () => new Response("null")
    ]) {
      expect(await callMemoryExtractionProviders({ ...base, fetch: mockFetch(reply).fetch, ollamaUrl: "http://o", ollamaModel: "m", onProviderError })).toBeNull();
    }
    expect(errors).toEqual([]);
    const thrown = await callMemoryExtractionProviders({ ...base, fetch: async () => { throw boom; }, ollamaUrl: "http://o", ollamaModel: "m", onProviderError });
    expect(thrown).toBeNull();
    expect(errors).toEqual([{ provider: "ollama", model: "m", detail: "connect ECONNREFUSED", error: boom }]);
  });
});

describe("production extraction module", () => {
  async function turn(userMessage: string, fetchReply: () => Response) {
    const logs: unknown[][] = [];
    const persisted: unknown[] = [];
    const fetch = vi.fn(async () => fetchReply());
    const extract = createExtractAndPersistMemories({
      fetch,
      logger: { info: (...a: unknown[]) => logs.push(a), warn: (...a: unknown[]) => logs.push(a) },
      now: () => 1,
      getEmbedding: async () => ({ values: [1], model: "m" }),
      errMessage: (e: unknown) => String((e as Error)?.message || e),
      memoryExtractionModel: "openai/gpt-oss-20b",
      geminiExtractionModel: "gemini-3.1-flash-lite",
      persist: async (p: { memories: unknown[] }) => { persisted.push(p.memories); }
    });
    const summary = await extract({
      db: {}, ollamaUrl: "http://o", ollamaModel: "m", evrenKey: undefined, groqKey: "gsk_k", geminiKey: "AQ.k",
      userMessage, assistantResponse: "Noted, sir.", userId: "u", projectId: null, conversationId: "c", sourceMessageIds: [], recentHistory: []
    });
    return { summary, logs, persisted, fetch };
  }

  it("answers 'don't remember this' without a model call", async () => {
    const r = await turn("Do not remember this", () => { throw new Error("no call expected"); });
    expect(r.fetch).not.toHaveBeenCalled();
    expect(r.summary).toEqual({
      outcome: "nothing", count: 0, extractor_provider: null,
      stored: 0, superseded: 0, retracted: 0, duplicate: 0, rejected: 0, invalid: 0, failed: 0,
      skip_reason: "explicit_no_remember"
    });
    expect(r.logs).toEqual([]);
  });

  it("an Ollama answer with non-string content ends the turn as failed instead of throwing", async () => {
    const replies = [new Response("x", { status: 500 }), new Response("x", { status: 500 }), new Response(JSON.stringify({ message: { content: [1, 2] } }))];
    const r = await turn("I use Vim.", () => replies.shift()!);
    expect(r.summary).toMatchObject({ outcome: "failed", extractor_provider: null });
    expect(r.persisted).toEqual([]);
  });

  it("hands the raw candidates to persistence", async () => {
    const memories = [{ content: "Barış uses Vim.", confidence: 0.9 }];
    const r = await turn("I use Vim.", () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shouldRemember: true, memories }) } }] })));
    expect(r.persisted).toEqual([memories]);
    expect(r.summary).toMatchObject({ outcome: "nothing", extractor_provider: "groq" });
  });
});

describe("MemoryExtractor on the shared pipeline", () => {
  it("defaults to the Groq -> Gemini -> Ollama chain from the environment", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_env");
    vi.stubEnv("GEMINI_API_KEY", "AQ.env");
    vi.stubEnv("OLLAMA_BASE_URL", "http://ollama.env:11434");
    vi.stubEnv("OLLAMA_MODEL", "llama-env");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const urls: string[] = [];
    const bodies: Array<Record<string, unknown>> = [];
    const extractor = new MemoryExtractor({
      fetch: async (url: string, init: RequestInit) => {
        urls.push(url);
        bodies.push(JSON.parse(String(init.body)));
        if (!url.includes("ollama")) return new Response("busy", { status: 429 });
        return new Response(JSON.stringify({ message: { content: JSON.stringify({ shouldRemember: true, memories: [{ content: "Barış uses Vim.", confidence: 0.9, reasoning: " stated " }] }) } }));
      },
      config: { enabled: true, minConfidence: 0.7, maxContextMessages: 2, timeoutMs: 1000 }
    });
    const history = [{ role: "user", content: "Msg A" }, { role: "assistant", content: "Msg B" }, { role: "user", content: "Msg C" }];
    const result = await extractor.extract({ currentMessage: "I use Vim.", recentMessages: history, userId: "u" });

    expect(urls).toEqual([
      "https://api.groq.com/openai/v1/chat/completions",
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      "http://ollama.env:11434/api/chat"
    ]);
    expect(bodies.map((b) => b.model)).toEqual(["openai/gpt-oss-20b", "gemini-3.1-flash-lite", "llama-env"]);
    const user = (bodies[0]!.messages as Array<{ content: string }>)[1]!.content;
    expect(user).toBe(buildMemoryExtractionUserPrompt({ currentMessage: "I use Vim.", recentMessages: history.slice(-2) }));
    expect(result.candidates).toEqual([{ content: "Barış uses Vim.", action: "create", memoryType: "general", confidence: 0.9, reasoning: "stated" }]);
  });

  it("never logs memory text or the model's output", async () => {
    const spies = [vi.spyOn(console, "log").mockImplementation(() => {}), vi.spyOn(console, "warn").mockImplementation(() => {})];
    const secret = "Barış keeps his bike at the Kadıköy pier.";
    for (const text of [JSON.stringify({ shouldRemember: true, memories: [{ content: secret, confidence: 0.9 }] }), `not json: ${secret}`]) {
      const extractor = new MemoryExtractor({
        call: async () => ({ text, provider: "groq" }),
        config: { enabled: true, minConfidence: 0.7, maxContextMessages: 4, timeoutMs: 1000 }
      });
      await extractor.extract({ currentMessage: secret, userId: "u" });
    }
    for (const spy of spies) {
      for (const args of spy.mock.calls) expect(JSON.stringify(args)).not.toContain("Kadıköy");
    }
  });
});
