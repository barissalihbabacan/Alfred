import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../../apps/web/lib/markdown.js";

/** The JavaScript of the (first) "Kopyala" button's onclick attribute. */
function onclickOf(html: string): string {
  const m = /onclick="([^"]*)"/.exec(html);
  if (!m) throw new Error("no onclick attribute in: " + html.slice(0, 200));
  return m[1];
}

/** What that button puts on the clipboard. */
function copiedText(html: string): string {
  const m = /decodeURIComponent\('([^']*)'\)/.exec(onclickOf(html));
  if (!m) throw new Error("no decodeURIComponent('…') payload");
  return decodeURIComponent(m[1]);
}

describe("renderMarkdown (apps/web/lib/markdown.ts)", () => {
  it("copies the original code, not its HTML-escaped form", () => {
    const code = `if (a < b && c > "d") { x = 'y'; }`;
    const html = renderMarkdown("```js\n" + code + "\n```");
    expect(copiedText(html)).toBe(code);
    // The code shown on the page is still escaped.
    expect(html).toContain("if (a &lt; b &amp;&amp; c &gt; &quot;d&quot;) { x = &#39;y&#39;; }");
  });

  it("keeps the onclick attribute closed and the JS string intact for hostile code", () => {
    for (const code of [`'); alert(1); ('`, `"><img src=x onerror=alert(1)>`, "\\'); alert(1); //", "a%27b", "&lt;already&gt;"]) {
      const html = renderMarkdown("```\n" + code + "\n```");
      const js = onclickOf(html);
      const payload = /decodeURIComponent\('([^']*)'\)/.exec(js)?.[1] ?? "";
      expect(payload, code).not.toMatch(/['"<>&\\]/);
      expect(copiedText(html), code).toBe(code);
    }
  });

  it("renders * bullet lists as lists, not as italics", () => {
    expect(renderMarkdown("Liste:\n\n* bir\n* iki\n* üç")).toBe("<p>Liste:</p><ul><li>bir</li><li>iki</li><li>üç</li></ul>");
    expect(renderMarkdown("* bir\n* iki")).toBe("<ul><li>bir</li><li>iki</li></ul>");
  });

  it("still renders *italic*, **bold** and ***both***, but not a spaced-out 2 * 3 * 4", () => {
    expect(renderMarkdown("bu *önemli* bir not")).toBe("<p>bu <em>önemli</em> bir not</p>");
    expect(renderMarkdown("**kalın** ve ***ikisi***")).toBe("<p><strong>kalın</strong> ve <strong><em>ikisi</em></strong></p>");
    expect(renderMarkdown("2 * 3 * 4 = 24")).toBe("<p>2 * 3 * 4 = 24</p>");
    expect(renderMarkdown("*bir\niki*")).toBe("<p>*bir<br/>iki*</p>");
  });

  it("marks the code language label as English, so CSS upper-casing gives JAVASCRIPT, not JAVASCRİPT", () => {
    expect(renderMarkdown("```javascript\nx\n```")).toContain('<span lang="en">javascript</span>');
  });

  describe("links", () => {
    const CNBC = "https://www.cnbc.com/2026/09/26/meta-microsoft-led-tech-higher-this-week-despite-soaring-bond-yields.html";
    const anchor = (href: string, label: string) =>
      `<a href="${href}" target="_blank" rel="noopener noreferrer" class="md-link">${label}</a>`;

    it("renders [label](url) as a link that opens in a new tab", () => {
      expect(renderMarkdown(`Kaynak: [cnbc.com](${CNBC})`)).toBe(`<p>Kaynak: ${anchor(CNBC, "cnbc.com")}</p>`);
    });

    it("links bare URLs, leaving surrounding punctuation and parentheses outside", () => {
      expect(renderMarkdown("Kaynak: PCMag (https://www.pcmag.com/news).")).toBe(
        `<p>Kaynak: PCMag (${anchor("https://www.pcmag.com/news", "https://www.pcmag.com/news")}).</p>`
      );
      expect(renderMarkdown("Bkz. https://example.com/a?b=1&c=2, sonra")).toBe(
        `<p>Bkz. ${anchor("https://example.com/a?b=1&amp;c=2", "https://example.com/a?b=1&amp;c=2")}, sonra</p>`
      );
      expect(renderMarkdown("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe(
        `<p>${anchor("https://en.wikipedia.org/wiki/Foo_(bar)", "https://en.wikipedia.org/wiki/Foo_(bar)")}</p>`
      );
    });

    it("keeps bold/italic out of URLs and still formats the text around them", () => {
      const html = renderMarkdown("**Önemli:** [a_b*c*](https://x.test/a_b*c*d)");
      expect(html).toBe(`<p><strong>Önemli:</strong> ${anchor("https://x.test/a_b*c*d", "a_b*c*")}</p>`);
    });

    it("never links other schemes and never lets a URL leave its href", () => {
      expect(renderMarkdown("[tıkla](javascript:alert(1))")).not.toContain("<a ");
      expect(renderMarkdown("data:text/html,<b>x</b>")).not.toContain("<a ");
      const hostile = renderMarkdown('[x](https://a.test/"onmouseover=alert(1))');
      const attrs = hostile.match(/<a ([^>]*)>/)?.[1] ?? "";
      expect(attrs).toMatch(/^href="[^"]*" target="_blank" rel="noopener noreferrer" class="md-link"$/);
      expect(attrs).not.toMatch(/"\s*onmouseover/);
      const quoted = renderMarkdown('"https://a.test/x" dedi');
      expect(quoted).toBe(`<p>&quot;${anchor("https://a.test/x", "https://a.test/x")}&quot; dedi</p>`);
    });

    it("does not link URLs inside code", () => {
      expect(renderMarkdown("`https://a.test/x`")).toBe('<p><code class="inline-code">https://a.test/x</code></p>');
      expect(renderMarkdown("```\ncurl https://a.test/x\n```")).not.toContain("<a ");
    });
  });

  it("escapes HTML in ordinary text", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });
});
