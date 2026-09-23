import { AlfredError } from "./base.js";

/**
 * Sanitizes an error message or string to ensure API keys or bearer tokens
 * are completely stripped from loggable strings.
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return "";
  return message
    .replace(/gsk_[a-zA-Z0-9_-]{20,}/g, "gsk_***REDACTED***")
    .replace(/Bearer\s+[a-zA-Z0-9_.-]{20,}/gi, "Bearer ***REDACTED***")
    .replace(/api[_-]?key[:=]\s*["']?[a-zA-Z0-9_-]{16,}["']?/gi, "api_key=***REDACTED***")
    .replace(/key[:=]\s*["']?[a-zA-Z0-9_-]{20,}["']?/gi, "key=***REDACTED***");
}

export class AIProviderError extends AlfredError {
  public override readonly code: string = "AI_PROVIDER_ERROR";

  constructor(
    public readonly provider: string,
    message: string,
    public readonly statusCode?: number,
    cause?: unknown
  ) {
    super(`[${provider}] ${sanitizeErrorMessage(message)}`, cause);
  }

  public override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      provider: this.provider,
      statusCode: this.statusCode
    };
  }
}

export class MissingApiKeyError extends AIProviderError {
  public override readonly code: string = "MISSING_API_KEY";

  constructor(provider: string, envVarName: string) {
    super(
      provider,
      `API key is missing. Please provide ${envVarName} in your environment variables.`,
      401
    );
  }
}

export class InvalidCredentialsError extends AIProviderError {
  public override readonly code: string = "INVALID_CREDENTIALS";

  constructor(provider: string, message = "Authentication failed. The provided API key is invalid or unauthorized.", cause?: unknown) {
    super(provider, message, 401, cause);
  }
}

export class RateLimitError extends AIProviderError {
  public override readonly code: string = "RATE_LIMIT_EXCEEDED";

  constructor(
    provider: string,
    message = "Rate limit exceeded for provider. Please back off and retry.",
    public readonly retryAfterSeconds?: number,
    cause?: unknown
  ) {
    super(provider, message, 429, cause);
  }

  public override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      retryAfterSeconds: this.retryAfterSeconds
    };
  }
}

export class ModelNotFoundError extends AIProviderError {
  public override readonly code: string = "MODEL_NOT_FOUND";

  constructor(provider: string, model: string, cause?: unknown) {
    super(
      provider,
      `Model '${model}' was not found or is no longer supported by provider '${provider}'.`,
      404,
      cause
    );
  }
}

export class NetworkError extends AIProviderError {
  public override readonly code: string = "NETWORK_ERROR";

  constructor(provider: string, message = "Network communication with AI provider failed.", cause?: unknown) {
    super(provider, message, 0, cause);
  }
}

export class ServiceUnavailableError extends AIProviderError {
  public override readonly code: string = "SERVICE_UNAVAILABLE";

  constructor(provider: string, message = "AI provider service is temporarily unavailable.", cause?: unknown) {
    super(provider, message, 503, cause);
  }
}

export class InvalidPromptError extends AIProviderError {
  public override readonly code: string = "INVALID_PROMPT";

  constructor(provider: string, message = "Prompt or request format was rejected by the provider.", cause?: unknown) {
    super(provider, message, 400, cause);
  }
}
