import { describe, it, expect, vi, beforeEach } from "vitest";
import { KokoroTTSProvider } from "../../src/voice/tts/providers/kokoro/kokoro-provider.js";
import { encodeWav16Bit, createAudioData } from "../../src/voice/tts/providers/kokoro/kokoro-audio.js";
import {
  TTSInferenceError,
  TTSVoiceNotFoundError,
  TTSModelError
} from "../../src/core/errors/index.js";

describe("KokoroTTSProvider Unit Tests", () => {
  let mockKokoroInstance: any;

  beforeEach(() => {
    mockKokoroInstance = {
      generate: vi.fn(),
      stream: vi.fn()
    };
  });

  it("should be configured without requiring API keys", () => {
    const provider = new KokoroTTSProvider({ ttsInstance: mockKokoroInstance });
    expect(provider.isConfigured()).toBe(true);
    expect(provider.id).toBe("kokoro");
    expect(provider.name).toContain("Kokoro");
  });

  it("should reject empty text with TTSInferenceError", async () => {
    const provider = new KokoroTTSProvider({ ttsInstance: mockKokoroInstance });
    await expect(provider.synthesize("   ")).rejects.toThrow(TTSInferenceError);
  });

  it("should reject unsupported voice with TTSVoiceNotFoundError", async () => {
    const provider = new KokoroTTSProvider({ ttsInstance: mockKokoroInstance });
    await expect(
      provider.synthesize("Hello sir", { voice: "unknown_voice_id" })
    ).rejects.toThrow(TTSVoiceNotFoundError);
  });

  it("should synthesize text into AudioData with correct duration and sample rate", async () => {
    const fakeSamples = new Float32Array(48000); // 2 seconds at 24kHz
    for (let i = 0; i < fakeSamples.length; i++) {
      fakeSamples[i] = Math.sin(i / 10);
    }

    mockKokoroInstance.generate.mockResolvedValueOnce({
      audio: fakeSamples,
      sampling_rate: 24000
    });

    const provider = new KokoroTTSProvider({
      ttsInstance: mockKokoroInstance,
      config: { voice: "bm_george" }
    });

    const audio = await provider.synthesize("Indeed, sir. I am at your service.");

    expect(audio).toBeDefined();
    expect(audio.sampleRate).toBe(24000);
    expect(audio.duration).toBe(2); // 48000 / 24000
    expect(audio.channels).toBe(1);

    const wavBuffer = audio.toWav();
    expect(wavBuffer.toString("utf8", 0, 4)).toBe("RIFF");
    expect(wavBuffer.toString("utf8", 8, 12)).toBe("WAVE");
  });

  it("should list supported British and canonical voices", () => {
    const provider = new KokoroTTSProvider({ ttsInstance: mockKokoroInstance });
    const voices = provider.getSupportedVoices();

    const voiceIds = voices.map((v) => v.id);
    expect(voiceIds).toContain("bm_george");
    expect(voiceIds).toContain("bm_fable");
    expect(voiceIds).toContain("bm_lewis");
    expect(voiceIds).toContain("bm_daniel");
  });

  it("should correctly encode 16-bit PCM WAV headers in encodeWav16Bit", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1.0, -1.0]);
    const buffer = encodeWav16Bit(samples, 24000, 1);

    expect(buffer.length).toBe(44 + samples.length * 2);
    expect(buffer.toString("utf8", 0, 4)).toBe("RIFF");
    expect(buffer.readUInt32LE(24)).toBe(24000); // Sample rate
    expect(buffer.readUInt16LE(34)).toBe(16);    // Bits per sample
  });
});
