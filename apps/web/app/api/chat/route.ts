import { NextRequest, NextResponse } from "next/server";
import { getAlfredSystemPrompt } from "../../../../../src/ai/prompts/alfred-persona.js";
import { getAIProvider } from "../../../../../src/ai/providers/factory.js";
import { ChatMessage } from "../../../../../src/ai/providers/types.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  message?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  stream?: boolean;
}

/**
 * Fallback deterministic generator for when no provider is configured.
 * Ensures local testing can verify end-to-end persona behavior without LLM credentials.
 */
function getDeterministicFallback(message: string): string {
  const lower = message.toLowerCase().trim();

  if (lower.includes("good morning") || lower.includes("hello") || lower.includes("good evening") || lower.includes("greetings")) {
    return "Good morning, sir. I trust you are well. How may I be of assistance today?";
  }

  if (lower.includes("capable of") || lower.includes("capabilities") || lower.includes("what can you do")) {
    return "At present, sir, I am operating within our voice and chat interaction playground. I can converse with you via real-time text streaming, reason through queries using Ollama (Gemma 4) or Groq, and maintain executive composure. External integrations such as your calendar, email, and repository management are pending subsequent implementation.";
  }

  if (lower.includes("calendar")) {
    return "I am afraid I do not have access to your calendar yet, sir. We have not yet connected the Google Calendar integration in this development milestone.";
  }

  if (lower.includes("amusing") || lower.includes("joke") || lower.includes("humour") || lower.includes("humor")) {
    return "I once observed a developer spend four hours writing a shell script to automate a thirty-second task, only for the script to require ongoing maintenance in perpetuity. An admirably persistent dedication to efficiency, sir.";
  }

  if (lower.includes("delete") && (lower.includes("database") || lower.includes("production") || lower.includes("prod"))) {
    return "I would strongly advise against that course of action, sir. Deleting the production database is an irreversible operation with catastrophic consequences for the entire platform. Might I suggest verifying a local staging backup or running our diagnostic checks instead?";
  }

  return `Indeed, sir. You remarked: "${message.slice(0, 100)}". I am at your service, though please note that live neural reasoning requires an AI provider (Ollama or Groq) to be configured.`;
}

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
    if (userMessage.length > 2000) {
      return NextResponse.json(
        { error: "Message exceeds maximum allowed length of 2000 characters." },
        { status: 400 }
      );
    }

    // Validate and sanitize ephemeral conversation history (max 10 turns)
    const sanitizedHistory: ChatMessage[] = [];
    if (Array.isArray(body.history)) {
      for (const item of body.history.slice(-10)) {
        if (
          (item.role === "user" || item.role === "assistant") &&
          typeof item.content === "string" &&
          item.content.length <= 2000
        ) {
          sanitizedHistory.push({
            role: item.role,
            content: item.content
          });
        }
      }
    }

    const messages: ChatMessage[] = [
      { role: "system", content: getAlfredSystemPrompt() },
      ...sanitizedHistory,
      { role: "user", content: userMessage }
    ];

    const isStreamingRequested = body.stream !== false;

    // Non-streaming fallback if client explicitly requests stream: false
    if (!isStreamingRequested) {
      let replyText = "";
      let providerName = "fallback-persona";

      try {
        const provider = getAIProvider();
        if (provider.isConfigured()) {
          const response = await provider.chat(messages, {
            temperature: 0.6,
            maxTokens: 1500
          });
          replyText = response.content.trim();
          providerName = provider.id;
        } else {
          replyText = getDeterministicFallback(userMessage);
        }
      } catch (err: any) {
        console.warn("[Alfred API] Provider chat error, falling back to deterministic response:", err?.message || err);
        replyText = getDeterministicFallback(userMessage);
      }

      return NextResponse.json({
        success: true,
        text: replyText,
        provider: providerName
      });
    }

    // Streaming response with Server-Sent Events (text/event-stream)
    const encoder = new TextEncoder();
    const abortController = new AbortController();

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
            sendEvent({ type: "start", provider: "fallback-persona" });
            const fallback = getDeterministicFallback(userMessage);
            sendEvent({ type: "chunk", text: fallback });
            sendEvent({ type: "done" });
            controller.close();
            return;
          }

          sendEvent({ type: "start", provider: provider.id });

          let hasStartedContent = false;

          for await (const chunk of provider.streamChat(messages, {
            temperature: 0.6,
            maxTokens: 1500,
            signal: abortController.signal
          })) {
            if (abortController.signal.aborted) {
              break;
            }

            // If the model is producing reasoning / thinking tokens:
            // Send "thinking" event WITHOUT exposing any internal thoughts
            if (chunk.thinking && !hasStartedContent) {
              sendEvent({ type: "thinking" });
            }

            // Send actual content tokens to the user
            if (chunk.content) {
              hasStartedContent = true;
              sendEvent({ type: "chunk", text: chunk.content });
            }

            if (chunk.done) {
              sendEvent({
                type: "done",
                finishReason: chunk.finishReason,
                usage: chunk.usage
              });
            }
          }

          controller.close();
        } catch (streamError: any) {
          console.error("[Alfred API] Stream generation error:", streamError);
          sendEvent({
            type: "error",
            error: streamError?.message || "An error occurred during streaming."
          });
          controller.close();
        }
      },
      cancel() {
        abortController.abort();
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
