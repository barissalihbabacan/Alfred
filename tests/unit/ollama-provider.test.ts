import { describe, it, expect, vi, beforeEach } from "vitest";
import { OllamaProvider } from "../../src/ai/providers/ollama/ollama-provider.js";
import {
  ModelNotFoundError,
  NetworkError,
  AIProviderError
} from "../../src/core/errors/index.js";
import { getAlfredSystemPrompt } from "../../src/ai/prompts/alfred-persona.js";

type MockFetch = ReturnType<typeof vi.fn>;

/** Tests feed the mock partial Response objects, so it is not a real fetch. */
function asFetch(mock: MockFetch): typeof fetch {
  return mock as unknown as typeof fetch;
}

describe("OllamaProvider Unit Tests", () => {
  let mockFetch: MockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  it("1. successfully parses a mocked successful Ollama response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: "gemma4:12b-mlx",
        created_at: "2026-09-04T08:00:00Z",
        message: {
          role: "assistant",
          content: "Good morning, sir. B.U.T.L.E.R. Alfred at your service.",
          thinking: "User greeted me. Replying courteously."
        },
        done: true,
        done_reason: "stop",
        prompt_eval_count: 24,
        prompt_eval_duration: 1200000000,
        eval_count: 14,
        eval_duration: 800000000,
        total_duration: 2000000000
      })
    });

    const provider = new OllamaProvider({
      fetchFn: asFetch(mockFetch),
      config: {
        baseUrl: "http://mock-ollama:11434",
        defaultModel: "gemma4:12b-mlx"
      }
    });

    const response = await provider.chat([{ role: "user", content: "Good morning, Alfred." }]);

    expect(response.content).toBe("Good morning, sir. B.U.T.L.E.R. Alfred at your service.");
    expect(response.model).toBe("gemma4:12b-mlx");
    expect(response.role).toBe("assistant");
    expect(response.finishReason).toBe("stop");
    expect(response.usage?.promptTokens).toBe(24);
    expect(response.usage?.completionTokens).toBe(14);
    expect(response.usage?.totalTokens).toBe(38);
    expect(response.usage?.promptTime).toBe(1.2);
    expect(response.usage?.completionTime).toBe(0.8);
    expect(response.usage?.totalTime).toBe(2.0);
  });

  it("2. sends correct system, user, and assistant messages to Ollama", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: "gemma4:12b-mlx",
        message: { role: "assistant", content: "Understood, sir." },
        done: true
      })
    });

    const provider = new OllamaProvider({ fetchFn: asFetch(mockFetch) });

    await provider.chat([
      { role: "system", content: "You are Alfred." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Good day, sir." },
      { role: "user", content: "How are things?" }
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, requestOptions] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/chat");
    const parsedBody = JSON.parse(requestOptions.body);

    expect(parsedBody.messages).toEqual([
      { role: "system", content: "You are Alfred." },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Good day, sir." },
      { role: "user", content: "How are things?" }
    ]);
  });

  it("3. passes temperature parameter correctly to Ollama options", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: "gemma4:12b-mlx",
        message: { role: "assistant", content: "Response" },
        done: true
      })
    });

    const provider = new OllamaProvider({ fetchFn: asFetch(mockFetch) });
    await provider.chat([{ role: "user", content: "Test" }], { temperature: 0.42 });

    const parsedBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(parsedBody.options.temperature).toBe(0.42);
  });

  it("4. handles maximum output token configuration correctly via num_predict", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: "gemma4:12b-mlx",
        message: { role: "assistant", content: "Response" },
        done: true
      })
    });

    const provider = new OllamaProvider({ fetchFn: asFetch(mockFetch) });
    await provider.chat([{ role: "user", content: "Test" }], { maxTokens: 250 });

    const parsedBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(parsedBody.options.num_predict).toBe(250);
  });

  it("5. handles connection failure correctly and maps to NetworkError", async () => {
    const connErr = Object.assign(new Error("connect ECONNREFUSED 100.64.0.53:11434"), {
      code: "ECONNREFUSED"
    });
    mockFetch.mockRejectedValueOnce(connErr);

    const provider = new OllamaProvider({ fetchFn: asFetch(mockFetch) });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow(
      NetworkError
    );
  });

  it("6. handles request timeout correctly and maps to NetworkError", async () => {
    const timeoutErr = new Error("The operation was aborted due to timeout");
    timeoutErr.name = "AbortError";
    mockFetch.mockRejectedValueOnce(timeoutErr);

    const provider = new OllamaProvider({ fetchFn: asFetch(mockFetch), config: { timeoutMs: 500 } });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow(
      NetworkError
    );
  });

  it("7. handles model-not-found HTTP 404 correctly and maps to ModelNotFoundError", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: "model 'non-existent' not found" })
    });

    const provider = new OllamaProvider({ fetchFn: asFetch(mockFetch) });

    await expect(
      provider.chat([{ role: "user", content: "Hello" }], { model: "non-existent" })
    ).rejects.toThrow(ModelNotFoundError);
  });

  it("8. handles malformed Ollama responses correctly and maps to AIProviderError", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("Unexpected token < in JSON at position 0");
      }
    });

    const provider = new OllamaProvider({ fetchFn: asFetch(mockFetch) });

    await expect(provider.chat([{ role: "user", content: "Hello" }])).rejects.toThrow(
      AIProviderError
    );
  });

  it("11. passes the canonical Alfred persona/system prompt through correctly", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        model: "gemma4:12b-mlx",
        message: { role: "assistant", content: "Indeed, sir." },
        done: true
      })
    });

    const canonicalPrompt = getAlfredSystemPrompt();
    const provider = new OllamaProvider({ fetchFn: asFetch(mockFetch) });

    await provider.chat([
      { role: "system", content: canonicalPrompt },
      { role: "user", content: "Status report, Alfred." }
    ]);

    const parsedBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(parsedBody.messages[0].role).toBe("system");
    expect(parsedBody.messages[0].content).toBe(canonicalPrompt);
    expect(parsedBody.messages[0].content).toContain("You are Alfred, Barış's personal AI assistant");
  });

  describe("Health & Diagnostics", () => {
    it("reports 'ready' when Ollama is reachable and configured model is present", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          models: [{ name: "gemma4:12b-mlx" }]
        })
      });

      const provider = new OllamaProvider({
        fetchFn: asFetch(mockFetch),
        config: { defaultModel: "gemma4:12b-mlx" }
      });

      const diag = await provider.checkHealth();
      expect(diag.status).toBe("ready");
      expect(diag.reachable).toBe(true);
      expect(diag.modelAvailable).toBe(true);
    });

    it("reports 'model_unavailable' when Ollama is reachable but model is missing", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          models: [{ name: "llama3:latest" }]
        })
      });

      const provider = new OllamaProvider({
        fetchFn: asFetch(mockFetch),
        config: { defaultModel: "gemma4:12b-mlx" }
      });

      const diag = await provider.checkHealth();
      expect(diag.status).toBe("model_unavailable");
      expect(diag.reachable).toBe(true);
      expect(diag.modelAvailable).toBe(false);
    });

    it("reports 'unreachable' when server connection fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const provider = new OllamaProvider({ fetchFn: asFetch(mockFetch) });
      const diag = await provider.checkHealth();
      expect(diag.status).toBe("unreachable");
      expect(diag.reachable).toBe(false);
      expect(diag.modelAvailable).toBe(false);
    });
  });

  describe("Streaming & Thinking Isolation (Gemma 4)", () => {
    function createMockStream(lines: string[]) {
      const encoder = new TextEncoder();
      return new ReadableStream({
        start(controller) {
          for (const line of lines) {
            controller.enqueue(encoder.encode(line + "\n"));
          }
          controller.close();
        }
      });
    }

    it("1. successfully streams incremental chunks and separates thinking from content", async () => {
      const streamLines = [
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: "", thinking: "Analyzing user request..." },
          done: false
        }),
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: "", thinking: " Formulating refined British response." },
          done: false
        }),
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: "Good " },
          done: false
        }),
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: "day, " },
          done: false
        }),
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: "sir." },
          done: true,
          done_reason: "stop",
          prompt_eval_count: 15,
          eval_count: 5
        })
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: createMockStream(streamLines)
      });

      const provider = new OllamaProvider({
        fetchFn: asFetch(mockFetch),
        config: { defaultModel: "gemma4:12b-mlx" }
      });

      const chunks = [];
      for await (const chunk of provider.streamChat([
        { role: "user", content: "Good day." }
      ])) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(5);

      // Verify thinking chunks
      expect(chunks[0].thinking).toBe("Analyzing user request...");
      expect(chunks[0].content).toBe("");
      expect(chunks[1].thinking).toBe(" Formulating refined British response.");
      expect(chunks[1].content).toBe("");

      // Verify content chunks
      expect(chunks[2].content).toBe("Good ");
      expect(chunks[2].thinking).toBeUndefined();
      expect(chunks[3].content).toBe("day, ");
      expect(chunks[4].content).toBe("sir.");
      expect(chunks[4].done).toBe(true);
      expect(chunks[4].finishReason).toBe("stop");
      expect(chunks[4].usage?.promptTokens).toBe(15);
      expect(chunks[4].usage?.completionTokens).toBe(5);
    });

    it("2. REGRESSION TEST: internal thinking tokens are NEVER exposed or rendered as user content", async () => {
      const privateInternalThoughts = [
        "Thinking step 1: Assess user authorization level.",
        "Thinking step 2: Ensure discreet butler tone.",
        "Thinking step 3: Internal cognitive chain of thought."
      ];

      const visibleContentChunks = [
        "Good morning, ",
        "sir. How may I be of ",
        "assistance to you?"
      ];

      const streamLines = [
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: "", thinking: privateInternalThoughts[0] },
          done: false
        }),
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: "", thinking: privateInternalThoughts[1] },
          done: false
        }),
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: "", thinking: privateInternalThoughts[2] },
          done: false
        }),
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: visibleContentChunks[0] },
          done: false
        }),
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: visibleContentChunks[1] },
          done: false
        }),
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: visibleContentChunks[2] },
          done: true,
          done_reason: "stop"
        })
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: createMockStream(streamLines)
      });

      const provider = new OllamaProvider({ fetchFn: asFetch(mockFetch) });

      let userRenderedText = "";
      const thinkingLog: string[] = [];

      for await (const chunk of provider.streamChat([
        { role: "user", content: "Status report." }
      ])) {
        // Collect thinking separately
        if (chunk.thinking) {
          thinkingLog.push(chunk.thinking);
        }

        // Collect what is visible/rendered to the user
        if (chunk.content) {
          userRenderedText += chunk.content;
        }
      }

      // 1. Verify that thinking tokens were indeed processed by the stream generator
      expect(thinkingLog.length).toBe(3);
      expect(thinkingLog).toEqual(privateInternalThoughts);

      // 2. CRITICAL ASSERTION: The final user-rendered text contains ONLY the visible content
      expect(userRenderedText).toBe("Good morning, sir. How may I be of assistance to you?");

      // 3. STRICT ISOLATION ASSERTION: None of the internal thinking strings exist in user text
      for (const thought of privateInternalThoughts) {
        expect(userRenderedText).not.toContain(thought);
      }
      expect(userRenderedText).not.toContain("Thinking");
      expect(userRenderedText).not.toContain("cognitive");
      expect(userRenderedText).not.toContain("<thought>");
      expect(userRenderedText).not.toContain("<think>");
    });

    it("3. handles malformed stream chunk JSON by throwing AIProviderError", async () => {
      const malformedLines = [
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: "Valid token" },
          done: false
        }),
        "NOT_A_VALID_JSON_STRING_<<<ERROR>>>"
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: createMockStream(malformedLines)
      });

      const provider = new OllamaProvider({ fetchFn: asFetch(mockFetch) });
      const stream = provider.streamChat([{ role: "user", content: "Hi" }]);

      await expect(async () => {
        for await (const _chunk of stream) {
          // Iterate until malformed chunk
        }
      }).rejects.toThrow(AIProviderError);
    });

    it("4. handles cancellation via AbortSignal", async () => {
      const controller = new AbortController();

      const streamLines = [
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: "Token 1" },
          done: false
        }),
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: "Token 2" },
          done: false
        }),
        JSON.stringify({
          model: "gemma4:12b-mlx",
          message: { role: "assistant", content: "Token 3" },
          done: false
        })
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        body: createMockStream(streamLines)
      });

      const provider = new OllamaProvider({ fetchFn: asFetch(mockFetch) });
      const stream = provider.streamChat([{ role: "user", content: "Hi" }], {
        signal: controller.signal
      });

      const receivedTokens: string[] = [];
      for await (const chunk of stream) {
        if (chunk.content) {
          receivedTokens.push(chunk.content);
        }
        // Abort after first token
        controller.abort();
      }

      // Stream stopped cleanly after abort
      expect(receivedTokens.length).toBeLessThan(3);
    });
  });
});
