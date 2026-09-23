import { describe, it, expect, vi } from "vitest";
import {
  ALFRED_DEFAULT_VOICE_PROFILE,
  getProfileVoiceForProvider
} from "../../src/voice/tts/profiles/alfred.js";
import { TTSService } from "../../src/voice/tts/service.js";
import { ITTSProvider, AudioData } from "../../src/voice/tts/types.js";

describe("VoiceProfile and TTSService Unit Tests", () => {
  it("should have correct canonical Alfred traits in ALFRED_DEFAULT_VOICE_PROFILE", () => {
    expect(ALFRED_DEFAULT_VOICE_PROFILE.id).toBe("alfred-default");
    expect(ALFRED_DEFAULT_VOICE_PROFILE.language).toBe("en-GB");
    expect(ALFRED_DEFAULT_VOICE_PROFILE.accent).toBe("British");
    expect(ALFRED_DEFAULT_VOICE_PROFILE.gender).toBe("male");
    expect(ALFRED_DEFAULT_VOICE_PROFILE.character).toBe("formal-butler");
    expect(ALFRED_DEFAULT_VOICE_PROFILE.style).toBe("calm");
    expect(ALFRED_DEFAULT_VOICE_PROFILE.energy).toBe("restrained");
  });

  it("should map elevenlabs to charlie and fallback appropriately", () => {
    const voiceId = getProfileVoiceForProvider(ALFRED_DEFAULT_VOICE_PROFILE, "elevenlabs");
    expect(voiceId).toBe("charlie");
    const fallbackVoice = getProfileVoiceForProvider(ALFRED_DEFAULT_VOICE_PROFILE, "unknown-provider");
    expect(fallbackVoice).toBe("charlie");
  });

  it("should delegate speak() from TTSService to the underlying provider", async () => {
    const mockAudio: AudioData = {
      samples: new Float32Array([0]),
      sampleRate: 24000,
      channels: 1,
      duration: 1,
      toWav: () => Buffer.from("RIFF..."),
      save: vi.fn().mockResolvedValue(undefined)
    };

    const mockProvider: ITTSProvider = {
      id: "mock-tts",
      name: "Mock TTS Provider",
      isConfigured: () => true,
      synthesize: vi.fn().mockResolvedValue(mockAudio),
      getSupportedVoices: () => [{ id: "mock-voice", name: "Mock", language: "en-GB", gender: "male" }]
    };

    const service = new TTSService({
      provider: mockProvider,
      profile: ALFRED_DEFAULT_VOICE_PROFILE
    });

    const result = await service.speak("Very good, sir.");

    expect(result).toBe(mockAudio);
    expect(mockProvider.synthesize).toHaveBeenCalledWith(
      "Very good, sir.",
      expect.objectContaining({
        language: "en-GB",
        speed: 0.95
      })
    );
  });
});
