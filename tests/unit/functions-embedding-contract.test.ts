import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  EMBEDDING_DIMENSION,
  EMBEDDING_UNAVAILABLE_MESSAGE,
  GEMINI_EMBEDDING_MODEL,
  OLLAMA_EMBEDDING_MODEL,
  buildGeminiEmbedContentRequest,
  buildOllamaEmbedRequest,
  generateEmbedding,
  isComparableEmbedding,
  parseOllamaEmbedding
} from "../../src/ai/embedding/embedding-client.js";
import { GeminiEmbeddingProvider } from "../../src/ai/embedding/gemini-embedding-provider.js";
import { OllamaEmbeddingProvider } from "../../src/ai/embedding/ollama-embedding-provider.js";

/**
 * Production contract for the embedding calls, which functions/index.js now
 * imports from src/ai/embedding/embedding-client.ts (bundled via esbuild).
 * `legacyGetEmbedding` below is a verbatim copy of what functions/index.js
 * carried inline before the migration (only `logger`, `gizliOku`, the secret
 * and `errMessage` are injected). `sharedGetEmbedding` is the wrapper
 * functions/index.js now has. Both run against the same scripted fetch; every
 * request (URL including the key, method, headers, JSON body, signal and
 * timeout), every log call, and the returned value or thrown error must match.
 */

// ---------------------------------------------------------------------------
// Test doubles for the production environment
// ---------------------------------------------------------------------------

interface LogCall {
  message: string;
  fields: Record<string, unknown>;
}

function makeEnv(secretValue = "") {
  const logs: LogCall[] = [];
  const logger = {
    warn: (message: string, fields: Record<string, unknown>) => {
      logs.push({ message, fields });
    }
  };
  const GEMINI_API_KEY = { name: "GEMINI_API_KEY" };
  const gizliOku = (_secret: unknown, _envAdi: string): string => secretValue;
  return { logs, logger, GEMINI_API_KEY, gizliOku };
}

function errMessage(err: unknown): string {
  const e = err as { message?: unknown } | null | undefined;
  return String(e?.message || err || "unknown error").slice(0, 300);
}

type Env = ReturnType<typeof makeEnv>;

// ---------------------------------------------------------------------------
// Verbatim pre-migration production code (functions/index.js)
// ---------------------------------------------------------------------------

const LEGACY_GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
const LEGACY_OLLAMA_EMBEDDING_MODEL = "nomic-embed-text";
const LEGACY_EMBEDDING_DIMENSION = 768;

function legacyKarsilastirilabilir(d: { embedding?: unknown; embeddingModel?: unknown }, model: string): boolean {
  return Array.isArray(d.embedding) && d.embedding.length > 0 && d.embeddingModel === model;
}

async function legacyGetEmbedding(
  env: Env,
  text: string,
  ollamaUrl: string | undefined,
  geminiKey: string | undefined
): Promise<{ values: number[]; model: string }> {
  const { logger, gizliOku, GEMINI_API_KEY } = env;
  const key = (geminiKey || gizliOku(GEMINI_API_KEY, "GEMINI_API_KEY") || "").trim();
  if (key) {
    try {
      const embedRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${LEGACY_GEMINI_EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: `models/${LEGACY_GEMINI_EMBEDDING_MODEL}`,
            content: {
              parts: [{ text: text.trim() }]
            },
            outputDimensionality: LEGACY_EMBEDDING_DIMENSION
          }),
          signal: AbortSignal.timeout(15000)
        }
      );
      if (embedRes.ok) {
        const data = await embedRes.json();
        const values = data?.embedding?.values;
        if (Array.isArray(values) && values.length > 0) {
          return { values, model: LEGACY_GEMINI_EMBEDDING_MODEL };
        }
      } else {
        const errText = await embedRes.text().catch(() => "");
        logger.warn(`[Embedding] Gemini ${LEGACY_GEMINI_EMBEDDING_MODEL} HTTP ${embedRes.status}: ${errText}`, {
          event: "embedding_error", model: LEGACY_GEMINI_EMBEDDING_MODEL, http_status: embedRes.status
        });
      }
    } catch (gErr) {
      logger.warn(`[Embedding] Gemini embedding call failed: ${errMessage(gErr)}`, {
        event: "embedding_error", model: LEGACY_GEMINI_EMBEDDING_MODEL
      });
    }
  }

  // Fallback to Ollama if configured
  if (ollamaUrl && !ollamaUrl.includes("placeholder")) {
    const embedRes = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LEGACY_OLLAMA_EMBEDDING_MODEL,
        input: text
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (embedRes.ok) {
      const data = await embedRes.json();
      const vector = Array.isArray(data.embeddings?.[0])
        ? data.embeddings[0]
        : (Array.isArray(data.embedding) ? data.embedding : null);
      if (vector && Array.isArray(vector)) {
        return { values: vector, model: LEGACY_OLLAMA_EMBEDDING_MODEL };
      }
    }
  }

  throw new Error("[Embedding] Neither Gemini nor Ollama could generate embedding (check GEMINI_API_KEY).");
}

// ---------------------------------------------------------------------------
// The wrapper functions/index.js now carries (same shape, same logging)
// ---------------------------------------------------------------------------

async function sharedGetEmbedding(
  env: Env,
  text: string,
  ollamaUrl: string | undefined,
  geminiKey: string | undefined
): Promise<{ values: number[]; model: string }> {
  const { logger, gizliOku, GEMINI_API_KEY } = env;
  return generateEmbedding(text, {
    geminiApiKey: geminiKey || gizliOku(GEMINI_API_KEY, "GEMINI_API_KEY") || "",
    ollamaUrl,
    onGeminiError: (e) => {
      if (e.kind === "http") {
        logger.warn(`[Embedding] Gemini ${e.model} HTTP ${e.status}: ${e.body}`, {
          event: "embedding_error", model: e.model, http_status: e.status
        });
      } else {
        logger.warn(`[Embedding] Gemini embedding call failed: ${errMessage(e.error)}`, {
          event: "embedding_error", model: e.model
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Scripted fetch
// ---------------------------------------------------------------------------

type Step =
  | { ok: boolean; status: number; json?: () => unknown; text?: () => unknown }
  | { throws: unknown };

interface CapturedRequest {
  url: string;
  method: unknown;
  headers: unknown;
  body: unknown;
  /** Exact serialised body, so key order is pinned too. */
  rawBody: unknown;
  hasSignal: boolean;
  signalAborted: boolean | null;
  initKeys: string[];
}

interface Outcome {
  requests: CapturedRequest[];
  timeouts: number[];
  logs: LogCall[];
  result?: unknown;
  error?: { name: string; message: string };
}

function jsonStep(body: unknown, status = 200): Step {
  return { ok: status >= 200 && status < 300, status, json: () => body, text: () => JSON.stringify(body) };
}

function errorStep(status: number, text: string): Step {
  return { ok: false, status, json: () => { throw new Error("not json"); }, text: () => text };
}

async function run(
  impl: typeof legacyGetEmbedding,
  steps: Step[],
  args: { text: string; ollamaUrl?: string; geminiKey?: string; secret?: string }
): Promise<Outcome> {
  const env = makeEnv(args.secret ?? "");
  const requests: CapturedRequest[] = [];
  const timeouts: number[] = [];
  const queue = [...steps];

  const realTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    timeouts.push(ms);
    return realTimeout(ms);
  });

  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method,
      headers: init?.headers,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      rawBody: init?.body,
      hasSignal: init?.signal instanceof AbortSignal,
      signalAborted: init?.signal ? init.signal.aborted : null,
      initKeys: Object.keys(init ?? {}).sort()
    });
    const step = queue.shift();
    if (!step) throw new Error("unexpected fetch");
    if ("throws" in step) throw step.throws;
    return {
      ok: step.ok,
      status: step.status,
      json: async () => step.json?.(),
      text: async () => step.text?.()
    } as unknown as Response;
  });

  const outcome: Outcome = { requests, timeouts, logs: env.logs };
  try {
    outcome.result = await impl(env, args.text, args.ollamaUrl, args.geminiKey);
  } catch (err: unknown) {
    const e = err as Error;
    outcome.error = { name: e.name, message: e.message };
  } finally {
    timeoutSpy.mockRestore();
    vi.unstubAllGlobals();
  }
  expect(queue, "every scripted response is consumed").toHaveLength(0);
  return outcome;
}

async function expectSame(
  steps: Step[],
  args: { text: string; ollamaUrl?: string; geminiKey?: string; secret?: string }
): Promise<Outcome> {
  const legacy = await run(legacyGetEmbedding, steps, args);
  const shared = await run(sharedGetEmbedding, steps, args);
  expect(shared).toEqual(legacy);
  return shared;
}

const GEMINI_URL_PREFIX = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=";
const OLLAMA = "http://ollama.local:11434/";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("getEmbedding: shared client vs verbatim production code", () => {
  it("Gemini OK returns the Gemini vector with the exact request", async () => {
    const out = await expectSame([jsonStep({ embedding: { values: [0.1, 0.2, 0.3] } })], {
      text: "  Barış prefers TypeScript  ",
      ollamaUrl: OLLAMA,
      geminiKey: " key/with+chars= "
    });
    expect(out.result).toEqual({ values: [0.1, 0.2, 0.3], model: "gemini-embedding-001" });
    expect(out.requests).toEqual([
      {
        url: `${GEMINI_URL_PREFIX}key%2Fwith%2Bchars%3D`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          model: "models/gemini-embedding-001",
          content: { parts: [{ text: "Barış prefers TypeScript" }] },
          outputDimensionality: 768
        },
        rawBody: '{"model":"models/gemini-embedding-001","content":{"parts":[{"text":"Barış prefers TypeScript"}]},"outputDimensionality":768}',
        hasSignal: true,
        signalAborted: false,
        initKeys: ["body", "headers", "method", "signal"]
      }
    ]);
    expect(out.timeouts).toEqual([15000]);
    expect(out.logs).toEqual([]);
  });

  it("uses the Secret Manager key when no key is passed", async () => {
    const out = await expectSame([jsonStep({ embedding: { values: [1] } })], {
      text: "x",
      secret: "secret-key"
    });
    expect(out.requests[0].url).toBe(`${GEMINI_URL_PREFIX}secret-key`);
  });

  it("Gemini non-OK logs embedding_error with the status and falls back to Ollama", async () => {
    const out = await expectSame(
      [errorStep(403, "API key invalid"), jsonStep({ embeddings: [[0.5, 0.6]] })],
      { text: "  hello  ", ollamaUrl: OLLAMA, geminiKey: "k" }
    );
    expect(out.result).toEqual({ values: [0.5, 0.6], model: "nomic-embed-text" });
    expect(out.logs).toEqual([
      {
        message: "[Embedding] Gemini gemini-embedding-001 HTTP 403: API key invalid",
        fields: { event: "embedding_error", model: "gemini-embedding-001", http_status: 403 }
      }
    ]);
    expect(out.requests[1]).toEqual({
      url: "http://ollama.local:11434/api/embed",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { model: "nomic-embed-text", input: "  hello  " },
      rawBody: '{"model":"nomic-embed-text","input":"  hello  "}',
      hasSignal: true,
      signalAborted: false,
      initKeys: ["body", "headers", "method", "signal"]
    });
    expect(out.timeouts).toEqual([15000, 15000]);
    expect(JSON.stringify(out.logs)).not.toContain("key=");
  });

  it("Gemini non-OK whose body cannot be read logs an empty body", async () => {
    const out = await expectSame(
      [{ ok: false, status: 500, text: () => { throw new Error("stream broken"); } }, jsonStep({ embedding: [9] })],
      { text: "t", ollamaUrl: OLLAMA, geminiKey: "k" }
    );
    expect(out.logs[0].message).toBe("[Embedding] Gemini gemini-embedding-001 HTTP 500: ");
  });

  it("Gemini fetch that throws logs the error message and falls back to Ollama", async () => {
    const out = await expectSame(
      [{ throws: new TypeError("fetch failed") }, jsonStep({ embeddings: [[1, 2]] })],
      { text: "t", ollamaUrl: OLLAMA, geminiKey: "k" }
    );
    expect(out.logs).toEqual([
      {
        message: "[Embedding] Gemini embedding call failed: fetch failed",
        fields: { event: "embedding_error", model: "gemini-embedding-001" }
      }
    ]);
    expect(out.result).toEqual({ values: [1, 2], model: "nomic-embed-text" });
  });

  it("Gemini timeout (TimeoutError) is logged and falls back to Ollama", async () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const out = await expectSame([{ throws: timeout }, jsonStep({ embeddings: [[3]] })], {
      text: "t",
      ollamaUrl: OLLAMA,
      geminiKey: "k"
    });
    expect(out.logs[0].message).toBe("[Embedding] Gemini embedding call failed: The operation was aborted due to timeout");
  });

  it("Gemini OK with invalid JSON is logged as a failed call", async () => {
    await expectSame(
      [{ ok: true, status: 200, json: () => { throw new SyntaxError("Unexpected token"); } }, jsonStep({ embeddings: [[3]] })],
      { text: "t", ollamaUrl: OLLAMA, geminiKey: "k" }
    );
  });

  it("Gemini OK without values falls back to Ollama silently", async () => {
    for (const body of [{}, { embedding: {} }, { embedding: { values: [] } }, { embedding: { values: "x" } }, null]) {
      const out = await expectSame([jsonStep(body), jsonStep({ embeddings: [[7]] })], {
        text: "t",
        ollamaUrl: OLLAMA,
        geminiKey: "k"
      });
      expect(out.logs).toEqual([]);
      expect(out.result).toEqual({ values: [7], model: "nomic-embed-text" });
    }
  });

  it("no key (missing, empty or whitespace) goes straight to Ollama", async () => {
    for (const geminiKey of [undefined, "", "   "]) {
      const out = await expectSame([jsonStep({ embeddings: [[4]] })], { text: "t", ollamaUrl: OLLAMA, geminiKey });
      expect(out.requests.map((r) => r.url)).toEqual(["http://ollama.local:11434/api/embed"]);
      expect(out.logs).toEqual([]);
    }
  });

  it("Ollama: embeddings[0] wins over embedding, embedding is the fallback", async () => {
    const both = await expectSame([jsonStep({ embeddings: [[1]], embedding: [2] })], { text: "t", ollamaUrl: OLLAMA });
    expect(both.result).toEqual({ values: [1], model: "nomic-embed-text" });
    const legacyShape = await expectSame([jsonStep({ embedding: [2, 3] })], { text: "t", ollamaUrl: OLLAMA });
    expect(legacyShape.result).toEqual({ values: [2, 3], model: "nomic-embed-text" });
    const badFirst = await expectSame([jsonStep({ embeddings: ["x"], embedding: [5] })], { text: "t", ollamaUrl: OLLAMA });
    expect(badFirst.result).toEqual({ values: [5], model: "nomic-embed-text" });
    const emptyVector = await expectSame([jsonStep({ embeddings: [[]] })], { text: "t", ollamaUrl: OLLAMA });
    expect(emptyVector.result).toEqual({ values: [], model: "nomic-embed-text" });
  });

  it("Ollama non-OK or without a vector throws the exact final error", async () => {
    for (const step of [errorStep(500, "boom"), jsonStep({}), jsonStep({ embeddings: [] }), jsonStep({ embedding: "x" })]) {
      const out = await expectSame([step], { text: "t", ollamaUrl: OLLAMA });
      expect(out.error).toEqual({
        name: "Error",
        message: "[Embedding] Neither Gemini nor Ollama could generate embedding (check GEMINI_API_KEY)."
      });
    }
  });

  it("Ollama returning a null body throws the same TypeError", async () => {
    const out = await expectSame([jsonStep(null)], { text: "t", ollamaUrl: OLLAMA });
    expect(out.error?.name).toBe("TypeError");
  });

  it("Ollama fetch that throws propagates the original error", async () => {
    const out = await expectSame([{ throws: new TypeError("connect ECONNREFUSED") }], { text: "t", ollamaUrl: OLLAMA });
    expect(out.error).toEqual({ name: "TypeError", message: "connect ECONNREFUSED" });
  });

  it("strips every trailing slash from the Ollama URL", async () => {
    const out = await expectSame([jsonStep({ embeddings: [[1]] })], { text: "t", ollamaUrl: "http://h:1///" });
    expect(out.requests[0].url).toBe("http://h:1/api/embed");
  });

  it("skips a placeholder or missing Ollama URL", async () => {
    for (const ollamaUrl of ["https://placeholder.ollama", "http://placeholder", "", undefined]) {
      const out = await expectSame([], { text: "t", ollamaUrl });
      expect(out.requests).toEqual([]);
      expect(out.error?.message).toBe(EMBEDDING_UNAVAILABLE_MESSAGE);
    }
  });

  it("both fail: Gemini logged, Ollama non-OK, exact error text", async () => {
    const out = await expectSame([errorStep(429, "quota"), errorStep(503, "down")], {
      text: "t",
      ollamaUrl: OLLAMA,
      geminiKey: "k"
    });
    expect(out.logs).toHaveLength(1);
    expect(out.error).toEqual({
      name: "Error",
      message: "[Embedding] Neither Gemini nor Ollama could generate embedding (check GEMINI_API_KEY)."
    });
  });

  it("Gemini failure with no Ollama configured throws after logging", async () => {
    const out = await expectSame([{ throws: new Error("x") }], { text: "t", ollamaUrl: "placeholder", geminiKey: "k" });
    expect(out.logs).toHaveLength(1);
    expect(out.error?.message).toBe(EMBEDDING_UNAVAILABLE_MESSAGE);
  });
});

describe("shared constants and helpers match production", () => {
  it("keeps the model names and dimension", () => {
    expect(GEMINI_EMBEDDING_MODEL).toBe(LEGACY_GEMINI_EMBEDDING_MODEL);
    expect(OLLAMA_EMBEDDING_MODEL).toBe(LEGACY_OLLAMA_EMBEDDING_MODEL);
    expect(EMBEDDING_DIMENSION).toBe(LEGACY_EMBEDDING_DIMENSION);
  });

  it("isComparableEmbedding matches karsilastirilabilir", () => {
    const records = [
      { embedding: [1], embeddingModel: "gemini-embedding-001" },
      { embedding: [], embeddingModel: "gemini-embedding-001" },
      { embedding: [1], embeddingModel: "nomic-embed-text" },
      { embedding: "x", embeddingModel: "gemini-embedding-001" },
      { embeddingModel: "gemini-embedding-001" },
      {}
    ];
    for (const r of records) {
      for (const model of ["gemini-embedding-001", "nomic-embed-text"]) {
        expect(isComparableEmbedding(r, model)).toBe(legacyKarsilastirilabilir(r, model));
      }
    }
  });

  it("parseOllamaEmbedding throws on a null body like production", () => {
    expect(() => parseOllamaEmbedding(null)).toThrow(TypeError);
  });
});

describe("src providers build the same requests through the shared builders", () => {
  it("GeminiEmbeddingProvider.embed sends the builder's request", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFn: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => ({ embedding: { values: [1] } }) } as unknown as Response;
    };
    const provider = new GeminiEmbeddingProvider({ apiKey: "k", model: "gemini-embedding-001", dimension: 768, fetchFn });
    await provider.embed(" hi ");
    const expected = buildGeminiEmbedContentRequest(" hi ", "k");
    expect(calls[0].url).toBe(expected.url);
    expect(calls[0].init?.body).toBe(expected.init.body);
    expect(calls[0].init?.headers).toEqual(expected.init.headers);
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("OllamaEmbeddingProvider.embed sends the builder's request", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchFn: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => ({ embeddings: [[1]] }) } as unknown as Response;
    };
    const provider = new OllamaEmbeddingProvider({
      config: { baseUrl: "http://h:1/", model: "nomic-embed-text", dimension: 1, timeoutMs: 1000 },
      fetchFn
    });
    await provider.embed("hi");
    const expected = buildOllamaEmbedRequest("http://h:1", "hi");
    expect(calls[0].url).toBe(expected.url);
    expect(calls[0].init?.body).toBe(expected.init.body);
  });
});

describe("functions/index.js uses the shared embedding client", () => {
  const source = readFileSync(new URL("../../functions/index.js", import.meta.url), "utf8");

  it("imports it instead of carrying a copy", () => {
    expect(source).toMatch(/generateEmbedding,[\s\S]*from "\.\.\/src\/ai\/embedding\/embedding-client\.js"/);
    expect(source).not.toContain("generativelanguage.googleapis.com");
    expect(source).not.toContain("/api/embed`");
    expect(source).not.toMatch(/function\s+karsilastirilabilir\s*\(/);
  });

  it("still logs both embedding_error shapes", () => {
    expect(source).toContain('logger.warn(`[Embedding] Gemini ${e.model} HTTP ${e.status}: ${e.body}`');
    expect(source).toContain('event: "embedding_error", model: e.model, http_status: e.status');
    expect(source).toContain('logger.warn(`[Embedding] Gemini embedding call failed: ${errMessage(e.error)}`');
  });
});
