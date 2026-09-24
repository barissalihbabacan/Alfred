import { describe, it, expect, beforeEach } from "vitest";
import { AIProvider, ChatMessage, ChatCompletionOptions, ChatCompletionResponse, ChatStreamChunk, ToolCall } from "../../src/ai/providers/types.js";
import type { CurrentTimeResult } from "../../src/ai/tools/time/current-time.js";
import { getToolRegistry } from "../../src/alfred/control-plane/tool-router/tool-registry.js";
import { getToolRouter } from "../../src/alfred/control-plane/tool-router/tool-router.js";

/**
 * Mock AI Provider that simulates model tool calling behavior.
 */
class MockToolCallingProvider implements AIProvider {
  public readonly id = "mock-tool-provider";
  public readonly name = "Mock Tool Provider";

  public isConfigured(): boolean {
    return true;
  }

  public getSupportedModels() {
    return { chat: ["mock-model"] };
  }

  public async chat(
    messages: ChatMessage[],
    _options?: ChatCompletionOptions
  ): Promise<ChatCompletionResponse> {
    const lastMsg = messages[messages.length - 1];

    // If tool response is provided, return final synthesized response
    if (lastMsg.role === "tool") {
      const toolData = JSON.parse(lastMsg.content);
      return {
        id: "mock_resp_final",
        role: "assistant",
        model: "mock-model",
        content: `It is currently ${toolData.localTime} in ${toolData.city}, sir.`
      };
    }

    // If user asks for time in London, emit tool call
    if (lastMsg.content.toLowerCase().includes("london")) {
      return {
        id: "mock_resp_1",
        role: "assistant",
        model: "mock-model",
        content: "",
        toolCalls: [
          {
            id: "call_time_london",
            type: "function",
            function: {
              name: "get_current_time",
              arguments: JSON.stringify({ city: "London" })
            }
          }
        ]
      };
    }

    // If user asks for time without city
    if (lastMsg.content.toLowerCase().includes("what time")) {
      return {
        id: "mock_resp_clarify",
        role: "assistant",
        model: "mock-model",
        content: "Which city, sir?"
      };
    }

    return {
      id: "mock_resp_default",
      role: "assistant",
      model: "mock-model",
      content: "Very good, sir."
    };
  }

  public async *streamChat(
    messages: ChatMessage[],
    _options?: ChatCompletionOptions
  ): AsyncIterable<ChatStreamChunk> {
    const lastMsg = messages[messages.length - 1];

    if (lastMsg.role === "tool") {
      const toolData = JSON.parse(lastMsg.content);
      const reply = `It is currently ${toolData.localTime} in ${toolData.city}, sir.`;
      for (const word of reply.split(" ")) {
        yield { content: word + " " };
      }
      yield { done: true };
      return;
    }

    if (lastMsg.content.toLowerCase().includes("london")) {
      yield {
        toolCalls: [
          {
            id: "call_stream_london",
            type: "function",
            function: {
              name: "get_current_time",
              arguments: JSON.stringify({ city: "London" })
            }
          }
        ],
        done: true,
        finishReason: "tool_calls"
      };
      return;
    }

    yield { content: "Which city, sir?", done: true };
  }
}

describe("Tool Calling End-to-End Orchestration Suite", () => {
  let mockProvider: MockToolCallingProvider;
  const toolRegistry = getToolRegistry();
  const toolRouter = getToolRouter();

  beforeEach(() => {
    mockProvider = new MockToolCallingProvider();
  });

  describe("Non-streaming Tool Round-trip", () => {
    it("orchestrates: User Query -> Model Tool Call -> Router Execution -> Model Final Synthesis", async () => {
      const userMessage = "What time is it in London?";
      const messages: ChatMessage[] = [
        { role: "system", content: "You are Alfred, a refined British butler." },
        { role: "user", content: userMessage }
      ];

      // Step 1: Initial invocation with tools exposed
      const firstPass = await mockProvider.chat(messages, {
        tools: toolRegistry.getDefinitions()
      });

      expect(firstPass.toolCalls).toBeDefined();
      expect(firstPass.toolCalls?.length).toBe(1);
      expect(firstPass.toolCalls?.[0].function.name).toBe("get_current_time");

      // Step 2: Route and execute tool call
      const toolCall = firstPass.toolCalls![0];
      const toolResult = await toolRouter.execute(toolCall, { userId: "baris" });

      expect(toolResult.success).toBe(true);
      expect((toolResult.data as CurrentTimeResult).city).toBe("London");

      // Step 3: Append assistant message & tool result message
      messages.push({
        role: "assistant",
        content: firstPass.content,
        toolCalls: firstPass.toolCalls
      });
      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult.data),
        toolCallId: toolCall.id
      });

      // Step 4: Second pass to generate final natural response
      const finalPass = await mockProvider.chat(messages);

      expect(finalPass.toolCalls).toBeUndefined();
      expect(finalPass.content).toContain("in London, sir.");
      expect(finalPass.content).toMatch(/\d{1,2}:\d{2}\s+(AM|PM)/i);
    });

    it("politely asks for clarification when city is omitted", async () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "What time is it?" }
      ];

      const response = await mockProvider.chat(messages, {
        tools: toolRegistry.getDefinitions()
      });

      expect(response.toolCalls).toBeUndefined();
      expect(response.content).toBe("Which city, sir?");
    });
  });

  describe("Streaming Tool Round-trip", () => {
    it("accumulates tool call from stream chunks, executes tool, and streams final response", async () => {
      const messages: ChatMessage[] = [
        { role: "user", content: "What time is it in London?" }
      ];

      // First stream pass: model emits toolCalls
      const receivedToolCalls: ToolCall[] = [];
      for await (const chunk of mockProvider.streamChat(messages, {
        tools: toolRegistry.getDefinitions()
      })) {
        if (chunk.toolCalls) {
          receivedToolCalls.push(...chunk.toolCalls);
        }
      }

      expect(receivedToolCalls.length).toBe(1);
      const tc = receivedToolCalls[0];
      expect(tc.function.name).toBe("get_current_time");

      // Dispatch to router
      const toolResult = await toolRouter.execute(tc, { userId: "baris" });
      expect(toolResult.success).toBe(true);

      // Add to conversation
      messages.push({
        role: "assistant",
        content: "",
        toolCalls: [tc]
      });
      messages.push({
        role: "tool",
        content: JSON.stringify(toolResult.data),
        toolCallId: tc.id
      });

      // Second stream pass: model synthesizes final reply
      let finalText = "";
      for await (const chunk of mockProvider.streamChat(messages)) {
        if (chunk.content) {
          finalText += chunk.content;
        }
      }

      expect(finalText.trim()).toContain("in London, sir.");
    });
  });
});
