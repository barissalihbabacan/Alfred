import { describe, it, expect } from "vitest";

describe("Production Chat SSE Regression Tests", () => {
  it(
    "should process exact UI request with start, thinking, content chunks, and done without error fallback copy",
    async () => {
      const url = "https://butler-alfred.web.app/api/chat";
      const payload = {
        message: "What do you think about Rust software language?",
        history: [],
        stream: true
      };

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream"
        },
        body: JSON.stringify(payload)
      });

      expect(res.ok).toBe(true);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const text = await res.text();
      const lines = text.split("\n");
      const events: Array<{ type?: string; text?: string }> = [];
      let accumulatedContent = "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const dataStr = trimmed.replace(/^data:\s*/, "");
        try {
          const parsed = JSON.parse(dataStr);
          events.push(parsed);
          if (parsed.type === "chunk" && parsed.text) {
            accumulatedContent += parsed.text;
          }
        } catch {}
      }

      // 1. Contract checks
      const startEvent = events.find((e) => e.type === "start");
      expect(startEvent).toBeDefined();

      const chunkEvents = events.filter((e) => e.type === "chunk");
      expect(chunkEvents.length).toBeGreaterThan(0);

      const doneEvent = events.find((e) => e.type === "done");
      expect(doneEvent).toBeDefined();

      // 2. Regression assertions: Must NOT contain fallback copy or internal network details
      expect(accumulatedContent).not.toContain("100.64.0.53");
      expect(accumulatedContent).not.toContain("To enable live reasoning");
      expect(accumulatedContent).not.toContain("please ensure the Ollama server is running");
      expect(accumulatedContent).not.toContain("Indeed, sir. You mentioned:");

      // 3. Genuine model output verified
      expect(accumulatedContent.length).toBeGreaterThan(50);
    },
    90000
  );

  it("should never transform infrastructure or provider errors into regular assistant dialogue", async () => {
    const url = "https://butler-alfred.web.app/api/chat";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "" })
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.text).toBeUndefined();
  });
});
