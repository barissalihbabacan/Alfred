import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolCall } from "../../src/ai/providers/types.js";
import type Groq from "groq-sdk";
import { GroqProvider } from "../../src/ai/providers/groq/groq-provider.js";
import {
  MissingApiKeyError,
  InvalidCredentialsError,
  RateLimitError,
  ModelNotFoundError,
  NetworkError
} from "../../src/core/errors/index.js";

function createMockGroqClient() {
  return {
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
}

type MockGroqClient = ReturnType<typeof createMockGroqClient>;

/** The mock only implements the two endpoints GroqProvider calls. */
function asGroq(mock: MockGroqClient): Groq {
  return mock as unknown as Groq;
}

describe("GroqProvider Unit Tests", () => {
  let mockGroqClient: MockGroqClient;

  beforeEach(() => {
    mockGroqClient = createMockGroqClient();
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

    const provider = new GroqProvider({ client: asGroq(mockGroqClient), apiKey: "test-key" });

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
    const error = Object.assign(new Error("Unauthorized"), { status: 401 });
    mockGroqClient.chat.completions.create.mockRejectedValueOnce(error);

    const provider = new GroqProvider({ client: asGroq(mockGroqClient), apiKey: "test-key" });

    await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      InvalidCredentialsError
    );
  });

  it("should handle 429 rate limit errors and map to RateLimitError", async () => {
    const error = Object.assign(new Error("Rate limit reached"), {
      status: 429,
      headers: { "retry-after": "5" }
    });
    mockGroqClient.chat.completions.create.mockRejectedValueOnce(error);

    const provider = new GroqProvider({ client: asGroq(mockGroqClient), apiKey: "test-key" });

    await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      RateLimitError
    );
  });

  it("should handle model not found errors and map to ModelNotFoundError", async () => {
    const error = Object.assign(new Error("The model `nonexistent-model` does not exist"), {
      status: 404
    });
    mockGroqClient.chat.completions.create.mockRejectedValueOnce(error);

    const provider = new GroqProvider({ client: asGroq(mockGroqClient), apiKey: "test-key" });

    await expect(
      provider.chat([{ role: "user", content: "Hi" }], { model: "nonexistent-model" })
    ).rejects.toThrow(ModelNotFoundError);
  });

  it("should handle network errors and map to NetworkError", async () => {
    const error = Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" });
    mockGroqClient.chat.completions.create.mockRejectedValueOnce(error);

    const provider = new GroqProvider({ client: asGroq(mockGroqClient), apiKey: "test-key" });

    await expect(provider.chat([{ role: "user", content: "Hi" }])).rejects.toThrow(
      NetworkError
    );
  });

  it("should execute audio transcription (STT) and format response correctly", async () => {
    mockGroqClient.audio.transcriptions.create.mockResolvedValueOnce({
      text: "Good morning, Master Wayne."
    });

    const provider = new GroqProvider({ client: asGroq(mockGroqClient), apiKey: "test-key" });

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

  it("should parse and return structured toolCalls when Groq returns tool_calls in chat", async () => {
    mockGroqClient.chat.completions.create.mockResolvedValueOnce({
      id: "chatcmpl-tool-1",
      model: "llama-3.3-70b-versatile",
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc123",
                type: "function",
                function: {
                  name: "ssh_execute",
                  arguments: JSON.stringify({ host: "home-server", command: "disk_usage" })
                }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ]
    });

    const provider = new GroqProvider({ client: asGroq(mockGroqClient), apiKey: "test-key" });
    const response = await provider.chat(
      [{ role: "user", content: "Check disk usage" }],
      {
        tools: [
          {
            type: "function",
            function: {
              name: "ssh_execute",
              description: "Executes command",
              parameters: {}
            }
          }
        ]
      }
    );

    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].id).toBe("call_abc123");
    expect(response.toolCalls![0].function.name).toBe("ssh_execute");
    expect(JSON.parse(response.toolCalls![0].function.arguments)).toEqual({
      host: "home-server",
      command: "disk_usage"
    });
  });

  it("should stream tokens incrementally and yield done event in streamChat", async () => {
    async function* mockStream() {
      yield {
        choices: [{ delta: { content: "Good " } }]
      };
      yield {
        choices: [{ delta: { content: "evening, " } }]
      };
      yield {
        choices: [{ delta: { content: "sir." }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 }
      };
    }

    mockGroqClient.chat.completions.create.mockResolvedValueOnce(mockStream());

    const provider = new GroqProvider({ client: asGroq(mockGroqClient), apiKey: "test-key" });
    const chunks: string[] = [];
    let isDone = false;

    for await (const chunk of provider.streamChat([{ role: "user", content: "Hello" }])) {
      if (chunk.content) {
        chunks.push(chunk.content);
      }
      if (chunk.done) {
        isDone = true;
      }
    }

    expect(chunks.join("")).toBe("Good evening, sir.");
    expect(isDone).toBe(true);
  });

  it("should accumulate streaming tool calls across chunks and yield on completion", async () => {
    async function* mockToolStream() {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_stream_1",
                  type: "function",
                  function: { name: "ssh_list_directory", arguments: "{\"path\":\"" }
                }
              ]
            }
          }
        ]
      };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: { arguments: "Belgeler\"}" }
                }
              ]
            }
          }
        ]
      };
      yield {
        choices: [
          {
            delta: {},
            finish_reason: "tool_calls"
          }
        ]
      };
    }

    mockGroqClient.chat.completions.create.mockResolvedValueOnce(mockToolStream());

    const provider = new GroqProvider({ client: asGroq(mockGroqClient), apiKey: "test-key" });
    let finalToolCalls: ToolCall[] | undefined = undefined;

    for await (const chunk of provider.streamChat([{ role: "user", content: "List Belgeler" }])) {
      if (chunk.toolCalls) {
        finalToolCalls = chunk.toolCalls;
      }
    }

    expect(finalToolCalls).toBeDefined();
    expect(finalToolCalls).toHaveLength(1);
    expect(finalToolCalls![0].id).toBe("call_stream_1");
    expect(finalToolCalls![0].function.name).toBe("ssh_list_directory");
    expect(finalToolCalls![0].function.arguments).toBe('{"path":"Belgeler"}');
  });
});
