import Groq from "groq-sdk";
import {
  AIProvider,
  AIChatStreamProvider,
  AISpeechToTextProvider,
  ChatMessage,
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatStreamChunk,
  ToolCall,
  AudioTranscriptionOptions,
  AudioTranscriptionResponse
} from "../types.js";
import { MissingApiKeyError } from "../../../core/errors/index.js";
import { getAIConfig, GroqConfig } from "../../../core/config/index.js";
import { handleGroqError } from "./groq-error-handler.js";

export interface GroqProviderOptions {
  apiKey?: string;
  config?: Partial<GroqConfig>;
  client?: Groq;
}

/**
 * Groq AI Provider implementation for B.U.T.L.E.R. Alfred.
 * Encapsulates ultra-fast inference using Groq LPU hardware and models
 * (e.g., llama-3.3-70b-versatile, whisper-large-v3-turbo).
 */
export class GroqProvider implements AIProvider, AIChatStreamProvider, AISpeechToTextProvider {
  public readonly id = "groq" as const;
  public readonly name = "Groq Cloud";

  private client?: Groq;
  private config: GroqConfig;

  constructor(options?: GroqProviderOptions) {
    const baseConfig = getAIConfig().groq;
    this.config = {
      ...baseConfig,
      ...options?.config,
      apiKey: options?.apiKey || options?.config?.apiKey || baseConfig.apiKey
    };

    if (options?.client) {
      this.client = options.client;
    }
  }

  /**
   * Checks whether the Groq API key is present in configuration.
   */
  public isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.apiKey.length > 0);
  }

  /**
   * Lazily initializes or returns the Groq client.
   */
  private getClient(): Groq {
    if (this.client) {
      return this.client;
    }

    if (!this.isConfigured()) {
      throw new MissingApiKeyError("groq", "GROQ_API_KEY");
    }

    this.client = new Groq({
      apiKey: this.config.apiKey,
      timeout: this.config.timeoutMs
    });

    return this.client;
  }

  /**
   * Executes a conversational chat completion using Groq.
   */
  public async chat(
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    const client = this.getClient();
    const model = options?.model || this.config.defaultModel;

    try {
      const groqMessages = messages.map((m) => {
        const msg: any = {
          role: m.role as "system" | "user" | "assistant" | "tool",
          content: m.content,
          name: m.name
        };
        if (m.toolCalls && m.toolCalls.length > 0) {
          msg.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          }));
        }
        if (m.role === "tool" && m.toolCallId) {
          msg.tool_call_id = m.toolCallId;
        }
        return msg;
      });

      const completionParams: any = {
        model,
        messages: groqMessages,
        temperature: options?.temperature ?? this.config.temperature,
        max_tokens: options?.maxTokens ?? this.config.maxTokens,
        top_p: options?.topP,
        stop: options?.stop
      };

      if (options?.tools && options.tools.length > 0) {
        completionParams.tools = options.tools;
      }
      if (options?.toolChoice) {
        completionParams.tool_choice = options.toolChoice;
      }

      const completion = await client.chat.completions.create(completionParams);

      const choice = completion.choices[0];
      const content = choice?.message?.content || "";

      let toolCalls: ToolCall[] | undefined = undefined;
      if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
        toolCalls = choice.message.tool_calls.map((tc: any) => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments
          }
        }));
      }

      return {
        id: completion.id,
        content,
        model: completion.model,
        role: "assistant",
        finishReason: choice?.finish_reason || undefined,
        usage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
              promptTime: completion.usage.prompt_time,
              completionTime: completion.usage.completion_time,
              totalTime: completion.usage.total_time
            }
          : undefined,
        raw: completion,
        toolCalls
      };
    } catch (error) {
      return handleGroqError(error, model);
    }
  }

  /**
   * Executes a streaming conversational chat completion using Groq Cloud.
   * Yields incremental tokens as they arrive from Groq LPU.
   */
  public async *streamChat(
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): AsyncIterable<ChatStreamChunk> {
    const client = this.getClient();
    const model = options?.model || this.config.defaultModel;

    try {
      const groqMessages = messages.map((m) => {
        const msg: any = {
          role: m.role as "system" | "user" | "assistant" | "tool",
          content: m.content,
          name: m.name
        };
        if (m.toolCalls && m.toolCalls.length > 0) {
          msg.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments
            }
          }));
        }
        if (m.role === "tool" && m.toolCallId) {
          msg.tool_call_id = m.toolCallId;
        }
        return msg;
      });

      const streamParams: any = {
        model,
        messages: groqMessages,
        temperature: options?.temperature ?? this.config.temperature,
        max_tokens: options?.maxTokens ?? this.config.maxTokens,
        top_p: options?.topP,
        stop: options?.stop,
        stream: true
      };

      if (options?.tools && options.tools.length > 0) {
        streamParams.tools = options.tools;
      }
      if (options?.toolChoice) {
        streamParams.tool_choice = options.toolChoice;
      }

      const stream = (await client.chat.completions.create(streamParams)) as unknown as AsyncIterable<any>;

      const toolCallsAccumulator: Record<number, { id: string; name: string; arguments: string }> = {};

      for await (const chunk of stream) {
        if (options?.signal?.aborted) {
          break;
        }

        const choice = chunk.choices[0];
        const content = choice?.delta?.content || undefined;
        const finishReason = choice?.finish_reason || undefined;
        const isDone = Boolean(finishReason);

        if (choice?.delta?.tool_calls && choice.delta.tool_calls.length > 0) {
          for (const tc of choice.delta.tool_calls) {
            const idx = typeof tc.index === "number" ? tc.index : 0;
            if (!toolCallsAccumulator[idx]) {
              toolCallsAccumulator[idx] = {
                id: tc.id || `call_groq_${Date.now()}_${idx}`,
                name: tc.function?.name || "",
                arguments: ""
              };
            }
            if (tc.id) {
              toolCallsAccumulator[idx].id = tc.id;
            }
            if (tc.function?.name) {
              toolCallsAccumulator[idx].name += tc.function.name;
            }
            if (tc.function?.arguments) {
              toolCallsAccumulator[idx].arguments += tc.function.arguments;
            }
          }
        }

        let assembledToolCalls: ToolCall[] | undefined = undefined;
        if (isDone && Object.keys(toolCallsAccumulator).length > 0) {
          assembledToolCalls = Object.values(toolCallsAccumulator).map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: tc.arguments
            }
          }));
        }

        const chunkUsage = (chunk as any).usage || (chunk as any).x_groq?.usage;

        yield {
          content,
          done: isDone,
          finishReason,
          model: chunk.model || model,
          usage: chunkUsage
            ? {
                promptTokens: chunkUsage.prompt_tokens,
                completionTokens: chunkUsage.completion_tokens,
                totalTokens: chunkUsage.total_tokens,
                promptTime: chunkUsage.prompt_time,
                completionTime: chunkUsage.completion_time,
                totalTime: chunkUsage.total_time
              }
            : undefined,
          toolCalls: assembledToolCalls
        };
      }
    } catch (error) {
      return handleGroqError(error, model);
    }
  }

  /**
   * Transcribes audio into text using Groq Whisper models (STT capability).
   */
  public async transcribe(
    options: AudioTranscriptionOptions
  ): Promise<AudioTranscriptionResponse> {
    const client = this.getClient();
    const model = options.model || this.config.sttModel;

    try {
      const transcription = await client.audio.transcriptions.create({
        file: options.file as any,
        model,
        language: options.language,
        prompt: options.prompt,
        temperature: options.temperature
      });

      return {
        text: transcription.text,
        raw: transcription
      };
    } catch (error) {
      return handleGroqError(error, model);
    }
  }

  /**
   * Lists known supported Groq models based on official Groq docs.
   */
  public getSupportedModels(): { chat: string[]; stt: string[] } {
    return {
      chat: [
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3.8-27b",
        "qwen/qwen3.6-27b"
      ],
      stt: [
        "whisper-large-v3-turbo",
        "whisper-large-v3"
      ]
    };
  }
}
