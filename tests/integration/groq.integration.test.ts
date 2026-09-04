import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
import { GroqProvider } from "../../src/ai/providers/groq/groq-provider.js";

dotenv.config();

const apiKey = process.env.GROQ_API_KEY?.trim();
const runLiveTests = Boolean(apiKey);

describe("Groq API Live Integration Tests", () => {
  const liveTest = runLiveTests ? it : it.skip;

  liveTest(
    "should successfully communicate with Groq Cloud API and receive confirmation",
    async () => {
      const provider = new GroqProvider({ apiKey });

      const testPrompt =
        "Respond with a short confirmation that the B.U.T.L.E.R. Alfred Groq integration is operational.";

      const response = await provider.chat([
        {
          role: "user",
          content: testPrompt
        }
      ]);

      expect(response).toBeDefined();
      expect(response.id).toBeTruthy();
      expect(response.content).toBeTruthy();
      expect(response.content.length).toBeGreaterThan(5);
      expect(response.model).toBeTruthy();
    },
    30000
  );

  if (!runLiveTests) {
    it("skips live Groq tests when GROQ_API_KEY is not set", () => {
      expect(runLiveTests).toBe(false);
    });
  }
});
