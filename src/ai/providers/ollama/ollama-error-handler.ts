import {
  AIProviderError,
  ModelNotFoundError,
  NetworkError,
  ServiceUnavailableError,
  InvalidPromptError
} from "../../../core/errors/index.js";

interface OllamaApiErrorLike {
  status?: number;
  statusCode?: number;
  message?: string;
  code?: string;
  error?: string | { message?: string };
  name?: string;
}

/**
 * Maps errors from Ollama API calls into strongly typed Alfred AI errors.
 * Sanitizes infrastructure details and prevents internal leakage.
 */
export function handleOllamaError(
  error: unknown,
  model?: string,
  timeoutMs?: number
): never {
  if (error instanceof AIProviderError) {
    throw error;
  }

  const err = (error || {}) as OllamaApiErrorLike;
  const status = err.status || err.statusCode;

  const rawMessage =
    typeof err.error === "string"
      ? err.error
      : err.error?.message || err.message || "An unknown Ollama API error occurred.";

  // Abort / Timeout error
  const isTimeout =
    err.name === "AbortError" ||
    err.name === "TimeoutError" ||
    err.code === "ETIMEDOUT" ||
    rawMessage.toLowerCase().includes("timed out") ||
    rawMessage.toLowerCase().includes("timeout");

  if (isTimeout) {
    throw new NetworkError(
      "ollama",
      `Ollama request timed out${timeoutMs ? ` after ${timeoutMs}ms` : ""}.`,
      error
    );
  }

  // Model not found (HTTP 404 or specific error text)
  if (
    status === 404 ||
    rawMessage.toLowerCase().includes("not found") ||
    rawMessage.toLowerCase().includes("model '")
  ) {
    throw new ModelNotFoundError("ollama", model || "specified model", error);
  }

  // Bad request / invalid parameters
  if (status === 400) {
    throw new InvalidPromptError("ollama", `Ollama rejected request: ${rawMessage}`, error);
  }

  // Service unavailable / server errors
  if (status && status >= 500 && status <= 599) {
    throw new ServiceUnavailableError(
      "ollama",
      `Ollama service error (${status}): ${rawMessage}`,
      error
    );
  }

  // Network connection failures (ECONNREFUSED, ENOTFOUND, fetch failed)
  const isNetwork =
    err.code === "ECONNREFUSED" ||
    err.code === "ENOTFOUND" ||
    rawMessage.toLowerCase().includes("fetch failed") ||
    rawMessage.toLowerCase().includes("connection refused") ||
    rawMessage.toLowerCase().includes("econnrefused") ||
    rawMessage.toLowerCase().includes("network");

  if (isNetwork) {
    throw new NetworkError("ollama", "Ollama connection failed: server unreachable.", error);
  }

  throw new AIProviderError("ollama", rawMessage, status, error);
}
