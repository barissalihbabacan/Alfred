/**
 * Parser for OpenAI-compatible chat-completions SSE streams (Groq and Gemini's
 * OpenAI endpoint).
 *
 * Pure and dependency-free (bundled into functions/index.js). It takes the
 * decoded text of the response body and reports content deltas; at the end it
 * returns the assembled tool calls, the token usage and any error object the
 * provider sent inside the stream.
 *
 * Provider differences it absorbs:
 * - Tool-call deltas. Groq sends `index` on every
 *   fragment and `id` on the first. Gemini sends each call whole, with `id`
 *   but without `index` (several calls can arrive in one delta). Fragments are
 *   therefore keyed by `index` when present, else by `id`, else they continue
 *   the previous call.
 * - Gemini 3 attaches a thought signature to each call
 *   (`extra_content.google.thought_signature`) that must be sent back with the
 *   call on the next request, or Gemini answers 400. `extra_content` is kept
 *   and returned on the call; other providers never send it.
 * - Usage. Groq puts `usage` and `x_groq.usage` (same values) on the final
 *   chunk; Gemini (with stream_options.include_usage) sends one
 *   final usage chunk with empty or content-free choices. Only the last usage
 *   seen is kept, so nothing is counted twice.
 * - Reasoning. `delta.reasoning` (Groq gpt-oss) and
 *   `delta.reasoning_content` are ignored: reasoning is never shown or stored.
 * - Comments. Every line that does not start with `data:` (such as SSE `:`
 *   keep-alive comments) is skipped, as is `[DONE]`.
 * - In-stream errors. `{"error": {...}}` inside an HTTP 200 stream (e.g. Groq
 *   `tool_use_failed` or mid-stream errors with `finish_reason: "error"`) is
 *   recorded; the caller fails the call.
 */

export interface StreamedToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
  /** Provider-specific data to echo back (Gemini thought signatures). */
  extra_content?: unknown;
}

export interface StreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number } | null;
}

export interface StreamErrorObject {
  code?: unknown;
  type?: unknown;
  message?: unknown;
}

/** One thing that happened in the stream, in order. */
export type StreamDelta =
  | {
      type: "text";
      text: string;
      /** Tool calls seen so far in this call (text after a tool call is not shown to the user). */
      toolCallCount: number;
    }
  | { type: "tool_call" };

export interface StreamResult {
  /** All content text of this call. */
  text: string;
  toolCalls: StreamedToolCall[];
  usage: StreamUsage | null;
  error: StreamErrorObject | null;
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
  extra_content?: unknown;
}

interface ToolCallDelta {
  index?: unknown;
  id?: unknown;
  function?: { name?: unknown; arguments?: unknown } | null;
  extra_content?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface OpenAIStreamParserOptions {
  /** Used in generated ids for calls that arrive without one. */
  provider?: string;
  now?: () => number;
  /** Called for a data line that is not valid JSON (the line is skipped). */
  onParseError?: (error: unknown) => void;
}

export function createOpenAIStreamParser(options: OpenAIStreamParserOptions = {}) {
  const provider = options.provider || "llm";
  const now = options.now || Date.now;
  let buffer = "";
  let text = "";
  let usage: StreamUsage | null = null;
  let error: StreamErrorObject | null = null;
  const calls = new Map<string, PendingToolCall>();
  let lastKey: string | null = null;

  const keyFor = (tc: ToolCallDelta): string => {
    if (typeof tc.index === "number") return `index:${tc.index}`;
    if (typeof tc.id === "string" && tc.id) return `id:${tc.id}`;
    return lastKey ?? "index:0";
  };

  const addToolCall = (tc: ToolCallDelta) => {
    const key = keyFor(tc);
    let call = calls.get(key);
    if (!call) {
      call = { id: typeof tc.id === "string" && tc.id ? tc.id : `call_${provider}_${now()}_${calls.size}`, name: "", arguments: "" };
      calls.set(key, call);
    }
    lastKey = key;
    if (typeof tc.id === "string" && tc.id) call.id = tc.id;
    const fn = tc.function;
    if (fn && typeof fn.name === "string" && fn.name) call.name += fn.name;
    if (fn && typeof fn.arguments === "string" && fn.arguments) call.arguments += fn.arguments;
    // Some OpenAI-compatible servers send arguments as an object.
    else if (fn && isRecord(fn.arguments)) call.arguments += JSON.stringify(fn.arguments);
    if (tc.extra_content !== undefined && tc.extra_content !== null) call.extra_content = tc.extra_content;
  };

  const processLine = (line: string, out: StreamDelta[]) => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data:")) return;
    const dataStr = trimmed.replace(/^data:\s*/, "");
    if (dataStr === "[DONE]") return;

    let chunk: unknown;
    try {
      chunk = JSON.parse(dataStr);
    } catch (err) {
      options.onParseError?.(err);
      return;
    }
    if (!isRecord(chunk)) return;
    if (chunk.error) {
      error = isRecord(chunk.error) ? (chunk.error as StreamErrorObject) : { message: String(chunk.error) };
      return;
    }
    const xGroq = isRecord(chunk.x_groq) ? chunk.x_groq : null;
    const chunkUsage = chunk.usage || xGroq?.usage;
    if (isRecord(chunkUsage)) usage = chunkUsage as StreamUsage;

    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const choice = choices[0];
    if (!isRecord(choice) || !isRecord(choice.delta)) return;
    const delta = choice.delta;

    if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
      for (const tc of delta.tool_calls) if (isRecord(tc)) addToolCall(tc as ToolCallDelta);
      out.push({ type: "tool_call" });
    }
    if (typeof delta.content === "string" && delta.content) {
      text += delta.content;
      out.push({ type: "text", text: delta.content, toolCallCount: calls.size });
    }
  };

  return {
    /** Feeds decoded body text; returns the deltas of every complete line. */
    push(decoded: string): StreamDelta[] {
      buffer += decoded;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      const out: StreamDelta[] = [];
      for (const line of lines) processLine(line, out);
      return out;
    },
    /** Processes a last line that was not newline-terminated. */
    flush(): StreamDelta[] {
      const rest = buffer;
      buffer = "";
      const out: StreamDelta[] = [];
      if (rest.trim()) processLine(rest, out);
      return out;
    },
    toolCallCount(): number {
      return calls.size;
    },
    result(): StreamResult {
      return {
        text,
        toolCalls: [...calls.values()].map((c) => ({
          id: c.id,
          type: "function" as const,
          function: { name: c.name, arguments: c.arguments },
          ...(c.extra_content !== undefined ? { extra_content: c.extra_content } : {})
        })),
        usage,
        error
      };
    }
  };
}

/** Parses a whole stream body at once (tests, fixtures). */
export function parseOpenAIStream(body: string, options: OpenAIStreamParserOptions = {}): StreamResult & { deltas: StreamDelta[] } {
  const parser = createOpenAIStreamParser(options);
  const deltas = [...parser.push(body), ...parser.flush()];
  return { ...parser.result(), deltas };
}
