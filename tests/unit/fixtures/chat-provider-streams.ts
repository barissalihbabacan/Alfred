/**
 * SSE fixtures for the OpenAI-compatible chat providers, shaped after each
 * provider's documented streaming format (no live calls were made):
 *
 * - Groq: tool-call fragments with `index` (id on the first), usage on the
 *   final chunk as both `usage` and `x_groq.usage`, gpt-oss `delta.reasoning`.
 * - Gemini (OpenAI endpoint): each tool call whole, with `id` and no `index`,
 *   a thought signature in `extra_content.google.thought_signature`, usage in
 *   a final chunk with `choices: []` (stream_options.include_usage).
 * - Cerebras: `delta.reasoning`, usage on the final chunk.
 * - OpenRouter: `: OPENROUTER PROCESSING` comments, a final usage chunk with a
 *   content-free delta, mid-stream errors as a top-level `error` with
 *   `finish_reason: "error"`.
 */

export function sse(...chunks: unknown[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}

const choice = (delta: Record<string, unknown>, finish_reason: string | null = null) => ({
  choices: [{ index: 0, delta, finish_reason }]
});

export const GROQ_USAGE = { prompt_tokens: 2100, completion_tokens: 40, total_tokens: 2140, completion_tokens_details: { reasoning_tokens: 12 } };

export function groqText(...parts: string[]): string {
  return sse(
    choice({ role: "assistant", content: "" }),
    choice({ reasoning: "The user greets me." }),
    ...parts.map((p) => choice({ content: p })),
    { ...choice({}, "stop"), usage: GROQ_USAGE, x_groq: { id: "req_1", usage: GROQ_USAGE } }
  );
}

/** Groq: one get_current_time call split over three fragments. */
export function groqToolCall(cities: string[] = ["İstanbul", "New York"]): string {
  const args = JSON.stringify({ cities });
  return sse(
    choice({ role: "assistant", content: null }),
    choice({ tool_calls: [{ index: 0, id: "call_groq_1", type: "function", function: { name: "get_current_time", arguments: "" } }] }),
    choice({ tool_calls: [{ index: 0, function: { arguments: args.slice(0, 10) } }] }),
    choice({ tool_calls: [{ index: 0, function: { arguments: args.slice(10) } }] }),
    { ...choice({}, "tool_calls"), usage: GROQ_USAGE, x_groq: { id: "req_2", usage: GROQ_USAGE } }
  );
}

export function groqStreamError(): string {
  return sse(
    choice({ role: "assistant", content: null }),
    { error: { message: "Tool call validation failed", type: "invalid_request_error", code: "tool_use_failed" } }
  );
}

/** Groq: some text reaches the user, then an error arrives in the stream. */
export function groqPartialThenError(): string {
  return sse(
    choice({ content: "Efendim, " }),
    { error: { message: "Service unavailable", type: "server_error", code: "internal" } }
  );
}

export const GEMINI_SIGNATURE = "CiQBcsjafQ8b...signature";

/** Gemini: two whole tool calls in one delta, ids but no index, thought signature on the first. */
export function geminiToolCalls(): string {
  return sse(
    choice({
      role: "assistant",
      tool_calls: [
        {
          id: "function-call-111",
          type: "function",
          function: { name: "get_current_time", arguments: JSON.stringify({ cities: ["Tokyo"] }) },
          extra_content: { google: { thought_signature: GEMINI_SIGNATURE } }
        },
        {
          id: "function-call-222",
          type: "function",
          function: { name: "get_current_time", arguments: JSON.stringify({ cities: ["Londra"] }) }
        }
      ]
    }, "tool_calls"),
    { choices: [], usage: { prompt_tokens: 1900, completion_tokens: 30, total_tokens: 1930 } }
  );
}

export function geminiText(...parts: string[]): string {
  return sse(
    ...parts.map((p, i) => choice(i === 0 ? { role: "assistant", content: p } : { content: p })),
    choice({}, "stop"),
    { choices: [], usage: { prompt_tokens: 1950, completion_tokens: 25, total_tokens: 1975, completion_tokens_details: { reasoning_tokens: 8 } } }
  );
}

export function cerebrasText(...parts: string[]): string {
  return sse(
    choice({ role: "assistant", content: "" }),
    choice({ reasoning: "Short greeting; answer briefly." }),
    ...parts.map((p) => choice({ content: p })),
    { ...choice({}, "stop"), usage: { prompt_tokens: 2000, completion_tokens: 20, total_tokens: 2020 } }
  );
}

export function cerebrasToolCall(): string {
  return sse(
    choice({ tool_calls: [{ index: 0, id: "call_cb_1", type: "function", function: { name: "get_current_time", arguments: "{\"cities\":[\"Paris\"]}" } }] }),
    { ...choice({}, "tool_calls"), usage: { prompt_tokens: 2000, completion_tokens: 15, total_tokens: 2015 } }
  );
}

export function openRouterText(...parts: string[]): string {
  const body = sse(
    ...parts.map((p) => ({ id: "gen-1", provider: "Cerebras", model: "openai/gpt-oss-120b", ...choice({ content: p }) })),
    { id: "gen-1", ...choice({ content: "" }, "stop"), usage: { prompt_tokens: 2010, completion_tokens: 22, total_tokens: 2032 } }
  );
  return `: OPENROUTER PROCESSING\n\n${body}`;
}

export function openRouterMidStreamError(): string {
  return `: OPENROUTER PROCESSING\n\n` + sse({
    id: "cmpl-abc123",
    object: "chat.completion.chunk",
    provider: "openai",
    error: { code: "server_error", message: "Provider disconnected unexpectedly" },
    choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }]
  });
}

export const GROQ_TPM_429 = {
  error: {
    message:
      "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7421, Requested 1480. Please try again in 2.4s.",
    type: "tokens",
    code: "rate_limit_exceeded"
  }
};

export const GROQ_TPD_429 = {
  error: {
    message:
      "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 197637, Requested 2824. Please try again in 3m19.152s.",
    type: "tokens",
    code: "rate_limit_exceeded"
  }
};
