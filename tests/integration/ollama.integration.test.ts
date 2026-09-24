import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
import { OllamaProvider } from "../../src/ai/providers/ollama/ollama-provider.js";
import { getAlfredSystemPrompt } from "../../src/ai/prompts/alfred-persona.js";
import { OFFLINE } from "./prerequisites.js";

dotenv.config();

const baseUrl = process.env.OLLAMA_BASE_URL?.trim() || "http://100.64.0.53:11434";
const model = process.env.OLLAMA_MODEL?.trim() || "gemma4:12b-mlx";

// Talks to a real Ollama server (default: the Tailscale MacBook). Never runs with
// ALFRED_OFFLINE=1; otherwise it is skipped when the server is unreachable.
describe.skipIf(OFFLINE)("Ollama API Live Integration Tests", () => {
  it(
    "should connect to live Tailscale Ollama server, verify health, and complete chat",
    async ({ skip }) => {
      const provider = new OllamaProvider({
        config: { baseUrl, defaultModel: model, timeoutMs: 60000 }
      });

      const health = await provider.checkHealth();
      if (!health.reachable) {
        skip(`Ollama server is not reachable at ${baseUrl}`);
      }

      expect(health.reachable).toBe(true);
      expect(health.modelAvailable).toBe(true);
      expect(health.status).toBe("ready");

      const response = await provider.chat([
        { role: "system", content: getAlfredSystemPrompt() },
        { role: "user", content: "Confirm in one short sentence that you are operational, Alfred." }
      ], {
        temperature: 0.6,
        maxTokens: 500
      });

      expect(response).toBeDefined();
      expect(response.content).toBeTruthy();
      expect(response.role).toBe("assistant");
      expect(response.model).toContain("gemma4");
    },
    60000
  );
});
