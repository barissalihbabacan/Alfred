import { describe, it, expect } from "vitest";
import { toolBadgeLabel, toolStatusText } from "../../apps/web/lib/tools.js";

describe("toolStatusText (apps/web/lib/tools.ts)", () => {
  it("names a web search from the pre-run toolCalls list or a per-call event", () => {
    expect(toolStatusText({ toolCalls: [{ id: "c1", name: "web_search", arguments: "{}" }] }, "tr")).toBe("Web'de aranıyor…");
    expect(toolStatusText({ toolCalls: [{ name: "get_current_time" }, { name: "web_search" }] }, "tr")).toBe("Web'de aranıyor…");
    expect(toolStatusText({ tool: "web_search" }, "tr")).toBe("Web'de aranıyor…");
  });

  it("speaks the UI language", () => {
    expect(toolStatusText({ tool: "web_search" }, "en")).toBe("Searching the web…");
    expect(toolStatusText({ tool: "gmail" }, "en")).toBe("Scanning email…");
    expect(toolStatusText({ tool: "constructor" }, "en")).toBeUndefined();
  });

  it("labels tool badges, keeping product names and unknown tools as they are", () => {
    expect(toolBadgeLabel("web_search", "en")).toBe("Web Search");
    expect(toolBadgeLabel("web_search", "tr")).toBe("Web Araması");
    expect(toolBadgeLabel("github", "tr")).toBe("GitHub");
    expect(toolBadgeLabel("some_new_tool", "en")).toBe("some_new_tool");
    expect(toolBadgeLabel("toString", "en")).toBe("toString");
  });

  it("stays silent for quick or unknown tools and odd shapes", () => {
    expect(toolStatusText({ toolCalls: [{ name: "get_current_time" }] }, "tr")).toBeUndefined();
    expect(toolStatusText({ tool: "get_current_time" }, "tr")).toBeUndefined();
    expect(toolStatusText({ toolCalls: [null, 5, "web_search"] }, "tr")).toBeUndefined();
    expect(toolStatusText({}, "tr")).toBeUndefined();
  });
});
