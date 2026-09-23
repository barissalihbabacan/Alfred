import {
  AIProvider,
  AIChatStreamProvider,
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatStreamChunk,
  ToolCall
} from "../types.js";
import { getAIConfig, OllamaConfig } from "../../../core/config/index.js";
import { handleOllamaError } from "./ollama-error-handler.js";
import { AIProviderError } from "../../../core/errors/index.js";
import { errorMessage } from "../../../core/errors/index.js";

export interface OllamaProviderOptions {
  config?: Partial<OllamaConfig>;
  fetchFn?: typeof fetch;
}

export type OllamaHealthStatus =
  | { status: "ready"; reachable: true; modelAvailable: true; model: string }
  | {
      status: "model_unavailable";
      reachable: true;
      modelAvailable: false;
      model: string;
      availableModels: string[];
    }
  | {
      status: "unreachable";
      reachable: false;
      modelAvailable: false;
      error: string;
    };

/**
 * Ollama AI Provider implementation for B.U.T.L.E.R. Alfred.
 * Encapsulates local neural LLM inference via Ollama HTTP API (e.g. gemma4:12b-mlx).
 */
export class OllamaProvider implements AIProvider, AIChatStreamProvider {
  public readonly id = "ollama" as const;
  public readonly name = "Ollama Local";

  private config: OllamaConfig;
  private fetchFn: typeof fetch;

  constructor(options?: OllamaProviderOptions) {
    const baseConfig = getAIConfig().ollama;
    this.config = {
      ...baseConfig,
      ...options?.config
    };
    this.fetchFn = options?.fetchFn || globalThis.fetch;
  }

  /**
   * Returns true if Ollama baseUrl is configured.
   */
  public isConfigured(): boolean {
    return Boolean(this.config.baseUrl && this.config.baseUrl.trim().length > 0);
  }

  /**
   * Executes a conversational chat completion using Ollama native /api/chat endpoint.
   */
  public async chat(
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    const model = options?.model || this.config.defaultModel;
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/api/chat`;

    // Map internal ChatMessage array to Ollama's format
    const ollamaMessages = messages.map((m) => {
      const msg: any = {
        role: m.role as "system" | "user" | "assistant" | "tool",
        content: m.content
      };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments:
              typeof tc.function.arguments === "string"
                ? (() => {
                    try {
                      return JSON.parse(tc.function.arguments);
                    } catch {
                      return tc.function.arguments;
                    }
                  })()
                : tc.function.arguments
          }
        }));
      }
      return msg;
    });

    // Map completion parameters to Ollama's options
    const ollamaOptions: Record<string, unknown> = {};
    const temperature = options?.temperature ?? this.config.temperature;
    if (temperature !== undefined) {
      ollamaOptions.temperature = temperature;
    }

    const maxTokens = options?.maxTokens ?? this.config.maxTokens;
    if (maxTokens !== undefined) {
      ollamaOptions.num_predict = maxTokens;
    }

    if (options?.topP !== undefined) {
      ollamaOptions.top_p = options.topP;
    }

    if (options?.stop !== undefined) {
      ollamaOptions.stop = options.stop;
    }

    const requestBody: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: false,
      options: Object.keys(ollamaOptions).length > 0 ? ollamaOptions : undefined
    };

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
    }

    const timeoutMs = this.config.timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (options?.signal) {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeoutId);
      return handleOllamaError(error, model, timeoutMs);
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      let errorData: any;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: await response.text().catch(() => "") };
      }

      return handleOllamaError(
        {
          status: response.status,
          statusCode: response.status,
          message: errorData?.error || `HTTP error ${response.status}: ${response.statusText}`
        },
        model,
        timeoutMs
      );
    }

    let data: any;
    try {
      data = await response.json();
    } catch (jsonError) {
      throw new AIProviderError(
        "ollama",
        "Malformed response from Ollama: invalid JSON.",
        502,
        jsonError
      );
    }

    if (!data || typeof data !== "object" || !data.message) {
      throw new AIProviderError(
        "ollama",
        "Malformed response from Ollama: missing 'message' in response body.",
        502
      );
    }

    const content = typeof data.message.content === "string" ? data.message.content : "";
    const promptTokens = typeof data.prompt_eval_count === "number" ? data.prompt_eval_count : 0;
    const completionTokens = typeof data.eval_count === "number" ? data.eval_count : 0;
    const totalTokens = promptTokens + completionTokens;

    let toolCalls: ToolCall[] | undefined = undefined;
    if (Array.isArray(data.message.tool_calls) && data.message.tool_calls.length > 0) {
      toolCalls = data.message.tool_calls.map((tc: any, index: number) => ({
        id: tc.id || `call_ollama_${Date.now()}_${index}`,
        type: "function" as const,
        function: {
          name: tc.function?.name || "",
          arguments:
            typeof tc.function?.arguments === "object"
              ? JSON.stringify(tc.function.arguments)
              : String(tc.function?.arguments || "{}")
        }
      }));
    }

    return {
      id: `ollama-${Date.now()}`,
      content,
      model: data.model || model,
      role: "assistant",
      finishReason: data.done_reason || (data.done ? "stop" : undefined),
      usage: {
        promptTokens,
        completionTokens,
        totalTokens,
        promptTime: typeof data.prompt_eval_duration === "number" ? data.prompt_eval_duration / 1e9 : undefined,
        completionTime: typeof data.eval_duration === "number" ? data.eval_duration / 1e9 : undefined,
        totalTime: typeof data.total_duration === "number" ? data.total_duration / 1e9 : undefined
      },
      raw: data,
      toolCalls
    };
  }

  /**
   * Health and connectivity diagnostic check.
   * Distinguishes:
   * 1. Ollama server unreachable
   * 2. Ollama reachable but configured model unavailable
   * 3. Ollama reachable and configured model available
   */
  public async checkHealth(targetModel?: string): Promise<OllamaHealthStatus> {
    const modelToCheck = targetModel || this.config.defaultModel;
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/api/tags`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await this.fetchFn(url, {
        method: "GET",
        signal: controller.signal
      });

      if (!res.ok) {
        return {
          status: "unreachable",
          reachable: false,
          modelAvailable: false,
          error: `Ollama returned HTTP status ${res.status}`
        };
      }

      const data: any = await res.json();
      const models: any[] = Array.isArray(data?.models) ? data.models : [];
      const availableModelNames = models.map((m) => m.name || m.model).filter(Boolean);

      const isModelAvailable = availableModelNames.some(
        (name: string) =>
          name === modelToCheck ||
          name === `${modelToCheck}:latest` ||
          name.startsWith(`${modelToCheck}:`)
      );

      if (isModelAvailable) {
        return {
          status: "ready",
          reachable: true,
          modelAvailable: true,
          model: modelToCheck
        };
      }

      return {
        status: "model_unavailable",
        reachable: true,
        modelAvailable: false,
        model: modelToCheck,
        availableModels: availableModelNames
      };
    } catch (err: unknown) {
      return {
        status: "unreachable",
        reachable: false,
        modelAvailable: false,
        error: errorMessage(err, "Connection refused or timed out")
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Executes a streaming conversational chat completion using Ollama native streaming API.
   * Yields incremental tokens as they arrive from Ollama.
   * Thinking tokens and content tokens are cleanly separated.
   */
  public async *streamChat(
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): AsyncIterable<ChatStreamChunk> {
    const model = options?.model || this.config.defaultModel;
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/api/chat`;

    const ollamaMessages = messages.map((m) => {
      const msg: any = {
        role: m.role as "system" | "user" | "assistant" | "tool",
        content: m.content
      };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments:
              typeof tc.function.arguments === "string"
                ? (() => {
                    try {
                      return JSON.parse(tc.function.arguments);
                    } catch {
                      return tc.function.arguments;
                    }
                  })()
                : tc.function.arguments
          }
        }));
      }
      return msg;
    });

    const ollamaOptions: Record<string, unknown> = {};
    const temperature = options?.temperature ?? this.config.temperature;
    if (temperature !== undefined) {
      ollamaOptions.temperature = temperature;
    }

    const maxTokens = options?.maxTokens ?? this.config.maxTokens;
    if (maxTokens !== undefined) {
      ollamaOptions.num_predict = maxTokens;
    }

    if (options?.topP !== undefined) {
      ollamaOptions.top_p = options.topP;
    }

    if (options?.stop !== undefined) {
      ollamaOptions.stop = options.stop;
    }

    const requestBody: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: true,
      options: Object.keys(ollamaOptions).length > 0 ? ollamaOptions : undefined
    };

    if (options?.tools && options.tools.length > 0) {
      requestBody.tools = options.tools;
    }

    const timeoutMs = this.config.timeoutMs;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (options?.signal) {
      options.signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeoutId);
      return handleOllamaError(error, model, timeoutMs);
    }

    if (!response.ok) {
      clearTimeout(timeoutId);
      let errorData: any;
      try {
        errorData = await response.json();
      } catch {
        errorData = { error: await response.text().catch(() => "") };
      }

      return handleOllamaError(
        {
          status: response.status,
          statusCode: response.status,
          message: errorData?.error || `HTTP error ${response.status}: ${response.statusText}`
        },
        model,
        timeoutMs
      );
    }

    if (!response.body) {
      clearTimeout(timeoutId);
      throw new AIProviderError("ollama", "Ollama returned an empty response body.", 502);
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      // Support both web ReadableStream (with getReader) and Node / async iterables
      const body = response.body as any;
      if (typeof body.getReader === "function") {
        const reader = body.getReader();
        try {
          while (true) {
            if (controller.signal.aborted || options?.signal?.aborted) {
              break;
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              let parsed: any;
              try {
                parsed = JSON.parse(trimmed);
              } catch (jsonErr) {
                throw new AIProviderError(
                  "ollama",
                  `Malformed stream chunk from Ollama: ${trimmed}`,
                  502,
                  jsonErr
                );
              }

              if (parsed.error) {
                return handleOllamaError(
                  { status: 500, message: parsed.error },
                  model,
                  timeoutMs
                );
              }

              const thinking =
                typeof parsed.message?.thinking === "string" ? parsed.message.thinking : undefined;
              const content =
                typeof parsed.message?.content === "string" ? parsed.message.content : undefined;
              const isDone = Boolean(parsed.done);
              const finishReason = parsed.done_reason || undefined;

              const promptTokens =
                typeof parsed.prompt_eval_count === "number" ? parsed.prompt_eval_count : undefined;
              const completionTokens =
                typeof parsed.eval_count === "number" ? parsed.eval_count : undefined;
              const usage =
                promptTokens !== undefined && completionTokens !== undefined
                  ? {
                      promptTokens,
                      completionTokens,
                      totalTokens: promptTokens + completionTokens,
                      promptTime:
                        typeof parsed.prompt_eval_duration === "number"
                          ? parsed.prompt_eval_duration / 1e9
                          : undefined,
                      completionTime:
                        typeof parsed.eval_duration === "number"
                          ? parsed.eval_duration / 1e9
                          : undefined,
                      totalTime:
                        typeof parsed.total_duration === "number"
                          ? parsed.total_duration / 1e9
                          : undefined
                    }
                  : undefined;

              let toolCalls: ToolCall[] | undefined = undefined;
              if (Array.isArray(parsed.message?.tool_calls) && parsed.message.tool_calls.length > 0) {
                toolCalls = parsed.message.tool_calls.map((tc: any, index: number) => ({
                  id: tc.id || `call_ollama_${Date.now()}_${index}`,
                  type: "function" as const,
                  function: {
                    name: tc.function?.name || "",
                    arguments:
                      typeof tc.function?.arguments === "object"
                        ? JSON.stringify(tc.function.arguments)
                        : String(tc.function?.arguments || "{}")
                  }
                }));
              }

              yield {
                content,
                thinking,
                done: isDone,
                finishReason,
                model: parsed.model || model,
                usage,
                toolCalls
              };
            }
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {}
        }
      } else if (Symbol.asyncIterator in body) {
        for await (const chunk of body) {
          if (controller.signal.aborted || options?.signal?.aborted) {
            break;
          }

          const textChunk = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
          buffer += textChunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            let parsed: any;
            try {
              parsed = JSON.parse(trimmed);
            } catch (jsonErr) {
              throw new AIProviderError(
                "ollama",
                `Malformed stream chunk from Ollama: ${trimmed}`,
                502,
                jsonErr
              );
            }

            if (parsed.error) {
              return handleOllamaError(
                { status: 500, message: parsed.error },
                model,
                timeoutMs
              );
            }

            const thinking =
              typeof parsed.message?.thinking === "string" ? parsed.message.thinking : undefined;
            const content =
              typeof parsed.message?.content === "string" ? parsed.message.content : undefined;
            const isDone = Boolean(parsed.done);
            const finishReason = parsed.done_reason || undefined;

            const promptTokens =
              typeof parsed.prompt_eval_count === "number" ? parsed.prompt_eval_count : undefined;
            const completionTokens =
              typeof parsed.eval_count === "number" ? parsed.eval_count : undefined;
            const usage =
              promptTokens !== undefined && completionTokens !== undefined
                ? {
                    promptTokens,
                    completionTokens,
                    totalTokens: promptTokens + completionTokens
                  }
                : undefined;

            let toolCalls: ToolCall[] | undefined = undefined;
            if (Array.isArray(parsed.message?.tool_calls) && parsed.message.tool_calls.length > 0) {
              toolCalls = parsed.message.tool_calls.map((tc: any, index: number) => ({
                id: tc.id || `call_ollama_${Date.now()}_${index}`,
                type: "function" as const,
                function: {
                  name: tc.function?.name || "",
                  arguments:
                    typeof tc.function?.arguments === "object"
                      ? JSON.stringify(tc.function.arguments)
                      : String(tc.function?.arguments || "{}")
                }
              }));
            }

            yield {
              content,
              thinking,
              done: isDone,
              finishReason,
              model: parsed.model || model,
              usage,
              toolCalls
            };
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Returns supported model list.
   */
  public getSupportedModels(): { chat: string[] } {
    return {
      chat: [this.config.defaultModel]
    };
  }
}
