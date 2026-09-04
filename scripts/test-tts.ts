import fs from "node:fs/promises";
import path from "node:path";
import { TTSService } from "../src/voice/tts/service.js";
import { getTTSConfig } from "../src/core/config/index.js";

const ALFRED_TEST_PHRASES = [
  "Indeed, sir. I am at your service.",
  "Very good, sir. I shall take care of it.",
  "I'm afraid there is a slight complication, sir.",
  "I would strongly advise against that course of action.",
  "An excellent idea, sir. Though I must confess, I have concerns.",
  "The Alfrover has arrived, sir."
];

async function runTTSVerification(): Promise<void> {
  console.log("=================================================");
  console.log("B.U.T.L.E.R. Alfred — Local TTS (Kokoro-82M)");
  console.log("=================================================");

  const config = getTTSConfig();
  console.log(`[Config] Provider    : ${config.provider}`);
  console.log(`[Config] Voice       : ${config.voice}`);
  console.log(`[Config] Language    : ${config.language}`);
  console.log(`[Config] Model       : ${config.model}`);
  console.log(`[Config] Quantization: ${config.dtype}`);
  console.log(`[Config] Device      : ${config.device}`);
  console.log(`[Config] Speed       : ${config.speed}`);
  console.log(`[Config] Sample Rate : ${config.sampleRate} Hz`);

  const outputDir = path.resolve(process.cwd(), "audio_output/alfred");
  await fs.mkdir(outputDir, { recursive: true });

  const ttsService = new TTSService();
  const shouldPlay = process.argv.includes("--play");

  console.log("\n[TTS] Synthesizing canonical Alfred butler phrases...\n");

  for (let i = 0; i < ALFRED_TEST_PHRASES.length; i++) {
    const text = ALFRED_TEST_PHRASES[i];
    const phraseNum = i + 1;
    const outputFile = path.join(outputDir, `alfred_phrase_${phraseNum}.wav`);

    console.log(`[${phraseNum}/${ALFRED_TEST_PHRASES.length}] "${text}"`);

    const startTime = performance.now();
    const audio = await ttsService.speak(text);
    const elapsed = performance.now() - startTime;

    await audio.save(outputFile);
    const fileStat = await fs.stat(outputFile);

    console.log(`   ✔ Duration: ${audio.duration.toFixed(2)}s | Latency: ${elapsed.toFixed(0)}ms | Size: ${(fileStat.size / 1024).toFixed(1)} KB | Saved: ${path.relative(process.cwd(), outputFile)}`);

    if (shouldPlay && i === 0) {
      console.log("   ▶ Playing sample audio via detected system player...");
      const played = await ttsService.playAudio(outputFile);
      if (played) {
        console.log("   ✔ Audio playback completed.");
      } else {
        console.log("   ℹ Playback skipped (no audio player or headless environment).");
      }
    }
  }

  console.log("\n=================================================");
  console.log("All sample phrases synthesized successfully!");
  console.log(`Output folder: ${outputDir}`);
  console.log("=================================================");
}

runTTSVerification().catch((err) => {
  console.error("TTS Verification failed:", err);
  process.exit(1);
});
