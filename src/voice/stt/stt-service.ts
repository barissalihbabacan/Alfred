import { AISpeechToTextProvider } from "../../ai/providers/types.js";
import { SpeechToTextService, STTTranscriptionOptions, STTTranscriptionResult } from "./types.js";
import { AIProviderError } from "../../core/errors/index.js";

/**
 * Adapter that connects an AI SpeechToText provider (such as Groq Whisper)
 * to Alfred's voice processing subsystem.
 */
export class ProviderSTTAdapter implements SpeechToTextService {
  constructor(private readonly provider: AISpeechToTextProvider) {}

  public async transcribe(options: STTTranscriptionOptions): Promise<STTTranscriptionResult> {
    if (!this.provider.transcribe) {
      throw new AIProviderError("voice", "Underlying provider does not support speech-to-text", 400);
    }
    return this.provider.transcribe(options);
  }
}
