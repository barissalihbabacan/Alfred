import fs from "node:fs/promises";
import path from "node:path";
import { TTSService } from "../src/voice/tts/service.js";

const TEST_RESPONSES = [
  {
    name: "test_1.wav",
    text: "Good morning, sir. I trust you are well. How may I be of assistance today?"
  },
  {
    name: "test_2.wav",
    text: "At present, sir, I am operating within our voice and chat interaction playground. External integrations such as your calendar, email, and repository management are pending subsequent implementation."
  },
  {
    name: "test_3.wav",
    text: "I am afraid I do not have access to your calendar yet, sir. We have not yet connected the Google Calendar integration in this development milestone."
  },
  {
    name: "test_4.wav",
    text: "I once observed a developer spend four hours writing a shell script to automate a thirty-second task, only for the script to require ongoing maintenance in perpetuity. An admirably persistent dedication to efficiency, sir."
  },
  {
    name: "test_5.wav",
    text: "I would strongly advise against that course of action, sir. Deleting the production database is an irreversible operation with catastrophic consequences for the entire platform. Might I suggest verifying a local staging backup instead?"
  }
];

async function main() {
  const outputDir = path.resolve(process.cwd(), "apps/web/public/audio");
  await fs.mkdir(outputDir, { recursive: true });

  const tts = new TTSService();

  for (const item of TEST_RESPONSES) {
    const target = path.join(outputDir, item.name);
    console.log(`Synthesizing ${item.name}...`);
    const audioData = await tts.speak(item.text);
    await audioData.save(target);
    console.log(`✓ Saved ${item.name} (${audioData.duration.toFixed(2)}s)`);
  }

  console.log("All web audio assets synthesized successfully.");
}

main().catch(console.error);
