/**
 * Wire types for the parts of the Ollama HTTP API Alfred uses
 * (`POST /api/chat`, `GET /api/tags`). Response fields are all optional:
 * bodies come from the network and are checked field by field at use sites.
 */
import type { ChatRole } from "../types.js";

/** Tool call as sent to Ollama: `arguments` is a parsed JSON object when possible. */
export interface OllamaRequestToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: unknown;
  };
}

/** A message in the `/api/chat` request body. */
export interface OllamaRequestMessage {
  role: ChatRole;
  content: string;
  tool_calls?: OllamaRequestToolCall[];
}

/** Tool call as returned by Ollama (`arguments` is usually an object). */
export interface OllamaResponseToolCall {
  id?: string;
  function?: {
    name?: string;
    arguments?: unknown;
  };
}

/** `message` of an `/api/chat` response or stream chunk. */
export interface OllamaResponseMessage {
  role?: string;
  content?: unknown;
  thinking?: unknown;
  tool_calls?: OllamaResponseToolCall[];
}

/** An `/api/chat` response (non-streaming) or one NDJSON stream chunk. */
export interface OllamaChatResponse {
  model?: string;
  message?: OllamaResponseMessage;
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: unknown;
  eval_count?: unknown;
  prompt_eval_duration?: unknown;
  eval_duration?: unknown;
  total_duration?: unknown;
  error?: string;
}

/** Error body returned by Ollama on non-2xx responses. */
export interface OllamaErrorBody {
  error?: string;
}

/** One entry of `GET /api/tags` → `models`. */
export interface OllamaTagModel {
  name?: string;
  model?: string;
}

/** `GET /api/tags` response. */
export interface OllamaTagsResponse {
  models?: unknown;
}
