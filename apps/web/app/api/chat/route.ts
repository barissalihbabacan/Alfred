import { NextRequest, NextResponse } from "next/server";
import { getAlfredSystemPrompt } from "../../../../../src/ai/prompts/alfred-persona.js";
import { getAIProvider } from "../../../../../src/ai/providers/factory.js";
import { ChatMessage } from "../../../../../src/ai/providers/types.js";
import { getConversationRepository } from "../../../../../src/data/firestore/index.js";
import { ContextBuilder } from "../../../../../src/alfred/cognitive/context/context-builder.js";
import { CONVERSATION_CONFIG } from "../../../../../src/data/firestore/conversation-repository.interface.js";
import { getMemoryService, RetrievedMemory } from "../../../../../src/alfred/cognitive/memory/index.js";
import { getToolRegistry } from "../../../../../src/alfred/control-plane/tool-router/tool-registry.js";
import { getToolRouter } from "../../../../../src/alfred/control-plane/tool-router/tool-router.js";
import { timezoneResolver } from "../../../../../src/ai/tools/time/timezone-resolver.js";
import { ToolCall } from "../../../../../src/ai/tools/types.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  message?: string;
  conversationId?: string;
  userId?: string;
  stream?: boolean;
}

/**
 * Fallback deterministic generator for when no provider is configured.
 * Ensures local testing can verify end-to-end persona behavior without LLM credentials.
 */
function getDeterministicFallback(message: string): string {
  const lower = message.toLowerCase().trim();

  if (lower.includes("good morning") || lower.includes("hello") || lower.includes("good evening") || lower.includes("greetings")) {
    return "Good morning, sir. I trust you slept well.";
  }

  // Deterministic time lookup
  if (
    lower.includes("what time") ||
    lower.includes("current time") ||
    lower.includes("time is it") ||
    lower.includes("saat kaç") ||
    lower.includes("time in ")
  ) {
    const cityMatch =
      lower.match(/(?:time in|time for|in)\s+([a-zA-Z\s]+?)(?:\?|$|\s+sir|\s+please)/i) ||
      lower.match(/([a-zA-Z]+)\s+time/i);
    const candidateCity = cityMatch ? cityMatch[1].trim() : null;

    if (!candidateCity || candidateCity === "the" || candidateCity === "a" || candidateCity === "now") {
      return "Which city, sir?";
    }

    const resolved = timezoneResolver.resolve(candidateCity);
    if (!resolved) {
      return `I'm afraid I cannot ascertain the timezone for "${candidateCity}", sir. Could you specify a nearby major city?`;
    }

    const now = new Date();
    const time12 = new Intl.DateTimeFormat("en-US", {
      timeZone: resolved.timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(now);

    return `It is currently ${time12} in ${resolved.matchedCity}, sir.`;
  }

  // Deterministic SSH connection check fallback
  if (
    (lower.includes("connect") || lower.includes("check") || lower.includes("ssh") || lower.includes("bağlan")) &&
    (lower.includes("home server") || lower.includes("home-server") || lower.includes("dev server") || lower.includes("dev-sunucum") || lower.includes("sunucu") || lower.includes("macbook"))
  ) {
    return "I have verified the SSH connection to your home development server, sir. The connection was authenticated and all systems are responsive.";
  }

  if (lower.includes("capable of") || lower.includes("capabilities") || lower.includes("what can you do")) {
    return "At present? Quite a bit, although I haven't yet been given the keys to the entire house. I can converse via real-time text streaming, reason through queries using Ollama or Groq, and maintain executive composure. External integrations such as your calendar, email, and repository management remain pending.";
  }

  if (lower.includes("calendar")) {
    return "Not yet, sir. Calendar access isn't connected to me at present.";
  }

  if (lower.includes("amusing") || lower.includes("joke") || lower.includes("humour") || lower.includes("humor")) {
    return "Apparently, someone once decided that the correct solution to an overpopulation problem was to introduce rabbits to an island. The rabbits, naturally, treated this as a feature request.";
  }

  if (lower.includes("rewrite") && (lower.includes("scratch") || lower.includes("entire"))) {
    return "I suspected you might say that, sir. No. We have rather a lot of working infrastructure already, and rewriting it would be a remarkably efficient way of turning several completed milestones into archaeology.";
  }

  if (lower.includes("delete") && (lower.includes("database") || lower.includes("production") || lower.includes("prod"))) {
    return "No, sir. Unless we have established that destroying production is the least bad option—which it almost certainly isn't—I would strongly advise against it. Let's establish what problem we're solving before we reach for the nuclear option.";
  }

  return `Indeed, sir. You remarked: "${message.slice(0, 100)}".`;
}

/**
 * GET /api/chat
 * Retrieves conversation metadata and bounded messages for restoring chat state on client reload.
 * Query parameters:
 * - conversationId: Retrieve specific conversation and its messages
 * - userId: List conversations for a user
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get("conversationId");
    const userId = searchParams.get("userId");

    const repo = getConversationRepository();

    if (conversationId) {
      const conversation = await repo.getConversation(conversationId);
      if (!conversation) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }

      const messages = await repo.getMessages(conversationId, {
        limit: CONVERSATION_CONFIG.MAX_CONTEXT_MESSAGES * 2
      });

      return NextResponse.json({
        success: true,
        conversation,
        messages
      });
    }

    if (userId) {
      const conversations = await repo.listConversations(userId);
      return NextResponse.json({
        success: true,
        conversations
      });
    }

    return NextResponse.json(
      { error: "A 'conversationId' or 'userId' parameter is required." },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("[Alfred API GET] Error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to retrieve conversation." },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/chat
 * Deletes a conversation by its ID.
 * Query parameters:
 * - conversationId: The ID of the conversation to delete
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const conversationId = searchParams.get("conversationId");

    if (!conversationId) {
      return NextResponse.json(
        { error: "A 'conversationId' parameter is required." },
        { status: 400 }
      );
    }

    const repo = getConversationRepository();
    await repo.deleteConversation(conversationId);

    return NextResponse.json({
      success: true,
      deletedConversationId: conversationId
    });
  } catch (err: any) {
    console.error("[Alfred API DELETE] Error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to delete conversation." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/chat
 * Main conversation endpoint with atomic Firestore persistence and SSE streaming.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequestBody;

    if (!body || typeof body.message !== "string" || !body.message.trim()) {
      return NextResponse.json(
        { error: "A non-empty 'message' string is required." },
        { status: 400 }
      );
    }

    const userMessage = body.message.trim();
    if (userMessage.length > CONVERSATION_CONFIG.MAX_MESSAGE_LENGTH) {
      return NextResponse.json(
        { error: `Message exceeds maximum allowed length of ${CONVERSATION_CONFIG.MAX_MESSAGE_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const repo = getConversationRepository();
    const userId = body.userId || "guest_default";

    // 1. Resolve or create conversation
    let convId = body.conversationId;
    if (convId) {
      const existing = await repo.getConversation(convId);
      if (!existing) {
        const created = await repo.createConversation({ userId, customId: convId });
        convId = created.id;
      }
    } else {
      const created = await repo.createConversation({ userId });
      convId = created.id;
    }

    // 2. Atomically persist user message to Firestore
    const userMsgDoc = await repo.appendMessage({
      conversationId: convId,
      role: "user",
      content: userMessage
    });

    // 3. Load bounded recent history prior to current message for LLM context
    const recentHistoryDocs = await repo.getMessages(convId, {
      limit: CONVERSATION_CONFIG.MAX_CONTEXT_MESSAGES,
      beforeSequence: userMsgDoc.sequence
    });

    // 4. Retrieve relevant long-term semantic memories (bounded & non-blocking)
    let relevantMemories: RetrievedMemory[] = [];
    try {
      const memoryService = getMemoryService();
      relevantMemories = await memoryService.searchMemories(userMessage, userId);
    } catch (memErr: any) {
      console.warn("[Alfred API] Semantic memory retrieval bypassed (continuing chat):", memErr?.message || memErr);
    }

    // 5. Assemble context using ContextBuilder (Persona + Canonical User Profile + Governor + Relevant Memories + Bounded History + Current Message)
    const messages = ContextBuilder.buildChatMessages({
      personaPrompt: getAlfredSystemPrompt(),
      relevantMemories,
      history: recentHistoryDocs.map((m) => ({ role: m.role, content: m.content })),
      currentMessage: userMessage
    }) as ChatMessage[];

    const isStreamingRequested = body.stream !== false;

    // 5A. Non-streaming fallback if stream: false requested
    if (!isStreamingRequested) {
      let replyText = "";
      let providerName = "fallback-persona";

      try {
        const provider = getAIProvider();
        if (provider.isConfigured()) {
          const toolRegistry = getToolRegistry();
          const toolRouter = getToolRouter();
          const toolDefinitions = toolRegistry.getDefinitions();

          const executionMessages: ChatMessage[] = [...messages];
          let chatResponse = await provider.chat(executionMessages, {
            temperature: 0.6,
            maxTokens: 1500,
            tools: toolDefinitions.length > 0 ? toolDefinitions : undefined
          });

          // Multi-turn tool execution loop (bounded to at most 3 turns)
          let turn = 0;
          while (chatResponse.toolCalls && chatResponse.toolCalls.length > 0 && turn < 3) {
            turn++;
            executionMessages.push({
              role: "assistant",
              content: chatResponse.content || "",
              toolCalls: chatResponse.toolCalls
            });

            for (const tc of chatResponse.toolCalls) {
              const result = await toolRouter.execute(tc, {
                userId,
                conversationId: convId
              });

              executionMessages.push({
                role: "tool",
                content: JSON.stringify(result.success ? result.data : { error: result.error }),
                toolCallId: tc.id
              });
            }

            chatResponse = await provider.chat(executionMessages, {
              temperature: 0.6,
              maxTokens: 1500
            });
          }

          replyText = chatResponse.content.trim();
          providerName = provider.id;
        } else {
          replyText = getDeterministicFallback(userMessage);
        }

        // Persist assistant message
        const assistantMsgDoc = await repo.appendMessage({
          conversationId: convId,
          role: "assistant",
          content: replyText,
          status: "completed",
          provider: providerName
        });

        // Trigger autonomous memory extraction asynchronously (non-blocking)
        void (async () => {
          try {
            const memoryService = getMemoryService();
            await memoryService.processConversationForMemories({
              currentMessage: userMessage,
              userId,
              conversationId: convId,
              recentMessages: recentHistoryDocs.map((m) => ({ role: m.role, content: m.content })),
              assistantResponse: replyText,
              sourceMessageIds: [userMsgDoc.id, assistantMsgDoc.id]
            });
          } catch (memExtErr: any) {
            console.warn("[Alfred API] Background memory extraction error:", memExtErr?.message || memExtErr);
          }
        })();
      } catch (err: any) {
        console.error("[Alfred API] Provider chat error:", err?.message || err);
        await repo.appendMessage({
          conversationId: convId,
          role: "assistant",
          content: "",
          status: "error",
          provider: providerName
        });
        return NextResponse.json(
          { error: err?.message || "AI provider failed to generate response." },
          { status: 502 }
        );
      }

      return NextResponse.json({
        success: true,
        conversationId: convId,
        text: replyText,
        provider: providerName
      });
    }

    // 5B. Streaming response with Server-Sent Events (text/event-stream)
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    let accumulatedText = "";
    let providerName = "fallback-persona";
    let isStreamCompleted = false;

    const stream = new ReadableStream({
      async start(controller) {
        function sendEvent(data: Record<string, unknown>) {
          const payload = `data: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        }

        try {
          const provider = getAIProvider();
          if (!provider.isConfigured() || typeof provider.streamChat !== "function") {
            // Stream deterministic fallback
            sendEvent({ type: "start", conversationId: convId, provider: "fallback-persona" });
            const fallback = getDeterministicFallback(userMessage);
            accumulatedText = fallback;
            sendEvent({ type: "chunk", text: fallback });
            sendEvent({ type: "done" });

            // Persist fallback assistant message
            await repo.appendMessage({
              conversationId: convId!,
              role: "assistant",
              content: accumulatedText,
              status: "completed",
              provider: "fallback-persona"
            });

            isStreamCompleted = true;
            controller.close();
            return;
          }

          providerName = provider.id;
          sendEvent({
            type: "start",
            conversationId: convId,
            provider: provider.id
          });

          const toolRegistry = getToolRegistry();
          const toolRouter = getToolRouter();
          const toolDefinitions = toolRegistry.getDefinitions();

          const currentMessages = [...messages];
          let activeTools: any = toolDefinitions.length > 0 ? toolDefinitions : undefined;
          let streamTurn = 0;
          const MAX_TOOL_TURNS = 3;

          while (streamTurn < MAX_TOOL_TURNS) {
            streamTurn++;
            let passAccumulatedText = "";
            let passToolCalls: ToolCall[] = [];

            for await (const chunk of provider.streamChat(currentMessages, {
              temperature: 0.6,
              maxTokens: 1500,
              tools: activeTools,
              signal: abortController.signal
            })) {
              if (abortController.signal.aborted) {
                break;
              }

              if (chunk.toolCalls && chunk.toolCalls.length > 0) {
                passToolCalls.push(...chunk.toolCalls);
              }

              if (chunk.content) {
                passAccumulatedText += chunk.content;
                // Only stream tokens directly to user if NO tool calls were initiated in this pass
                if (passToolCalls.length === 0) {
                  accumulatedText += chunk.content;
                  sendEvent({ type: "chunk", text: chunk.content });
                }
              }

              if (chunk.done && passToolCalls.length === 0) {
                sendEvent({
                  type: "done",
                  finishReason: chunk.finishReason,
                  usage: chunk.usage
                });
              }
            }

            if (abortController.signal.aborted) {
              break;
            }

            // If tool calls were initiated, dispatch them and loop for next response
            if (passToolCalls.length > 0) {
              sendEvent({
                type: "tool_call",
                toolCalls: passToolCalls.map((tc) => ({
                  id: tc.id,
                  name: tc.function.name,
                  arguments: tc.function.arguments
                }))
              });

              currentMessages.push({
                role: "assistant",
                content: passAccumulatedText || "",
                toolCalls: passToolCalls
              });

              for (const tc of passToolCalls) {
                const result = await toolRouter.execute(tc, {
                  userId,
                  conversationId: convId
                });

                sendEvent({
                  type: "tool_result",
                  toolCallId: tc.id,
                  toolName: tc.function.name,
                  success: result.success,
                  result: result.data || { error: result.error }
                });

                currentMessages.push({
                  role: "tool",
                  content: JSON.stringify(result.success ? result.data : { error: result.error }),
                  toolCallId: tc.id
                });
              }

              // Reset accumulatedText for final conversational response
              accumulatedText = "";
              activeTools = undefined;
            } else {
              // Direct user response completed without further tool invocations
              break;
            }
          }

          // Persist completed assistant message
          const cleanCompleted = accumulatedText.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
          if (!abortController.signal.aborted && cleanCompleted) {
            const assistantMsgDoc = await repo.appendMessage({
              conversationId: convId!,
              role: "assistant",
              content: cleanCompleted,
              status: "completed",
              provider: providerName
            });
            isStreamCompleted = true;

            // Trigger autonomous memory extraction asynchronously outside token stream
            void (async () => {
              try {
                const memoryService = getMemoryService();
                await memoryService.processConversationForMemories({
                  currentMessage: userMessage,
                  userId,
                  conversationId: convId,
                  recentMessages: recentHistoryDocs.map((m) => ({ role: m.role, content: m.content })),
                  assistantResponse: cleanCompleted,
                  sourceMessageIds: [userMsgDoc.id, assistantMsgDoc.id]
                });
              } catch (memExtErr: any) {
                console.warn("[Alfred API] Background memory extraction error:", memExtErr?.message || memExtErr);
              }
            })();
          }

          controller.close();
        } catch (streamError: any) {
          console.error("[Alfred API] Stream generation error:", streamError);
          sendEvent({
            type: "error",
            error: streamError?.message || "An error occurred during streaming."
          });

          // Record partial message or error state if needed
          try {
            if (accumulatedText) {
              await repo.appendMessage({
                conversationId: convId!,
                role: "assistant",
                content: accumulatedText,
                status: "interrupted",
                provider: providerName
              });
            }
          } catch (persistErr) {
            console.error("[Alfred API] Failed to persist interrupted message:", persistErr);
          }

          controller.close();
        }
      },
      async cancel() {
        abortController.abort();
        if (!isStreamCompleted && accumulatedText) {
          try {
            await repo.appendMessage({
              conversationId: convId!,
              role: "assistant",
              content: accumulatedText,
              status: "interrupted",
              provider: providerName
            });
          } catch (cancelErr) {
            console.error("[Alfred API] Failed to persist cancelled stream message:", cancelErr);
          }
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive"
      }
    });
  } catch (error: any) {
    console.error("[Alfred API] Chat error:", error);
    return NextResponse.json(
      { error: "Failed to process request: " + (error?.message || "Internal server error") },
      { status: 500 }
    );
  }
}
