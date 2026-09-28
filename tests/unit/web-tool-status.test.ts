import { describe, it, expect } from "vitest";
import { toolStatusText } from "../../apps/web/lib/tools.js";

describe("toolStatusText (apps/web/lib/tools.ts)", () => {
  it("names a web search from the pre-run toolCalls list or a per-call event", () => {
    expect(toolStatusText({ toolCalls: [{ id: "c1", name: "web_search", arguments: "{}" }] })).toBe("Web'de aranıyor…");
    expect(toolStatusText({ toolCalls: [{ name: "get_current_time" }, { name: "web_search" }] })).toBe("Web'de aranıyor…");
    expect(toolStatusText({ tool: "web_search" })).toBe("Web'de aranıyor…");
  });

  it("stays silent for quick or unknown tools and odd shapes", () => {
    expect(toolStatusText({ toolCalls: [{ name: "get_current_time" }] })).toBeUndefined();
    expect(toolStatusText({ tool: "get_current_time" })).toBeUndefined();
    expect(toolStatusText({ toolCalls: [null, 5, "web_search"] })).toBeUndefined();
    expect(toolStatusText({})).toBeUndefined();
  });
});
