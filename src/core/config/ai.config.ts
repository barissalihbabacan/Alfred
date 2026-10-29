import dotenv from "dotenv";

// Load environment variables from .env / .env.local if present
dotenv.config();

export interface GroqConfig {
  apiKey?: string;
  defaultModel: string;
  sttModel: string;
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
}

export interface OllamaConfig {
  baseUrl: string;
  defaultModel: string;
  temperature: number;
  maxTokens?: number;
  timeoutMs: number;
}

export interface AIConfig {
  activeProvider: string;
  groq: GroqConfig;
  ollama: OllamaConfig;
}

export const DEFAULT_GROQ_CHAT_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_GROQ_STT_MODEL = "whisper-large-v3-turbo";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "gemma4:12b-mlx";
export const DEFAULT_AI_PROVIDER = "groq";

/**
 * Returns the centralized AI configuration parsed from environment variables.
 */
export function getAIConfig(): AIConfig {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const defaultModel = process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_CHAT_MODEL;
  const sttModel = process.env.GROQ_STT_MODEL?.trim() || DEFAULT_GROQ_STT_MODEL;
  const activeProvider = (
    process.env.ALFRED_LLM_PROVIDER ||
    process.env.AI_PROVIDER ||
    DEFAULT_AI_PROVIDER
  ).trim().toLowerCase();

  const rawTemperature = process.env.GROQ_TEMPERATURE ? parseFloat(process.env.GROQ_TEMPERATURE) : 0.7;
  const temperature = Number.isFinite(rawTemperature) ? Math.max(0, Math.min(2, rawTemperature)) : 0.7;

  const rawMaxTokens = process.env.GROQ_MAX_TOKENS ? parseInt(process.env.GROQ_MAX_TOKENS, 10) : undefined;
  const maxTokens = rawMaxTokens && Number.isFinite(rawMaxTokens) && rawMaxTokens > 0 ? rawMaxTokens : undefined;

  const rawTimeout = process.env.GROQ_TIMEOUT_MS ? parseInt(process.env.GROQ_TIMEOUT_MS, 10) : 30000;
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000;

  // Ollama configuration
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = process.env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL;

  const rawOllamaTemp = process.env.OLLAMA_TEMPERATURE ? parseFloat(process.env.OLLAMA_TEMPERATURE) : 0.7;
  const ollamaTemperature = Number.isFinite(rawOllamaTemp) ? Math.max(0, Math.min(2, rawOllamaTemp)) : 0.7;

  const rawOllamaMaxTokens = process.env.OLLAMA_MAX_TOKENS ? parseInt(process.env.OLLAMA_MAX_TOKENS, 10) : undefined;
  const ollamaMaxTokens = rawOllamaMaxTokens && Number.isFinite(rawOllamaMaxTokens) && rawOllamaMaxTokens > 0 ? rawOllamaMaxTokens : undefined;

  const rawOllamaTimeout = process.env.OLLAMA_TIMEOUT_MS ? parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) : 120000;
  const ollamaTimeoutMs = Number.isFinite(rawOllamaTimeout) && rawOllamaTimeout > 0 ? rawOllamaTimeout : 120000;

  return {
    activeProvider,
    groq: {
      apiKey: apiKey || undefined,
      defaultModel,
      sttModel,
      temperature,
      maxTokens,
      timeoutMs
    },
    ollama: {
      baseUrl: ollamaBaseUrl,
      defaultModel: ollamaModel,
      temperature: ollamaTemperature,
      maxTokens: ollamaMaxTokens,
      timeoutMs: ollamaTimeoutMs
    }
  };
}
