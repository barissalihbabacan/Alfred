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

export interface AIConfig {
  activeProvider: string;
  groq: GroqConfig;
}

export const DEFAULT_GROQ_CHAT_MODEL = "llama-3.3-70b-versatile";
export const DEFAULT_GROQ_STT_MODEL = "whisper-large-v3-turbo";
export const DEFAULT_AI_PROVIDER = "groq";

/**
 * Returns the centralized AI configuration parsed from environment variables.
 */
export function getAIConfig(): AIConfig {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const defaultModel = process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_CHAT_MODEL;
  const sttModel = process.env.GROQ_STT_MODEL?.trim() || DEFAULT_GROQ_STT_MODEL;
  const activeProvider = process.env.AI_PROVIDER?.trim().toLowerCase() || DEFAULT_AI_PROVIDER;

  const rawTemperature = process.env.GROQ_TEMPERATURE ? parseFloat(process.env.GROQ_TEMPERATURE) : 0.7;
  const temperature = Number.isFinite(rawTemperature) ? Math.max(0, Math.min(2, rawTemperature)) : 0.7;

  const rawMaxTokens = process.env.GROQ_MAX_TOKENS ? parseInt(process.env.GROQ_MAX_TOKENS, 10) : undefined;
  const maxTokens = rawMaxTokens && Number.isFinite(rawMaxTokens) && rawMaxTokens > 0 ? rawMaxTokens : undefined;

  const rawTimeout = process.env.GROQ_TIMEOUT_MS ? parseInt(process.env.GROQ_TIMEOUT_MS, 10) : 30000;
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 30000;

  return {
    activeProvider,
    groq: {
      apiKey: apiKey || undefined,
      defaultModel,
      sttModel,
      temperature,
      maxTokens,
      timeoutMs
    }
  };
}
