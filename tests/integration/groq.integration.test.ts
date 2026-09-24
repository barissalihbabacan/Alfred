import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
import { GroqProvider } from "../../src/ai/providers/groq/groq-provider.js";
import { OFFLINE } from "./prerequisites.js";

dotenv.config();

// Calls the real Groq API. Needs GROQ_API_KEY; never runs with ALFRED_OFFLINE=1.
const apiKey = process.env.GROQ_API_KEY?.trim();

describe.skipIf(OFFLINE || !apiKey)("Groq API Live Integration Tests", () => {
  it(
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
});
