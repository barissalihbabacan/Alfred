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

    it("renders markdown links with parentheses in the URL, nested brackets, bold labels and backticks", () => {
      const wiki = "https://tr.wikipedia.org/wiki/Be%C5%9Fikta%C5%9F_(futbol_tak%C4%B1m%C4%B1)";
      expect(renderMarkdown(`Kaynak: [tr.wikipedia.org](${wiki})`)).toBe(
        `<p>Kaynak: ${anchor(wiki, "tr.wikipedia.org")}</p>`
      );
      expect(renderMarkdown("[[1] Haber](https://a.test/1)")).toBe(
        `<p>${anchor("https://a.test/1", "[1] Haber")}</p>`
      );
      expect(renderMarkdown("[**aspor.com.tr**](https://www.aspor.com.tr/x)")).toBe(
        `<p>${anchor("https://www.aspor.com.tr/x", "<strong>aspor.com.tr</strong>")}</p>`
      );
      expect(renderMarkdown("`[aspor.com.tr](https://www.aspor.com.tr/x)`")).toBe(
        `<p>${anchor("https://www.aspor.com.tr/x", "aspor.com.tr")}</p>`
      );
    });

    it("auto-links unlinked citations in 【domain】, (domain, date) and Kaynaklar: lines", () => {
      expect(renderMarkdown("Faiz sabit kaldı【bloomberght.com】.")).toBe(
        `<p>Faiz sabit kaldı(${anchor("https://bloomberght.com", "bloomberght.com")}).</p>`
      );
      expect(renderMarkdown("Haber özeti (aspor.com.tr, 26 Eylül 2026).")).toBe(
        `<p>Haber özeti (${anchor("https://aspor.com.tr", "aspor.com.tr")}, 26 Eylül 2026).</p>`
      );
      expect(renderMarkdown("Kaynaklar: aspor.com.tr, trtspor.com.tr")).toBe(
        `<p>Kaynaklar: ${anchor("https://aspor.com.tr", "aspor.com.tr")}, ${anchor("https://trtspor.com.tr", "trtspor.com.tr")}</p>`
      );
    });
  });

  it("keeps loose ordered/unordered lists together, supports sub-bullets, headings and tables", () => {
    expect(renderMarkdown("1. Birinci\n\n2. İkinci\n\n3. Üçüncü")).toBe(
      "<ol><li>Birinci</li><li>İkinci</li><li>Üçüncü</li></ol>"
    );
    expect(renderMarkdown("1. Haber\n   - Kaynak: [a](https://a.test)")).toBe(
      '<ol><li>Haber<br/>Kaynak: <a href="https://a.test" target="_blank" rel="noopener noreferrer" class="md-link">a</a></li></ol>'
    );
    expect(renderMarkdown("### Kaynaklar\n- [a](https://a.test)")).toBe(
      '<p><strong>Kaynaklar</strong></p><ul><li><a href="https://a.test" target="_blank" rel="noopener noreferrer" class="md-link">a</a></li></ul>'
    );
    expect(renderMarkdown("| Konu | Kaynak |\n| --- | --- |\n| Faiz | [b](https://b.test) |")).toBe(
      '<div class="md-table-wrap"><table class="md-table"><thead><tr><th>Konu</th><th>Kaynak</th></tr></thead><tbody><tr><td>Faiz</td><td><a href="https://b.test" target="_blank" rel="noopener noreferrer" class="md-link">b</a></td></tr></tbody></table></div>'
    );
  });

  it("escapes HTML in ordinary text", () => {
    expect(renderMarkdown("<script>alert(1)</script>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  });
});
