import {
  AIProviderError,
  InvalidCredentialsError,
  RateLimitError,
  ModelNotFoundError,
  NetworkError,
  ServiceUnavailableError,
  InvalidPromptError
} from "../../../core/errors/index.js";

interface GroqApiErrorLike {
  status?: number;
  statusCode?: number;
  message?: string;
  code?: string;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
  headers?: Record<string, string>;
}

/**
 * Maps an error thrown by the Groq SDK / HTTP request into a strongly typed Alfred AI error.
 * Strips all sensitive information such as API keys and authorization headers.
 */
export function handleGroqError(error: unknown, model?: string): never {
  if (error instanceof AIProviderError) {
    throw error;
  }

  const err = (error || {}) as GroqApiErrorLike;
  const status = err.status || err.statusCode;
  const rawMessage = err.error?.message || err.message || "An unknown Groq API error occurred.";

  if (status === 401) {
    throw new InvalidCredentialsError("groq", `Groq authentication failed: ${rawMessage}`, error);
  }

  if (status === 429) {
    const retryAfter = err.headers?.["retry-after"] ? parseInt(err.headers["retry-after"], 10) : undefined;
    throw new RateLimitError("groq", `Groq rate limit exceeded: ${rawMessage}`, retryAfter, error);
  }

  if (status === 404 || (status === 400 && rawMessage.toLowerCase().includes("model"))) {
    throw new ModelNotFoundError("groq", model || "specified model", error);
  }

  if (status === 400) {
    throw new InvalidPromptError("groq", `Groq rejected request: ${rawMessage}`, error);
  }

  if (status === 500 || status === 502 || status === 503 || status === 504) {
    throw new ServiceUnavailableError("groq", `Groq service error (${status}): ${rawMessage}`, error);
  }

  // Check for network errors (ECONNREFUSED, ENOTFOUND, fetch failures, AbortError)
  const isNetwork =
    err.code === "ECONNREFUSED" ||
    err.code === "ENOTFOUND" ||
    err.code === "ETIMEDOUT" ||
    rawMessage.toLowerCase().includes("fetch failed") ||
    rawMessage.toLowerCase().includes("network");

  if (isNetwork) {
    throw new NetworkError("groq", `Groq network connection failed: ${rawMessage}`, error);
  }

  throw new AIProviderError("groq", rawMessage, status, error);
}
