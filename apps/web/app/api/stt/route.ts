import { NextRequest, NextResponse } from "next/server";
import { GroqProvider } from "../../../../../src/ai/providers/groq/groq-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_SIZE_BYTES = 15 * 1024 * 1024; // 15MB limit

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("audio");

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Missing or invalid 'audio' file upload in form data." },
        { status: 400 }
      );
    }

    if (file.size > MAX_AUDIO_SIZE_BYTES) {
      return NextResponse.json(
        { error: "Audio payload exceeds maximum permitted size of 15MB." },
        { status: 400 }
      );
    }

    const groqProvider = new GroqProvider();
    if (!groqProvider.isConfigured()) {
      return NextResponse.json(
        { error: "Speech-to-text requires GROQ_API_KEY to be configured in server environment." },
        { status: 503 }
      );
    }

    // Whisper transcription via Groq
    const result = await groqProvider.transcribe({
      file,
      model: "whisper-large-v3-turbo"
    });

    return NextResponse.json({
      success: true,
      text: result.text.trim()
    });
  } catch (error: any) {
    console.error("[Alfred API] STT error:", error);
    return NextResponse.json(
      { error: "STT transcription failed: " + (error?.message || "Internal server error") },
      { status: 500 }
    );
  }
}
