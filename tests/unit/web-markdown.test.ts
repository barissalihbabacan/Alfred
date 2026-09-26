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

  it("escapes HTML in ordinary text", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });
});
