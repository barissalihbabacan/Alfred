export type ProviderId = "groq" | "ollama" | "openai" | "google" | "anthropic" | "local" | string;

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
}

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  signal?: AbortSignal;
}

export interface ChatCompletionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  promptTime?: number;
  completionTime?: number;
  totalTime?: number;
}

export interface ChatCompletionResponse {
  id: string;
  content: string;
  model: string;
  role: "assistant";
  usage?: ChatCompletionUsage;
  finishReason?: string;
  raw?: unknown;
}

export interface AudioTranscriptionOptions {
  /**
   * Audio input: File, Blob, Buffer, or ReadStream suitable for Whisper transcription
   */
  file: unknown;
  fileName?: string;
  model?: string;
  language?: string;
  prompt?: string;
  temperature?: number;
}

export interface AudioTranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
  raw?: unknown;
}

/**
 * Interface for AI providers supporting conversational text completion.
 */
export interface AIChatProvider {
  chat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<ChatCompletionResponse>;
}

/**
 * An incremental chunk emitted during a streaming conversational completion.
 */
export interface ChatStreamChunk {
  content?: string;
  thinking?: string;
  done?: boolean;
  finishReason?: string;
  model?: string;
  usage?: ChatCompletionUsage;
}

/**
 * Interface for AI providers supporting streaming conversational text completions.
 */
export interface AIChatStreamProvider {
  streamChat(
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): AsyncIterable<ChatStreamChunk>;
}

/**
 * Interface for AI providers supporting speech-to-text audio transcription (e.g. Whisper).
 */
export interface AISpeechToTextProvider {
  transcribe(options: AudioTranscriptionOptions): Promise<AudioTranscriptionResponse>;
}

/**
 * Unified AI Provider interface.
 * Implements chat capabilities and optionally streaming and speech-to-text capabilities.
 */
export interface AIProvider extends AIChatProvider, Partial<AIChatStreamProvider>, Partial<AISpeechToTextProvider> {
  readonly id: ProviderId;
  readonly name: string;

  /**
   * Returns true if required credentials/environment are present for this provider.
   */
  isConfigured(): boolean;

  /**
   * Returns lists of supported model IDs for this provider.
   */
  getSupportedModels(): {
    chat: string[];
    stt?: string[];
  };
}
