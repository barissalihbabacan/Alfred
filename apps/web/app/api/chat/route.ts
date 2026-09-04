import { NextRequest, NextResponse } from "next/server";
import { getAlfredSystemPrompt } from "../../../../../src/ai/prompts/alfred-persona";
import { GroqProvider } from "../../../../../src/ai/providers/groq/groq-provider";
import { ChatMessage } from "../../../../../src/ai/providers/types";
import { TTSService } from "../../../../../src/voice/tts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Singleton TTS service to avoid re-initializing Kokoro model on every request
let ttsServiceInstance: TTSService | null = null;
function getTTSService(): TTSService {
  if (!ttsServiceInstance) {
    ttsServiceInstance = new TTSService();
  }
  return ttsServiceInstance;
}

interface ChatRequestBody {
  message?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Fallback deterministic generator for when GROQ_API_KEY is not configured in local environment.
 * Ensures local testing can verify end-to-end persona behavior and TTS without cloud credentials.
 */
function getDeterministicFallback(message: string): string {
  const lower = message.toLowerCase().trim();

  if (lower.includes("good morning") || lower.includes("hello") || lower.includes("good evening") || lower.includes("greetings")) {
    return "Good morning, sir. I trust you are well. How may I be of assistance today?";
  }

  if (lower.includes("capable of") || lower.includes("capabilities") || lower.includes("what can you do")) {
    return "At present, sir, I am operating within our voice and chat interaction playground. I can converse with you via text or voice, reason through queries using Groq, and speak using my local Kokoro voice engine. External integrations such as your calendar, email, and repository management are pending subsequent implementation.";
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

  return `Indeed, sir. You remarked: "${message.slice(0, 100)}". I am at your service, though please note that full cognitive reasoning requires GROQ_API_KEY to be configured.`;
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

    let replyText = "";
    let providerName = "fallback-persona";

    const groqProvider = new GroqProvider();
    if (groqProvider.isConfigured()) {
      try {
        const messages: ChatMessage[] = [
          { role: "system", content: getAlfredSystemPrompt() },
          ...sanitizedHistory,
          { role: "user", content: userMessage }
        ];

        const response = await groqProvider.chat(messages, {
          temperature: 0.6,
          maxTokens: 500
        });
        replyText = response.content.trim();
        providerName = "groq";
      } catch (err: any) {
        console.warn("[Alfred API] Groq chat error, falling back to deterministic response:", err?.message || err);
        replyText = getDeterministicFallback(userMessage);
      }
    } else {
      replyText = getDeterministicFallback(userMessage);
    }

    // Synthesize voice via Kokoro TTS
    const tts = getTTSService();
    const audioData = await tts.speak(replyText);
    const wavBuffer = audioData.toWav();
    const audioDataUrl = `data:audio/wav;base64,${wavBuffer.toString("base64")}`;

    return NextResponse.json({
      success: true,
      text: replyText,
      audio: audioDataUrl,
      duration: audioData.duration,
      provider: providerName
    });
  } catch (error: any) {
    console.error("[Alfred API] Chat error:", error);
    return NextResponse.json(
      { error: "Failed to process request: " + (error?.message || "Internal server error") },
      { status: 500 }
    );
  }
}
