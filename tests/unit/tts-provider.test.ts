import { describe, it, expect } from "vitest";
import { MockTTSProvider } from "../../src/voice/tts/providers/mock/mock-tts-provider.js";
import { encodeWav16Bit, createAudioData } from "../../src/voice/audio/audio-data.js";
import { TTSInferenceError } from "../../src/core/errors/index.js";

describe("TTSProvider and AudioData Unit Tests", () => {
  it("should be configured without requiring external credentials", () => {
    const provider = new MockTTSProvider();
    expect(provider.isConfigured()).toBe(true);
    expect(provider.id).toBe("mock");
    expect(provider.name).toContain("Mock");
  });

  it("should reject empty text with TTSInferenceError", async () => {
    const provider = new MockTTSProvider();
    await expect(provider.synthesize("   ")).rejects.toThrow(TTSInferenceError);
  });

  it("should synthesize text into AudioData with correct duration and sample rate", async () => {
    const provider = new MockTTSProvider();
    const audio = await provider.synthesize("Indeed, sir. I am at your service.");

    expect(audio).toBeDefined();
    expect(audio.sampleRate).toBe(24000);
    expect(audio.duration).toBe(0.5);
    expect(audio.channels).toBe(1);

    const wavBuffer = audio.toWav();
    expect(wavBuffer.toString("utf8", 0, 4)).toBe("RIFF");
    expect(wavBuffer.toString("utf8", 8, 12)).toBe("WAVE");
  });

  it("should list supported voices", () => {
    const provider = new MockTTSProvider();
    const voices = provider.getSupportedVoices();

    const voiceIds = voices.map((v) => v.id);
    expect(voiceIds).toContain("default");
    expect(voiceIds).toContain("charlie");
  });

  it("should correctly encode 16-bit PCM WAV headers in encodeWav16Bit", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1.0, -1.0]);
    const buffer = encodeWav16Bit(samples, 24000, 1);

    expect(buffer.length).toBe(44 + samples.length * 2);
    expect(buffer.toString("utf8", 0, 4)).toBe("RIFF");
    expect(buffer.readUInt32LE(24)).toBe(24000); // Sample rate
    expect(buffer.readUInt16LE(34)).toBe(16);    // Bits per sample
  });

  it("should create valid AudioData object and save wav", async () => {
    const samples = new Float32Array(2400); // 0.1s
    const audio = createAudioData(samples, 24000, 1);

    expect(audio.duration).toBe(0.1);
    expect(audio.channels).toBe(1);
    expect(audio.sampleRate).toBe(24000);
  });
});
