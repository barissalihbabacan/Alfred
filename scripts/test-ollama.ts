import { getAIConfig } from "../src/core/config/index.js";
import { OllamaProvider } from "../src/ai/providers/ollama/index.js";
import { getAlfredSystemPrompt } from "../src/ai/prompts/alfred-persona.js";
import { AIProviderError } from "../src/core/errors/index.js";

const PERSONA_TEST_PROMPTS = [
  "Alfred, I'm just going to write a quick twenty-line script for this.",
  "Alfred, the server is angry.",
  "Alfred, I've broken the deployment again.",
  "Alfred, tell me something amusing about software engineering.",
  "Alfred, I think I'm going to rewrite this entire project from scratch.",
  "Alfred, what do you think my greatest engineering weakness is?",
  "Alfred, I've decided that every simple script deserves its own framework, plugin system, telemetry stack, CLI, and Kubernetes deployment. What do you think?"
];

async function runOllamaVerification(): Promise<void> {
  console.log("==================================================");
  console.log("B.U.T.L.E.R. Alfred — Ollama Provider Verification");
  console.log("==================================================");

  const config = getAIConfig();
  console.log(`[Config] Active Provider : ${config.activeProvider}`);
  console.log(`[Config] Ollama Base URL : ${config.ollama.baseUrl}`);
  console.log(`[Config] Ollama Model    : ${config.ollama.defaultModel}`);
  console.log(`[Config] Timeout         : ${config.ollama.timeoutMs}ms`);

  const provider = new OllamaProvider();

  // 1. Health & Diagnostics Check
  console.log("\n[1/3] Performing Health & Connectivity Check...");
  const health = await provider.checkHealth();
  console.log(`  Health Status  : ${health.status}`);
  console.log(`  Reachable      : ${health.reachable}`);
  console.log(`  Model Available: ${health.modelAvailable}`);

  if (!health.reachable) {
    console.error(`\n✖ [Failed] Ollama server is unreachable at ${config.ollama.baseUrl}`);
    console.error(`  Details: ${(health as any).error}`);
    console.error("  Please ensure your Tailscale connection is active or check OLLAMA_BASE_URL.");
    process.exit(1);
  }

  if (!health.modelAvailable) {
    console.error(`\n✖ [Failed] Configured model '${config.ollama.defaultModel}' not found on server.`);
    console.error(`  Available models: ${(health as any).availableModels?.join(", ") || "none"}`);
    process.exit(1);
  }

  console.log("✔ Ollama server reachable and model available!");

  // 2. Real-Time Streaming Verification & TTFT Measurement
  console.log("\n[2/4] Executing Real-Time Streaming Verification & Measuring TTFT...");
  const streamPrompt = "Good morning, Alfred. Are you ready for today's tasks?";
  const t0 = Date.now();
  let firstThinkingTime: number | null = null;
  let firstContentTime: number | null = null;
  let contentChunksCount = 0;
  let thinkingChunksCount = 0;
  let accumulatedContent = "";

  try {
    process.stdout.write("  Streaming: ");
    for await (const chunk of provider.streamChat([
      { role: "system", content: getAlfredSystemPrompt() },
      { role: "user", content: streamPrompt }
    ], {
      temperature: 0.6,
      maxTokens: 1500
    })) {
      if (chunk.thinking) {
        thinkingChunksCount++;
        if (firstThinkingTime === null) {
          firstThinkingTime = Date.now() - t0;
        }
      }

      if (chunk.content) {
        contentChunksCount++;
        if (firstContentTime === null) {
          firstContentTime = Date.now() - t0;
        }
        accumulatedContent += chunk.content;
        process.stdout.write(chunk.content);
      }
    }
    const totalStreamTime = Date.now() - t0;
    process.stdout.write("\n");

    console.log("\n✔ [Streaming Complete]");
    console.log(`  TTFT (Time To First Content Token) : ${firstContentTime ?? "N/A"} ms`);
    console.log(`  Time in Thinking Phase             : ${firstThinkingTime !== null ? `${firstThinkingTime} ms (first thought)` : "No thinking chunks"}`);
    console.log(`  Total Stream Latency               : ${totalStreamTime} ms`);
    console.log(`  Thinking Chunks                    : ${thinkingChunksCount}`);
    console.log(`  Content Chunks                     : ${contentChunksCount}`);
    console.log(`  Accumulated Characters             : ${accumulatedContent.length}`);
  } catch (err: any) {
    console.error("\n✖ [Streaming Test Failed]", err?.message || err);
    process.exit(1);
  }

  // 3. Quick Non-Streaming Smoke Test
  console.log("\n[3/4] Executing Non-Streaming Chat Completion Smoke Test...");
  const smokePrompt = "Confirm concisely that the B.U.T.L.E.R. Alfred Ollama integration is operational.";
  const tChat0 = Date.now();
  try {
    const smokeResponse = await provider.chat([
      { role: "system", content: getAlfredSystemPrompt() },
      { role: "user", content: smokePrompt }
    ]);
    const tElapsed = Date.now() - tChat0;
    console.log("✔ [Response Received]");
    console.log(`  Latency : ${tElapsed} ms`);
    if (smokeResponse.usage) {
      console.log(`  Tokens  : ${smokeResponse.usage.promptTokens} prompt + ${smokeResponse.usage.completionTokens} completion = ${smokeResponse.usage.totalTokens} total`);
    }
    console.log(`  Content : "${smokeResponse.content.trim()}"`);
  } catch (err: any) {
    console.error("✖ [Smoke Test Failed]", err?.message || err);
    process.exit(1);
  }

  // 4. Persona Evaluation Prompts
  const runPersona = process.argv.includes("--persona") || process.argv.includes("--all");
  if (runPersona) {
    console.log("\n[4/4] Running 7 Persona Evaluation Prompts against Gemma 4...");
    console.log("================================================================");

    for (let i = 0; i < PERSONA_TEST_PROMPTS.length; i++) {
      const promptText = PERSONA_TEST_PROMPTS[i];
      console.log(`\n[Prompt #${i + 1}] "${promptText}"`);

      const start = Date.now();
      try {
        const res = await provider.chat([
          { role: "system", content: getAlfredSystemPrompt() },
          { role: "user", content: promptText }
        ], {
          temperature: 0.6,
          maxTokens: 2048
        });
        const duration = Date.now() - start;

        console.log(`  Latency : ${duration} ms`);
        if (res.usage) {
          console.log(`  Tokens  : ${res.usage.promptTokens} prompt + ${res.usage.completionTokens} completion = ${res.usage.totalTokens} total`);
        }
        console.log(`  Alfred  :\n${res.content.trim()}`);
      } catch (err: any) {
        console.error(`  ✖ Prompt #${i + 1} failed:`, err?.message || err);
      }
    }
    console.log("\n================================================================");
  }

  console.log("\nOllama live verification completed successfully!");
}

runOllamaVerification().catch((err) => {
  console.error("Unhandled verification error:", err);
  process.exit(1);
});
