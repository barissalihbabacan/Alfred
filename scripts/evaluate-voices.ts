import fs from "node:fs/promises";
import path from "node:path";
import { KokoroTTS } from "kokoro-js";

const TEST_PHRASES = [
  "Indeed, sir. I am at your service.",
  "Very good, sir. I shall take care of it.",
  "I'm afraid there is a slight complication, sir.",
  "I would strongly advise against that course of action.",
  "An excellent idea, sir. Though I must confess, I have concerns.",
  "The Alfrover has arrived, sir."
];

const CANDIDATE_VOICES = [
  { id: "bm_george", name: "George", description: "British male, grade B/C" },
  { id: "bm_fable", name: "Fable", description: "British male, grade B/C" },
  { id: "bm_lewis", name: "Lewis", description: "British male, grade C/D+" },
  { id: "bm_daniel", name: "Daniel", description: "British male, grade C/D" }
];

async function evaluate() {
  console.log("=========================================================");
  console.log("B.U.T.L.E.R. Alfred — British Male Voice Evaluation Suite");
  console.log("=========================================================");

  const outputDir = path.resolve(process.cwd(), "audio_output/eval");
  await fs.mkdir(outputDir, { recursive: true });

  console.log("Initializing Kokoro TTS model (Kokoro-82M-v1.0-ONNX, dtype=q8, device=cpu)...");
  const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
    dtype: "q8",
    device: "cpu"
  });
  console.log("Model loaded successfully.\n");

  const results: Record<string, { totalTimeMs: number; totalDurationSec: number; phraseStats: any[] }> = {};

  for (const voice of CANDIDATE_VOICES) {
    console.log(`Evaluating candidate: ${voice.id} (${voice.name})`);
    results[voice.id] = { totalTimeMs: 0, totalDurationSec: 0, phraseStats: [] };

    for (let i = 0; i < TEST_PHRASES.length; i++) {
      const phrase = TEST_PHRASES[i];
      const startTime = performance.now();
      const audio = await tts.generate(phrase, { voice: voice.id, speed: 0.95 });
      const elapsedMs = performance.now() - startTime;

      const durationSec = audio.audio.length / audio.sampling_rate;
      const rtf = (elapsedMs / 1000) / durationSec; // Real Time Factor (<1 means faster than real-time)

      results[voice.id].totalTimeMs += elapsedMs;
      results[voice.id].totalDurationSec += durationSec;
      results[voice.id].phraseStats.push({
        phraseIndex: i + 1,
        text: phrase,
        durationSec: Number(durationSec.toFixed(2)),
        elapsedMs: Number(elapsedMs.toFixed(1)),
        rtf: Number(rtf.toFixed(2))
      });

      const fileName = `${voice.id}_phrase_${i + 1}.wav`;
      const filePath = path.join(outputDir, fileName);
      await audio.save(filePath);
    }
  }

  console.log("\n=========================================================");
  console.log("EVALUATION SUMMARY");
  console.log("=========================================================");
  console.table(
    CANDIDATE_VOICES.map(v => {
      const data = results[v.id];
      const avgRtf = (data.totalTimeMs / 1000) / data.totalDurationSec;
      return {
        Voice: v.id,
        Name: v.name,
        "Total Duration (s)": Number(data.totalDurationSec.toFixed(2)),
        "Total Time (ms)": Number(data.totalTimeMs.toFixed(0)),
        "Average RTF": Number(avgRtf.toFixed(2)),
        Grade: v.description
      };
    })
  );

  console.log(`Generated audio samples stored in: ${outputDir}`);
}

evaluate().catch(console.error);
