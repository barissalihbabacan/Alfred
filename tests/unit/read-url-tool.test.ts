import { describe, it, expect, vi } from "vitest";
import {
  parseReadUrl,
  isPrivateAddress,
  decodeHtmlEntities,
  htmlToText,
  runReadUrlTool,
  createTurnReadUrl,
  READ_URL_TOOL_DEFINITION
} from "../../src/ai/tools/web/read-url.js";

describe("read_url tool definition", () => {
  it("has the expected function tool shape", () => {
    expect(READ_URL_TOOL_DEFINITION.type).toBe("function");
    expect(READ_URL_TOOL_DEFINITION.function.name).toBe("read_url");
    expect(READ_URL_TOOL_DEFINITION.function.parameters.required).toContain("url");
  });
});

describe("parseReadUrl", () => {
  it("accepts valid http and https URLs", () => {
    const u1 = parseReadUrl("https://example.com/article?id=123");
    expect("error" in u1).toBe(false);
    if (!("error" in u1)) {
      expect(u1.origin).toBe("https://example.com");
      expect(u1.pathname).toBe("/article");
    }

    const u2 = parseReadUrl({ url: "http://example.org/blog" });
    expect("error" in u2).toBe(false);
  });

  it("adds https: if scheme is omitted", () => {
    const u = parseReadUrl("example.com/test");
    expect("error" in u).toBe(false);
    if (!("error" in u)) {
      expect(u.protocol).toBe("https:");
      expect(u.hostname).toBe("example.com");
    }
  });

  it("rejects invalid, credential-bearing or non-standard port URLs", () => {
    expect(parseReadUrl("")).toHaveProperty("error");
    expect(parseReadUrl("ftp://example.com")).toHaveProperty("error");
    expect(parseReadUrl("https://user:pass@example.com")).toHaveProperty("error");
    expect(parseReadUrl("https://example.com:8080/")).toHaveProperty("error");
    expect(parseReadUrl("http://localhost:3000/")).toHaveProperty("error");
    expect(parseReadUrl("http://metadata.google.internal/")).toHaveProperty("error");
  });
});

describe("isPrivateAddress (SSRF protection)", () => {
  it("detects loopback and private IPv4 ranges", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.0.0.1")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true); // Cloud metadata
    expect(isPrivateAddress("100.64.0.1")).toBe(true); // CGNAT
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
  });

  it("allows public IPv4 addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("140.82.121.4")).toBe(false); // GitHub
    expect(isPrivateAddress("151.101.1.69")).toBe(false);
  });

  it("detects IPv6 loopback, link-local, and unique-local", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("::")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
    expect(isPrivateAddress("fc00::1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
  });
});

describe("decodeHtmlEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeHtmlEntities("&amp; &lt; &gt; &quot; &#39; &copy;")).toBe("& < > \" ' ©");
    expect(decodeHtmlEntities("&#x2F; &#47;")).toBe("/ /");
  });
});

describe("htmlToText", () => {
  it("extracts page title and strips non-content tags", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Page Title</title>
          <style>body { color: red; }</style>
          <script>console.log("secret");</script>
        </head>
        <body>
          <nav>Home | About</nav>
          <main>
            <h1>Main Heading</h1>
            <p>This is a paragraph with a <a href="https://example.com">link</a>.</p>
            <ul>
              <li>Item 1</li>
              <li>Item 2</li>
            </ul>
          </main>
          <footer>Copyright 2026</footer>
        </body>
      </html>
    `;
    const res = htmlToText(html);
    expect(res.title).toBe("Test Page Title");
    expect(res.text).toContain("Main Heading");
    expect(res.text).toContain("This is a paragraph with a link.");
    expect(res.text).toContain("- Item 1");
    expect(res.text).not.toContain("console.log");
    expect(res.text).not.toContain("body { color: red; }");
  });
});

describe("runReadUrlTool", () => {
  it("fetches page and returns formatted content", async () => {
    const fakeHtml = "<html><head><title>My Article</title></head><body><p>Article body content here.</p></body></html>";
    const mockFetch = vi.fn().mockResolvedValue(new Response(fakeHtml, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    }));
    const mockLookup = vi.fn().mockResolvedValue(["93.184.216.34"]); // example.com public IP

    const res = await runReadUrlTool({ url: "https://example.com/test" }, {
      fetch: mockFetch,
      lookup: mockLookup
    });

    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.title).toBe("My Article");
      expect(res.content).toBe("Article body content here.");
      expect(res.source).toBe("example.com");
      expect(res.cite).toBe("[example.com](https://example.com/test)");
    }
  });

  it("blocks private IPs returned by DNS lookup", async () => {
    const mockFetch = vi.fn();
    const mockLookup = vi.fn().mockResolvedValue(["127.0.0.1"]);

    const res = await runReadUrlTool({ url: "https://sneaky-domain.com" }, {
      fetch: mockFetch,
      lookup: mockLookup
    });

    expect(res).toHaveProperty("error");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("createTurnReadUrl", () => {
  it("caches duplicate requests and enforces turn limits", async () => {
    const fakeHtml = "<html><head><title>Page</title></head><body><p>Text</p></body></html>";
    const mockFetch = vi.fn().mockResolvedValue(new Response(fakeHtml, {
      status: 200,
      headers: { "Content-Type": "text/html" }
    }));
    const mockLookup = vi.fn().mockResolvedValue(["93.184.216.34"]);

    const turnReader = createTurnReadUrl({ fetch: mockFetch, lookup: mockLookup }, 1);

    const r1 = await turnReader({ url: "https://example.com/page1" });
    expect("error" in r1).toBe(false);

    // Same URL should return cached without fetch
    const r2 = await turnReader({ url: "https://example.com/page1" });
    expect(r2).toEqual(r1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second different URL should hit the limit (maxReads = 1)
    const r3 = await turnReader({ url: "https://example.com/page2" });
    expect(r3).toHaveProperty("error");
    expect((r3 as { error: string }).error).toContain("page limit");
  });
});
