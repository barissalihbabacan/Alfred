import { describe, it, expect, vi } from "vitest";
import {
  normalizeGitHubRepo,
  parseGitHubArgs,
  buildGitHubUrl,
  shapeGitHubResponse,
  runGitHubTool,
  createTurnGitHub,
  GITHUB_TOOL_DEFINITION
} from "../../src/ai/tools/github/github.js";

describe("github tool definition", () => {
  it("has the expected function tool shape", () => {
    expect(GITHUB_TOOL_DEFINITION.type).toBe("function");
    expect(GITHUB_TOOL_DEFINITION.function.name).toBe("github");
    expect(GITHUB_TOOL_DEFINITION.function.parameters.required).toContain("action");
  });
});

describe("normalizeGitHubRepo", () => {
  it("normalizes various repo formats to owner/repo", () => {
    expect(normalizeGitHubRepo("facebook/react")).toBe("facebook/react");
    expect(normalizeGitHubRepo("https://github.com/facebook/react")).toBe("facebook/react");
    expect(normalizeGitHubRepo("https://github.com/facebook/react.git")).toBe("facebook/react");
    expect(normalizeGitHubRepo("https://github.com/facebook/react/issues/123")).toBe("facebook/react");
    expect(normalizeGitHubRepo("git@github.com:facebook/react.git")).toBe("facebook/react");
  });

  it("returns null for invalid inputs", () => {
    expect(normalizeGitHubRepo("")).toBeNull();
    expect(normalizeGitHubRepo("invalid")).toBeNull();
    expect(normalizeGitHubRepo("../something")).toBeNull();
  });
});

describe("parseGitHubArgs", () => {
  it("parses valid action arguments and falls back to defaultRepo", () => {
    const res = parseGitHubArgs({ action: "issues" }, "baris/project");
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.action).toBe("issues");
      expect(res.repo).toBe("baris/project");
      expect(res.state).toBe("open");
    }
  });

  it("requires positive number for action issue", () => {
    expect(parseGitHubArgs({ action: "issue", repo: "a/b" })).toHaveProperty("error");
    const valid = parseGitHubArgs({ action: "issue", repo: "a/b", number: 42 });
    expect("error" in valid).toBe(false);
  });

  it("requires path for action file", () => {
    expect(parseGitHubArgs({ action: "file", repo: "a/b" })).toHaveProperty("error");
    const valid = parseGitHubArgs({ action: "file", repo: "a/b", path: "src/index.ts" });
    expect("error" in valid).toBe(false);
  });
});

describe("buildGitHubUrl", () => {
  it("constructs correct REST endpoints", () => {
    expect(buildGitHubUrl({ action: "repo", repo: "owner/repo", state: "open", limit: 10 }))
      .toBe("https://api.github.com/repos/owner/repo");

    expect(buildGitHubUrl({ action: "issue", repo: "owner/repo", number: 5, state: "open", limit: 10 }))
      .toBe("https://api.github.com/repos/owner/repo/issues/5");

    expect(buildGitHubUrl({ action: "file", repo: "owner/repo", path: "README.md", state: "open", limit: 10 }))
      .toBe("https://api.github.com/repos/owner/repo/contents/README.md");
  });
});

describe("shapeGitHubResponse", () => {
  it("shapes file content decoding base64 correctly", () => {
    const contentStr = "console.log('hello github');";
    const base64 = btoa(contentStr);
    const shaped = shapeGitHubResponse(
      { action: "file", repo: "owner/repo", path: "test.js", state: "open", limit: 10 },
      { type: "file", encoding: "base64", content: base64, size: 100, html_url: "https://github.com/owner/repo/blob/main/test.js" }
    );
    expect("error" in shaped).toBe(false);
    expect(shaped.content).toBe(contentStr);
    expect(shaped.repo).toBe("owner/repo");
  });
});

describe("runGitHubTool", () => {
  it("executes read action and shapes output", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      name: "my-repo",
      description: "My cool repo",
      stargazers_count: 42,
      open_issues_count: 3
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    const res = await runGitHubTool({ action: "repo", repo: "baris/test" }, {
      fetch: mockFetch,
      token: "dummy-token"
    });

    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.repo).toBe("baris/test");
      expect(res.description).toBe("My cool repo");
      expect(res.stars).toBe(42);
    }
  });
});

describe("createTurnGitHub", () => {
  it("caches duplicate calls within turn and respects limits", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ description: "cached" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));

    const turnGitHub = createTurnGitHub({ fetch: mockFetch, defaultRepo: "baris/repo" }, 1);

    const r1 = await turnGitHub({ action: "repo" });
    expect("error" in r1).toBe(false);

    const r2 = await turnGitHub({ action: "repo" });
    expect(r2).toEqual(r1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const r3 = await turnGitHub({ action: "issues" });
    expect(r3).toHaveProperty("error");
  });
});
