import { describe, it, expect } from "vitest";
import { KokoroTTSProvider } from "../../src/voice/tts/providers/kokoro/kokoro-provider.js";

describe("Kokoro TTS Local Integration Test", () => {
  it(
    "should synthesize speech offline using local Kokoro-82M model",
    async () => {
      const provider = new KokoroTTSProvider({
        config: { voice: "bm_george", dtype: "q8", device: "cpu" }
      });

      const text = "Indeed, sir. I am at your service.";
      const audio = await provider.synthesize(text);

      expect(audio).toBeDefined();
      expect(audio.duration).toBeGreaterThan(1.0);
      expect(audio.sampleRate).toBe(24000);
      expect(audio.samples.length).toBeGreaterThan(24000);

      const wavBuffer = audio.toWav();
      expect(wavBuffer.length).toBeGreaterThan(44);
      expect(wavBuffer.toString("utf8", 0, 4)).toBe("RIFF");
      expect(wavBuffer.toString("utf8", 8, 12)).toBe("WAVE");
    },
    60000
  );
});
