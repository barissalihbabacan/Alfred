import { describe, it, expect, vi, beforeEach } from "vitest";
import { GroqProvider } from "../../src/ai/providers/groq/groq-provider.js";
import {
  MissingApiKeyError,
  InvalidCredentialsError,
  RateLimitError,
  ModelNotFoundError,
  NetworkError
} from "../../src/core/errors/index.js";

describe("GroqProvider Unit Tests", () => {
  let mockGroqClient: any;

  beforeEach(() => {
    mockGroqClient = {
      chat: {
        completions: {
          create: vi.fn()
        }
      },
      audio: {
        transcriptions: {
          create: vi.fn()
        }
      }
    };
  });

  it("should report configured when an API key is provided", () => {
    const provider = new GroqProvider({ apiKey: "gsk_dummy_test_key" });
    expect(provider.isConfigured()).toBe(true);
    expect(provider.id).toBe("groq");
  });

  it("should throw MissingApiKeyError when invoking chat without an API key or client", async () => {
    const provider = new GroqProvider({ apiKey: "" });
    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow(
      MissingApiKeyError
    );
  });

  it("should execute chat completion and format response correctly", async () => {
    mockGroqClient.chat.completions.create.mockResolvedValueOnce({
      id: "chatcmpl-12345",
      model: "llama-3.3-70b-versatile",
      choices: [
        {
          message: {
            role: "assistant",
            content: "At your service, sir. The B.U.T.L.E.R. Alfred Groq integration is operational."
          },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 15,
        completion_tokens: 22,
        total_tokens: 37,
        prompt_time: 0.005,
        completion_time: 0.02,
        total_time: 0.025
      }
    });

    const provider = new GroqProvider({ client: mockGroqClient, apiKey: "test-key" });

    const response = await provider.chat(
      [{ role: "user", content: "Status report?" }],
      { temperature: 0.5, model: "llama-3.3-70b-versatile" }
    );

    expect(response.id).toBe("chatcmpl-12345");
    expect(response.content).toBe("At your service, sir. The B.U.T.L.E.R. Alfred Groq integration is operational.");
    expect(response.model).toBe("llama-3.3-70b-versatile");
    expect(response.usage?.totalTokens).toBe(37);
    expect(mockGroqClient.chat.completions.create).toHaveBeenCalledWith({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Status report?", name: undefined }],
      temperature: 0.5,
      max_tokens: undefined,
      top_p: undefined,
      stop: undefined
    });
  });

  it("should handle 401 authentication errors and map to InvalidCredentialsError", async () => {
    const error: any = new Error("Unauthorized");
    error.status = 401;
    mockGroqClient.chat.completions.create.mockRejectedValueOnce(error);

    const provider = new GroqProvider({ client: mockGroqClient, apiKey: "test-key" });

    await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      InvalidCredentialsError
    );
  });

  it("should handle 429 rate limit errors and map to RateLimitError", async () => {
    const error: any = new Error("Rate limit reached");
    error.status = 429;
    error.headers = { "retry-after": "5" };
    mockGroqClient.chat.completions.create.mockRejectedValueOnce(error);

    const provider = new GroqProvider({ client: mockGroqClient, apiKey: "test-key" });

    await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      RateLimitError
    );
  });

  it("should handle model not found errors and map to ModelNotFoundError", async () => {
    const error: any = new Error("The model `nonexistent-model` does not exist");
    error.status = 404;
    mockGroqClient.chat.completions.create.mockRejectedValueOnce(error);

    const provider = new GroqProvider({ client: mockGroqClient, apiKey: "test-key" });

    await expect(
      provider.chat([{ role: "user", content: "Hi" }], { model: "nonexistent-model" })
    ).rejects.toThrow(ModelNotFoundError);
  });

  it("should handle network errors and map to NetworkError", async () => {
    const error: any = new Error("fetch failed");
    error.code = "ECONNREFUSED";
    mockGroqClient.chat.completions.create.mockRejectedValueOnce(error);

    const provider = new GroqProvider({ client: mockGroqClient, apiKey: "test-key" });

    await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      NetworkError
    );
  });

  it("should execute audio transcription (STT) and format response correctly", async () => {
    mockGroqClient.audio.transcriptions.create.mockResolvedValueOnce({
      text: "Good morning, Master Wayne."
    });

    const provider = new GroqProvider({ client: mockGroqClient, apiKey: "test-key" });

    const result = await provider.transcribe({
      file: Buffer.from("fake-audio-bytes"),
      model: "whisper-large-v3-turbo",
      language: "en"
    });

    expect(result.text).toBe("Good morning, Master Wayne.");
    expect(mockGroqClient.audio.transcriptions.create).toHaveBeenCalledWith({
      file: expect.any(Buffer),
      model: "whisper-large-v3-turbo",
      language: "en",
      prompt: undefined,
      temperature: undefined
    });
  });
});
