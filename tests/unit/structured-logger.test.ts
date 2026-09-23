import { describe, it, expect } from "vitest";
import {
  StructuredLogger,
  LOG_EVENTS,
  type LogSeverity
} from "../../src/core/logging/index.js";

function capture(minSeverity?: LogSeverity) {
  const lines: { line: string; severity: LogSeverity }[] = [];
  const logger = new StructuredLogger({
    minSeverity,
    sink: (line, severity) => lines.push({ line, severity }),
    now: () => new Date("2026-09-23T10:00:00.000Z")
  });
  const parsed = () => lines.map((l) => JSON.parse(l.line));
  return { logger, lines, parsed };
}

describe("StructuredLogger", () => {
  it("writes a single-line JSON entry with severity, message and timestamp", () => {
    const { logger, lines, parsed } = capture();
    logger.info("hello", { a: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0].line).not.toContain("\n");
    expect(parsed()[0]).toEqual({
      a: 1,
      severity: "INFO",
      message: "hello",
      timestamp: "2026-09-23T10:00:00.000Z"
    });
  });

  it("maps helpers to Cloud Logging severities", () => {
    const { logger, parsed } = capture("DEBUG");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(parsed().map((e) => e.severity)).toEqual(["DEBUG", "INFO", "WARNING", "ERROR"]);
  });

  it("drops entries below the minimum severity", () => {
    const { logger, parsed } = capture("WARNING");
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    expect(parsed().map((e) => e.message)).toEqual(["w"]);
  });

  it("emits operational events with a stable event field that fields cannot override", () => {
    const { logger, parsed } = capture();
    logger.event("llm_request", "LLM request ok", {
      event: "spoofed",
      provider: "groq",
      latency_ms: 812,
      prompt_tokens: 73,
      completion_tokens: 20,
      total_tokens: 93
    });
    const [entry] = parsed();
    expect(entry.event).toBe("llm_request");
    expect(entry.prompt_tokens).toBe(73);
    expect(entry.total_tokens).toBe(93);
  });

  it("shares the production event vocabulary", () => {
    expect([...LOG_EVENTS]).toEqual(["llm_request", "tool_call", "memory_retrieval", "memory_extraction"]);
  });

  it("redacts secret-looking fields but keeps token counts", () => {
    const { logger, lines, parsed } = capture();
    logger.info("x", {
      apiKey: "gsk_live_secret",
      idToken: "eyJhbGciOi",
      authorization: "Bearer abc",
      completion_tokens: 5
    });
    const [entry] = parsed();
    expect(entry.apiKey).toBe("[REDACTED]");
    expect(entry.idToken).toBe("[REDACTED]");
    expect(entry.authorization).toBe("[REDACTED]");
    expect(entry.completion_tokens).toBe(5);
    expect(lines[0].line).not.toContain("gsk_live_secret");
  });

  it("serialises errors as their message and omits undefined fields", () => {
    const { logger, parsed } = capture();
    logger.error("failed", { error: new Error("boom"), command: undefined });
    const [entry] = parsed();
    expect(entry.error).toBe("boom");
    expect("command" in entry).toBe(false);
  });

  it("survives circular fields", () => {
    const { logger, parsed } = capture();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    logger.event("tool_call", "Tool x ok", { data: circular });
    expect(parsed()[0]).toMatchObject({ event: "tool_call", message: "Tool x ok" });
  });

  it("child loggers add base fields and keep the severity threshold", () => {
    const { logger, parsed } = capture("WARNING");
    const child = logger.child({ service: "alfred-core" });
    child.info("dropped");
    child.warn("kept");
    expect(parsed()).toEqual([
      expect.objectContaining({ service: "alfred-core", message: "kept", severity: "WARNING" })
    ]);
  });
});
