import { describe, it, expect } from "vitest";
import {
  createChatTurnMetrics,
  createChatTurnState,
  runChatTurnWithFallback,
  NO_PROVIDER_CONFIGURED_MESSAGE,
  type ChatTurnDeps,
  type LogSeverity
} from "../../src/ai/providers/chat-fallback/chat-turn.js";
import { CHAT_PROVIDER_ORDER, resolveChatProviders, type ChatProviderEnv } from "../../src/ai/providers/chat-fallback/chat-providers.js";
import { FALLBACK_EXHAUSTED_NOTE, toChatTurnErrorEvent } from "../../src/ai/providers/chat-fallback/failover.js";
import { buildAlfredSystemPrompt } from "../../src/ai/prompts/alfred-system-prompt.js";
import { GET_CURRENT_TIME_TOOL_DEFINITION, runGetCurrentTimeTool } from "../../src/ai/tools/time/current-time.js";
import {
  GEMINI_SIGNATURE,
  GROQ_TPD_429,
  GROQ_TPM_429,
  cerebrasText,
  geminiText,
  geminiToolCalls,
  groqPartialThenError,
  groqStreamError,
  groqText,
  groqToolCall,
  openRouterMidStreamError,
  openRouterText,
  sse
} from "./fixtures/chat-provider-streams.js";

// The whole production turn (functions/index.js -> runChatTurnWithFallback)
// against mocked fetch responses. No network.

const KEYS = { groq: "gsk_secret_groq", gemini: "AQ.secret_gemini", cerebras: "csk-secret", openrouter: "sk-or-secret" };
const ALL_KEYS = Object.values(KEYS);

type Reply = { status?: number; body?: string; headers?: Record<string, string> } | Error;

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  bodyText: string;
}

function harness(replies: Reply[], options: { keys?: Partial<typeof KEYS>; env?: ChatProviderEnv } = {}) {
  // The Cerebras steps are tested explicitly; production's default order omits them.
  const { providers } = resolveChatProviders(options.keys ?? KEYS, { CHAT_FALLBACK_ORDER: CHAT_PROVIDER_ORDER.join(","), ...(options.env ?? {}) });
  const calls: Call[] = [];
  const events: Array<Record<string, unknown>> = [];
  const logs: Array<{ severity: LogSeverity; event: string; message: string; fields: Record<string, unknown> }> = [];
  const sleeps: number[] = [];
  const queue = [...replies];
  const metrics = createChatTurnMetrics(providers[0]?.id ?? "groq", providers[0]?.model ?? "openai/gpt-oss-120b");
  const state = createChatTurnState();
  const history = [{ role: "user", content: "Önceki soru" }, { role: "assistant", content: "Önceki cevap" }];
  const deps: ChatTurnDeps = {
    providers,
    buildMessages: (runtime) => [
      { role: "system", content: buildAlfredSystemPrompt({ runtime: { provider: runtime.id, model: runtime.model } }) },
      ...history,
      { role: "user", content: "Saat kaç? Tokyo ve Londra" }
    ],
    tools: [GET_CURRENT_TIME_TOOL_DEFINITION],
    maxTurns: 3,
    runTool: (name, args) =>
      name === "get_current_time" ? runGetCurrentTimeTool(args as Parameters<typeof runGetCurrentTimeTool>[0], new Date("2026-09-24T11:43:00Z")) : { error: `Tool ${name} not recognized.` },
    fetch: async (url, init) => {
      const bodyText = String(init.body);
      calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(bodyText), bodyText });
      const reply = queue.shift();
      if (!reply) throw new Error(`unexpected call #${calls.length} to ${url}`);
      if (reply instanceof Error) throw reply;
      return new Response(reply.body ?? "", { status: reply.status ?? 200, headers: reply.headers });
    },
    sendEvent: (e) => events.push(e),
    sleep: async (ms) => { sleeps.push(ms); },
    logEvent: (severity, event, message, fields) => logs.push({ severity, event, message, fields }),
    metrics,
    state
  };
  const run = () => runChatTurnWithFallback(deps);
  const types = () => events.map((e) => e.type);
  const systemPromptOf = (i: number) => ((calls[i].body.messages as Array<{ content: string }>)[0]).content;
  return { deps, run, calls, events, types, logs, sleeps, metrics, state, systemPromptOf, remaining: () => queue.length };
}

const json = (obj: unknown) => JSON.stringify(obj);

describe("runChatTurnWithFallback", () => {
  it("Groq happy path: one call, request exactly as before, no fallback events", async () => {
    const h = harness([{ body: groqText("İyi ", "günler, efendim.") }]);
    await expect(h.run()).resolves.toEqual({ providerId: "groq", model: "openai/gpt-oss-120b" });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(h.calls[0].headers).toEqual({ "Content-Type": "application/json", "Authorization": "Bearer gsk_secret_groq" });
    expect(Object.keys(h.calls[0].body)).toEqual(["model", "messages", "stream", "temperature", "max_tokens", "tools"]);
    expect(h.calls[0].bodyText).toBe(json({
      model: "openai/gpt-oss-120b",
      messages: h.deps.buildMessages({ id: "groq", model: "openai/gpt-oss-120b" }),
      stream: true,
      temperature: 0.6,
      max_tokens: 1500,
      tools: [GET_CURRENT_TIME_TOOL_DEFINITION]
    }));
    expect(h.types()).toEqual(["chunk", "chunk"]);
    expect(h.state.accumulatedText).toBe("İyi günler, efendim.");
    expect(h.state.streamedToUser).toBe(true);
    expect(h.metrics).toMatchObject({
      provider: "groq", llm_calls: 1, total_tokens: 2140, reasoning_tokens: 12, fallback_from: [], attempted_providers: ["groq"]
    });
    expect(h.logs.filter((l) => l.event === "llm_provider_fallback")).toEqual([]);
  });

  it("Groq tool round: tools on every round except the last, tool results fed back", async () => {
    const h = harness([{ body: groqToolCall(["Tokyo", "Londra"]) }, { body: groqText("Tokyo'da 20:43, Londra'da 12:43.") }]);
    await h.run();
    expect(h.calls.map((c) => "tools" in c.body)).toEqual([true, true]);
    const second = h.calls[1].body.messages as Array<Record<string, unknown>>;
    expect(second.at(-2)).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_groq_1", type: "function", function: { name: "get_current_time", arguments: json({ cities: ["Tokyo", "Londra"] }) } }]
    });
    expect(second.at(-1)).toMatchObject({ role: "tool", tool_call_id: "call_groq_1" });
    expect(JSON.parse(String(second.at(-1)?.content)).results).toHaveLength(2);
    expect(h.types()).toEqual(["tool_call", "tool_call", "tool_result", "chunk"]);
    expect(h.metrics).toMatchObject({ llm_calls: 2, tool_rounds: 1, tool_calls: 1, total_tokens: 4280 });
    expect(h.logs.find((l) => l.event === "tool_call")?.fields).toMatchObject({ tool: "get_current_time", provider: "groq", round: 1, outcome: "ok" });
  });

  it("offers no tools on the last round", async () => {
    const h = harness([{ body: groqToolCall(["Tokyo"]) }, { body: groqToolCall(["Londra"]) }, { body: groqText("Tamam.") }]);
    await h.run();
    expect(h.calls.map((c) => "tools" in c.body)).toEqual([true, true, false]);
  });

  it("waits out a Groq TPM 429 that fits the budget and stays on Groq", async () => {
    const h = harness([{ status: 429, body: json(GROQ_TPM_429) }, { body: groqText("Buyurun.") }]);
    await h.run();
    expect(h.sleeps).toEqual([3000]);
    expect(h.events.slice(0, 2)).toEqual([{ type: "rate_limited", provider: "groq", waitMs: 3000, attempt: 1 }, { type: "thinking" }]);
    expect(h.types()).not.toContain("provider_fallback");
    expect(h.metrics).toMatchObject({ rate_limit_retries: 1, rate_limit_wait_ms: 3000, attempted_providers: ["groq"] });
  });

  it("Groq TPD 429 -> Gemini at once, with a prompt naming Gemini", async () => {
    const h = harness([{ status: 429, body: json(GROQ_TPD_429) }, { body: geminiText("Buyurun, efendim.") }]);
    await expect(h.run()).resolves.toEqual({ providerId: "gemini", model: "gemini-3.8-flash" });
    expect(h.sleeps).toEqual([]);
    expect(h.events[0]).toEqual({ type: "provider_fallback", from: "groq", to: "gemini", model: "gemini-3.8-flash", reason: "rate_limited" });
    expect(h.types()).toEqual(["provider_fallback", "chunk"]);

    expect(h.calls[1].url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(h.calls[1].headers.Authorization).toBe("Bearer AQ.secret_gemini");
    expect(h.calls[1].body).toMatchObject({ model: "gemini-3.8-flash", reasoning_effort: "low", stream_options: { include_usage: true } });
    // The capability line is rebuilt for the provider that answers.
    expect(h.systemPromptOf(0)).toContain("reasoning via Groq (openai/gpt-oss-120b),");
    expect(h.systemPromptOf(1)).toContain("reasoning via Google Gemini (gemini-3.8-flash), standing in because Groq is unavailable,");
    expect(h.systemPromptOf(1)).toContain("→ Google Gemini API (gemini-3.8-flash) → SSE response.");
    expect(h.systemPromptOf(1)).not.toContain("reasoning via Groq");

    expect(h.metrics).toMatchObject({ provider: "gemini", model: "gemini-3.8-flash", fallback_from: ["groq"], attempted_providers: ["groq", "gemini"] });
    const rl = h.logs.find((l) => l.event === "llm_rate_limited");
    expect(rl?.fields).toMatchObject({ provider: "groq", limit_type: "tpd", decision: "give_up", outcome: "daily_limit", wait_ms: 0 });
    const fb = h.logs.find((l) => l.event === "llm_provider_fallback");
    expect(fb?.severity).toBe("WARNING");
    expect(fb?.fields).toMatchObject({ from: "groq", from_model: "openai/gpt-oss-120b", to: "gemini", to_model: "gemini-3.8-flash", reason: "rate_limited", http_status: 429 });
  });

  it.each<[string, Reply, string]>([
    ["5xx", { status: 503, body: "over capacity" }, "server_error"],
    ["network error", new TypeError("fetch failed"), "network_error"],
    ["timeout", Object.assign(new Error("timed out"), { name: "TimeoutError" }), "timeout"],
    ["stream error", { body: groqStreamError() }, "stream_error"]
  ])("Groq %s -> Gemini", async (_label, reply, reason) => {
    const h = harness([reply, { body: geminiText("Buyurun.") }]);
    await h.run();
    expect(h.events[0]).toMatchObject({ type: "provider_fallback", from: "groq", to: "gemini", reason });
    expect(h.state.accumulatedText).toBe("Buyurun.");
  });

  it("a non-429 4xx also moves on, logged at ERROR with a hint", async () => {
    const h = harness([{ status: 401, body: json({ error: { message: "Invalid API Key" } }) }, { body: geminiText("Buyurun.") }]);
    await h.run();
    const fb = h.logs.find((l) => l.event === "llm_provider_fallback");
    expect(fb?.severity).toBe("ERROR");
    expect(fb?.fields).toMatchObject({ reason: "client_error", http_status: 401 });
    expect(String(fb?.fields.note)).toContain("check this provider's key");
  });

  it("never switches after partial text reached the user", async () => {
    const h = harness([{ body: groqPartialThenError() }, { body: geminiText("never used") }]);
    await expect(h.run()).rejects.toMatchObject({ code: "stream_error" });
    expect(h.calls).toHaveLength(1);
    expect(h.remaining()).toBe(1);
    expect(h.types()).toEqual(["chunk"]);
    expect(h.state.accumulatedText).toBe("Efendim, ");
    expect(h.metrics.attempted_providers).toEqual(["groq"]);
  });

  it("a tool call on the last round (no tools offered) fails over instead of ending with an empty answer", async () => {
    // Gemini keeps calling tools; on round 3 it was offered none.
    const h = harness(
      [{ body: geminiToolCalls() }, { body: geminiToolCalls() }, { body: geminiToolCalls() }, { body: openRouterText("Tokyo'da 20:43.") }],
      { keys: { gemini: KEYS.gemini, openrouter: KEYS.openrouter } }
    );
    await h.run();
    expect(h.calls.map((c) => "tools" in c.body)).toEqual([true, true, false, true]);
    // The last-round calls are not run: two rounds of tool results only.
    expect(h.metrics).toMatchObject({ tool_rounds: 2 });
    expect(h.logs.find((l) => l.event === "llm_stream_error")?.fields).toMatchObject({ provider: "gemini", round: 3, code: "tool_call_without_tools" });
    expect(h.events.find((e) => e.type === "provider_fallback")).toMatchObject({ from: "gemini", to: "openrouter" });
    expect(h.state.accumulatedText).toBe("Tokyo'da 20:43.");
  });

  it("keeps last-round text as the answer when the model adds a tool call after it", async () => {
    const textThenCall = sse(
      { choices: [{ index: 0, delta: { role: "assistant", content: "Tokyo'da 20:43." } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c9", type: "function", function: { name: "get_current_time", arguments: "{}" } }] }, finish_reason: "tool_calls" }] }
    );
    const h = harness(
      [{ body: geminiToolCalls() }, { body: geminiToolCalls() }, { body: textThenCall }],
      { keys: { gemini: KEYS.gemini, openrouter: KEYS.openrouter } }
    );
    await h.run();
    expect(h.calls).toHaveLength(3);
    expect(h.state.accumulatedText).toBe("Tokyo'da 20:43.");
    expect(h.types()).not.toContain("provider_fallback");
    expect(h.metrics).toMatchObject({ tool_rounds: 2 });
  });

  it("restarts from the user's message on the next provider (no cross-provider tool history)", async () => {
    const h = harness([
      { body: groqToolCall(["Tokyo"]) },
      { status: 500, body: "boom" },
      { body: geminiText("Tokyo'da 20:43.") }
    ]);
    await h.run();
    const geminiMessages = h.calls[2].body.messages as Array<{ role: string }>;
    expect(geminiMessages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(h.types()).toEqual(["tool_call", "tool_call", "tool_result", "provider_fallback", "chunk"]);
  });

  it("echoes Gemini's thought signature with its tool call on the next request", async () => {
    const h = harness([{ status: 429, body: json(GROQ_TPD_429) }, { body: geminiToolCalls() }, { body: geminiText("Tokyo 20:43, Londra 12:43.") }]);
    await h.run();
    const messages = h.calls[2].body.messages as Array<Record<string, unknown>>;
    const assistant = messages.find((m) => m.role === "assistant" && m.tool_calls) as { tool_calls: Array<Record<string, unknown>> };
    expect(assistant.tool_calls).toEqual([
      {
        id: "function-call-111",
        type: "function",
        function: { name: "get_current_time", arguments: json({ cities: ["Tokyo"] }) },
        extra_content: { google: { thought_signature: GEMINI_SIGNATURE } }
      },
      { id: "function-call-222", type: "function", function: { name: "get_current_time", arguments: json({ cities: ["Londra"] }) } }
    ]);
    expect(messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual(["function-call-111", "function-call-222"]);
    expect(h.metrics).toMatchObject({ tool_rounds: 1, tool_calls: 2, provider: "gemini" });
  });

  it("Cerebras gpt-oss-120b 429 goes straight to Cerebras qwen without waiting", async () => {
    const h = harness(
      [{ status: 429, body: json({ error: { message: "Requests per minute limit exceeded" } }), headers: { "retry-after": "8" } }, { body: cerebrasText("Buyurun.") }],
      { keys: { cerebras: KEYS.cerebras } }
    );
    await expect(h.run()).resolves.toEqual({ providerId: "cerebras_secondary", model: "qwen-3.8-27b" });
    expect(h.sleeps).toEqual([]);
    expect(h.types()).not.toContain("rate_limited");
    expect(h.events[0]).toEqual({ type: "provider_fallback", from: "cerebras", to: "cerebras_secondary", model: "qwen-3.8-27b", reason: "rate_limited" });
    expect(h.calls.map((c) => c.body.model)).toEqual(["gpt-oss-120b", "qwen-3.8-27b"]);
    expect(h.calls[1].body).toMatchObject({ reasoning_effort: "low" });
    expect(h.logs.find((l) => l.event === "llm_rate_limited")?.fields).toMatchObject({ provider: "cerebras", outcome: "fallback_preferred" });
    expect(h.systemPromptOf(1)).toContain("reasoning via Cerebras (qwen-3.8-27b), standing in because Groq is unavailable,");
  });

  it("the last provider waits out a waitable 429 instead of giving up", async () => {
    const h = harness(
      [{ status: 429, body: json({ error: { message: "slow down" } }), headers: { "retry-after": "4" } }, { body: openRouterText("Buyurun.") }],
      { keys: { openrouter: KEYS.openrouter } }
    );
    await h.run();
    expect(h.sleeps).toEqual([4000]);
    expect(h.calls[0].headers).toMatchObject({ "HTTP-Referer": "https://butler-alfred.web.app", "X-Title": "B.U.T.L.E.R. Alfred" });
  });

  it("walks the whole chain and reports the first rate-limit error with a note when all fail", async () => {
    const h = harness([
      { status: 429, body: json(GROQ_TPD_429) },
      { status: 500, body: json([{ error: { code: 500, message: "Internal error", status: "INTERNAL" } }]) },
      { status: 429, body: json({ error: { message: "Requests per minute limit exceeded" } }) },
      new TypeError("fetch failed"),
      { body: openRouterMidStreamError() }
    ]);
    const err = await h.run().catch((e: unknown) => e);
    expect(h.events.filter((e) => e.type === "provider_fallback").map((e) => [e.from, e.to, e.reason])).toEqual([
      ["groq", "gemini", "rate_limited"],
      ["gemini", "cerebras", "server_error"],
      ["cerebras", "cerebras_secondary", "rate_limited"],
      ["cerebras_secondary", "openrouter", "network_error"]
    ]);
    expect(h.metrics.attempted_providers).toEqual(["groq", "gemini", "cerebras", "cerebras_secondary", "openrouter"]);
    expect(h.metrics.fallback_from).toEqual(["groq", "gemini", "cerebras", "cerebras_secondary"]);
    const event = toChatTurnErrorEvent(err);
    expect(event).toMatchObject({ code: "rate_limited", limitType: "tpd" });
    expect(event.error).toBe(`Groq'un günlük token limiti doldu. Lütfen yaklaşık 3 dakika sonra tekrar deneyin. ${FALLBACK_EXHAUSTED_NOTE}`);
    expect(h.logs.find((l) => l.event === "llm_stream_error")?.fields).toMatchObject({ provider: "openrouter", code: "server_error" });
  });

  it("never logs or sends an API key", async () => {
    const h = harness([
      { status: 429, body: json(GROQ_TPD_429) },
      { status: 401, body: "unauthorized" },
      { status: 503, body: "" },
      { status: 503, body: "" },
      { body: openRouterText("Tamam.") }
    ]);
    await h.run();
    const visible = JSON.stringify({ logs: h.logs, events: h.events, metrics: h.metrics });
    for (const key of ALL_KEYS) expect(visible).not.toContain(key);
  });

  it("Groq-only configuration keeps the former failure behaviour (no fallback, no note)", async () => {
    const h = harness([{ status: 503, body: "over capacity" }], { keys: { groq: KEYS.groq, gemini: "unset", cerebras: "none", openrouter: "" } });
    const err = await h.run().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 503, message: "Groq API error (503): over capacity" });
    expect(toChatTurnErrorEvent(err)).toEqual({ type: "error", error: "Groq API error (503): over capacity" });
    expect(h.types()).toEqual([]);
  });

  it("fails with the former message when no provider has a key", async () => {
    const h = harness([], { keys: {} });
    await expect(h.run()).rejects.toThrow(NO_PROVIDER_CONFIGURED_MESSAGE);
  });

  it("an empty answer is an error for the caller, not a reason to switch", async () => {
    const h = harness([{ body: groqText() }, { body: geminiText("never used") }]);
    await h.run();
    expect(h.state.accumulatedText).toBe("");
    expect(h.calls).toHaveLength(1);
  });
});
