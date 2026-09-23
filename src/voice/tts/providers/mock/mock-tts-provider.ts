import { ITTSProvider, AudioData, SynthesizeOptions } from "../../types.js";
import { createAudioData } from "../../../audio/audio-data.js";
import { TTSInferenceError } from "../../../../core/errors/index.js";

export class MockTTSProvider implements ITTSProvider {
  public readonly id = "mock" as const;
  public readonly name = "Mock TTS Provider";

  private configured: boolean;

  constructor(options?: { configured?: boolean }) {
    this.configured = options?.configured ?? true;
  }

  public isConfigured(): boolean {
    return this.configured;
  }

  public async synthesize(text: string, _options?: SynthesizeOptions): Promise<AudioData> {
    if (!text || text.trim().length === 0) {
      throw new TTSInferenceError(this.id, "Text cannot be empty for synthesis.");
    }

    const sampleRate = 24000;
    // Generate 0.5s of silence / dummy PCM samples
    const sampleCount = Math.floor(sampleRate * 0.5);
    const samples = new Float32Array(sampleCount);

    return createAudioData(samples, sampleRate, 1);
  }

  public getSupportedVoices(): Array<{
    id: string;
    name: string;
    language: string;
    gender: string;
  }> {
    return [
      { id: "default", name: "Default Mock Voice", language: "en-GB", gender: "neutral" },
      { id: "charlie", name: "Charlie", language: "en-GB", gender: "male" }
    ];
  }
}
