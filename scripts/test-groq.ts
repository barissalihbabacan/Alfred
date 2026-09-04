import { getAIConfig } from "../src/core/config/index.js";
import { GroqProvider } from "../src/ai/providers/groq/index.js";
import { AIProviderError } from "../src/core/errors/index.js";

async function runGroqVerification(): Promise<void> {
  console.log("=================================================");
  console.log("B.U.T.L.E.R. Alfred — Groq Provider Verification");
  console.log("=================================================");

  const config = getAIConfig();
  const apiKeyPresent = Boolean(config.groq.apiKey);

  console.log(`[Config] Active Provider : ${config.activeProvider}`);
  console.log(`[Config] Groq Chat Model : ${config.groq.defaultModel}`);
  console.log(`[Config] Groq STT Model  : ${config.groq.sttModel}`);
  console.log(`[Config] API Key Status  : ${apiKeyPresent ? "Configured (Present)" : "Not Configured"}`);

  if (!apiKeyPresent) {
    console.warn("\n[Warning] GROQ_API_KEY is not set in your environment or .env file.");
    console.warn("To run a live integration verification against Groq Cloud, please set:");
    console.warn("  export GROQ_API_KEY=gsk_your_groq_api_key_here");
    console.warn("Or add GROQ_API_KEY to your local .env file.");
    process.exit(0);
  }

  const provider = new GroqProvider();

  const testPrompt = "Respond with a short confirmation that the B.U.T.L.E.R. Alfred Groq integration is operational.";

  console.log("\n[Request] Dispatching test prompt to Groq API...");
  console.log(`[Prompt]  "${testPrompt}"\n`);

  const startTime = Date.now();

  try {
    const response = await provider.chat([
      {
        role: "user",
        content: testPrompt
      }
    ]);

    const elapsed = Date.now() - startTime;

    console.log("✔ [Response Received]");
    console.log(`  Model         : ${response.model}`);
    console.log(`  Completion ID : ${response.id}`);
    console.log(`  Latency       : ${elapsed} ms`);
    if (response.usage) {
      console.log(`  Tokens        : ${response.usage.promptTokens} prompt + ${response.usage.completionTokens} completion = ${response.usage.totalTokens} total`);
    }
    console.log("\n--- Message Content ---");
    console.log(response.content.trim());
    console.log("-----------------------\n");
    console.log("Groq API integration verified successfully!");
  } catch (error) {
    console.error("✖ [Verification Failed]");
    if (error instanceof AIProviderError) {
      console.error(`  Code        : ${error.code}`);
      console.error(`  Status      : ${error.statusCode ?? "N/A"}`);
      console.error(`  Message     : ${error.message}`);
    } else {
      console.error(`  Error       : ${(error as Error).message}`);
    }
    process.exit(1);
  }
}

runGroqVerification();
