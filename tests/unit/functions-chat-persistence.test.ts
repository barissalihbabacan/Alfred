import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// The /chat handler in functions/api.ts needs Firebase Admin, so it is not
// run here; these checks pin the two ordering rules of its message writes.
const source = readFileSync(new URL("../../functions/api.ts", import.meta.url), "utf8");

function body(name: string): string {
  const start = source.indexOf(`const ${name} = async`);
  expect(start, name).toBeGreaterThan(-1);
  const end = source.indexOf("\n    };\n", start);
  return source.slice(start, end);
}

describe("functions/api.ts assistant message persistence", () => {
  it("writes every assistant message in a transaction that takes the next sequence and raises messageCount", () => {
    const persist = body("persistAssistantMessage");
    expect(persist).toContain("db.runTransaction");
    expect(persist).toContain("const asstSeq = (cData.messageCount || userSeq) + 1;");
    expect(persist).toMatch(/messageCount: asstSeq/);
    expect(persist).toMatch(/status,\n/);
  });

  it("never writes an interrupted reply outside it (it used to reuse the next user message's sequence)", () => {
    expect(source).not.toContain("sequence: userSeq + 1");
    expect(source).toContain('await persistAssistantMessage(cleanInterrupted, "interrupted");');
    // Every message sequence written is the user message's (in its
    // transaction) or asstSeq (in persistAssistantMessage's).
    expect(source.match(/sequence: [^,\n]+/g)).toEqual(["sequence: userSeq", "sequence: asstSeq"]);
  });

  it("persists a completed reply before sending done, and runs memory extraction after it", () => {
    const persistAt = source.indexOf('await persistAssistantMessage(cleanContent, "completed");');
    const doneAt = source.indexOf('sendEvent({ type: "done" });');
    const extractAt = source.indexOf("await finalizeTurn(cleanContent, asstMsgDocId);");
    expect(persistAt).toBeGreaterThan(-1);
    expect(doneAt).toBeGreaterThan(persistAt);
    expect(extractAt).toBeGreaterThan(doneAt);
    expect(source.match(/sendEvent\(\{ type: "done" \}\)/g)).toHaveLength(1);
  });
});
