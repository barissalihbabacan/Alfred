/**
 * Markdown -> HTML for assistant replies (rendered with dangerouslySetInnerHTML
 * in VoiceChatPlayground). The text is HTML-escaped first; every rule below
 * works on escaped text.
 */

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Undoes escapeHtml (for text that leaves the HTML, e.g. the clipboard). */
function unescapeHtml(str: string): string {
  return str
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

/**
 * The code a "Kopyala" button copies, for `decodeURIComponent('…')` inside a
 * double-quoted onclick attribute: the original (unescaped) code, URI-encoded,
 * with "'" encoded too because encodeURIComponent leaves it as is and it would
 * end the JavaScript string.
 */
function copyPayload(escapedCode: string): string {
  return encodeURIComponent(unescapeHtml(escapedCode)).replace(/'/g, "%27");
}

/**
 * A bare http(s) URL in HTML-escaped text: it ends at whitespace or at an
 * escaped quote / angle bracket (&quot; &#39; &lt; &gt;).
 */
const BARE_URL = /https?:\/\/(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s])+/g;

/** Common TLDs for auto-linking bare cited domains in `(domain.tld)` or `Kaynak: domain.tld`. */
const KNOWN_DOMAIN_TLD =
  "(?:[a-zA-Z0-9-]+\\.)+(?:com\\.tr|gov\\.tr|org\\.tr|edu\\.tr|net\\.tr|bel\\.tr|k12\\.tr|com|org|net|io|co\\.uk|org\\.uk|gov\\.uk|de|fr|eu|info|tv|me|ai|gg|dev|app|news)";

export interface WebSearchCitationSource {
  source: string;
  url: string;
  cite?: string;
  title?: string;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hostKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function citeMarkdownLink(source: string, href: string): string {
  return `[${source}](${href.replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
}

/**
 * Turns unlinked source mentions in `text` into markdown links using the
 * `web_search` results of the turn (same contract as `linkWebSearchCitations`
 * in `src/ai/tools/web/web-search.ts`, kept local so `apps/web` stays
 * self-contained).
 */
export function linkCitationsInText(
  text: string,
  results: readonly WebSearchCitationSource[] | null | undefined
): string {
  if (!text || !results || results.length === 0) return text;

  const bySource = new Map<string, { source: string; url: string; cite: string }>();
  for (const r of results) {
    if (!r || typeof r.source !== "string" || typeof r.url !== "string") continue;
    const key = hostKey(r.source);
    if (key && !bySource.has(key)) {
      bySource.set(key, {
        source: r.source,
        url: r.url,
        cite: r.cite || citeMarkdownLink(r.source, r.url)
      });
    }
  }
  if (bySource.size === 0) return text;

  let out = text;
  out = out.replace(/`(\[[^\]\n]+\]\((?:https?:\/\/|www\.)[^\s`]+\))`/g, "$1");
  out = out.replace(/`((?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)`/g, (full, domain: string) => {
    const item = bySource.get(hostKey(domain));
    return item ? item.cite : full;
  });

  const protectedSpans: string[] = [];
  const protect = (span: string): string => {
    const idx = protectedSpans.length;
    protectedSpans.push(span);
    return `§§WSCITE${idx}§§`;
  };

  out = out.replace(/```[\s\S]*?```/g, (m) => protect(m));
  out = out.replace(/`[^`\n]+`/g, (m) => protect(m));

  out = out.replace(
    /\[((?:[^[\]\n]|\[[^\]\n]*\])+)\][ \t]*\(((?:[^\s()]|\([^\s()]*\))+)\)/g,
    (full, label: string, rawTarget: string) => {
      const target = rawTarget.replace(/^<|>$/g, "").trim();
      const targetHost = hostKey(target);
      const isRootOnly = /^(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+\/?$/i.test(target);
      const matched = bySource.get(targetHost) ?? bySource.get(hostKey(label));
      if (isRootOnly && matched) {
        return protect(citeMarkdownLink(label.trim(), matched.url));
      }
      if (/^(?:https?:\/\/|www\.)/i.test(target)) {
        const href = /^www\./i.test(target) ? `https://${target}` : target;
        return protect(citeMarkdownLink(label.trim(), href));
      }
      return full;
    }
  );

  out = out.replace(/https?:\/\/[^\s)<>\]"']+/g, (m) => protect(m));

  out = out.replace(/【([^】\n]+)】/g, (full, inner: string) => {
    const trimmed = inner.trim();
    if (/^§§WSCITE\d+§§$/.test(trimmed)) return `(${trimmed})`;
    const matchedCites: string[] = [];
    for (const [src, item] of bySource.entries()) {
      const re = new RegExp(`(?:^|[^a-zA-Z0-9-])(?:www\\.)?${escapeRegExp(src)}(?=$|[^a-zA-Z0-9-])`, "i");
      if (re.test(trimmed)) matchedCites.push(item.cite);
    }
    if (matchedCites.length > 0) return protect(`(${matchedCites.join(", ")})`);
    const numMatch = /^(?:ref_)?(\d+)(?:[†:][^\]]*)?$/i.exec(trimmed);
    if (numMatch) {
      const rawIdx = Number(numMatch[1]);
      const item = (rawIdx >= 1 && rawIdx <= results.length ? results[rawIdx - 1] : undefined) ?? results[rawIdx];
      if (item) {
        const cite = bySource.get(hostKey(item.source))?.cite ?? citeMarkdownLink(item.source, item.url);
        return protect(`(${cite})`);
      }
    }
    return full;
  });

  for (const [src, item] of bySource.entries()) {
    const bracketRe = new RegExp(`\\[\\s*(?:www\\.)?${escapeRegExp(src)}\\s*\\](?!\\s*\\()`, "gi");
    out = out.replace(bracketRe, () => protect(item.cite));
  }

  const sourcesLongestFirst = [...bySource.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [src, item] of sourcesLongestFirst) {
    const bareRe = new RegExp(
      `(^|[\\s([{"'«„,;:\u00a0\u202f])(?:www\\.)?${escapeRegExp(src)}(?=$|[\\s)\\]}"'»“.,;:!?\u00a0\u202f]|['’]\\w)`,
      "gi"
    );
    out = out.replace(bareRe, (_m, prefix: string) => `${prefix}${protect(item.cite)}`);
  }

  out = out.replace(/§§WSCITE(\d+)§§/g, (_m, idx: string) => protectedSpans[Number(idx)] ?? "");
  return out;
}

/** Punctuation after a URL ("see https://x.com/a." or "(https://x.com)") is not part of it. */
function splitTrailing(match: string): { url: string; trailing: string } {
  let url = match;
  let trailing = "";
  for (;;) {
    const last = url.slice(-1);
    if (/[.,;:!?]/.test(last)) {
      trailing = last + trailing;
      url = url.slice(0, -1);
    } else if (last === ")" && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
      trailing = last + trailing;
      url = url.slice(0, -1);
    } else {
      return { url, trailing };
    }
  }
}

function formatLinkLabel(label: string): string {
  let formatted = label.trim();
  formatted = formatted.replace(/\*\*\*([^*]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  formatted = formatted.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  formatted = formatted.replace(/^\*(?!\s)([^*\n]+?)(?<!\s)\*$/, "<em>$1</em>");
  return formatted;
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  const cells = trimmed.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  return cells.length >= 2 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

function parseTableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

function renderTableBlock(lines: string[]): string {
  const headerCells = parseTableCells(lines[0] ?? "");
  const bodyRows = lines.slice(2).filter((l) => l.trim().includes("|"));
  const thead = `<thead><tr>${headerCells.map((c) => `<th>${c}</th>`).join("")}</tr></thead>`;
  const tbody = bodyRows.length > 0
    ? `<tbody>${bodyRows.map((row) => `<tr>${parseTableCells(row).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>`
    : "";
  return `<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`;
}

export function renderMarkdown(text: string, sources?: readonly WebSearchCitationSource[] | null): string {
  if (!text) return "";

  // Completely remove <think>...</think> or unclosed <think>... from display
  let cleanText = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
  if (!cleanText) {
    return "";
  }

  if (sources && sources.length > 0) {
    cleanText = linkCitationsInText(cleanText, sources);
  }

  // Unwrap backticked markdown links (`[site](https://...)`) so they render as clickable links.
  cleanText = cleanText.replace(/`(\[(?:[^[\]\n]|\[[^\]\n]*\])+\][ \t]*\((?:https?:\/\/|www\.)[^\s`]+\))`/g, "$1");
  // Convert OpenAI-style `【[label](url)】` or `【domain.tld】` brackets into standard markdown links.
  cleanText = cleanText.replace(/【\s*(\[(?:[^[\]\n]|\[[^\]\n]*\])+\]\([^\n)]+\))\s*】/g, "($1)");
  cleanText = cleanText.replace(
    new RegExp(`【\\s*(?:\\d+[†:])?(?:www\\.)?(${KNOWN_DOMAIN_TLD})\\s*】`, "gi"),
    (_m, domain: string) => `([${domain}](https://${domain}))`
  );

  let html = escapeHtml(cleanText);

  // Multi-line code blocks: ```lang ... ```
  const codeBlocks: string[] = [];
  html = html.replace(/```(?:([a-zA-Z0-9_-]+)\n)?([\s\S]*?)```/g, (_m, lang, code) => {
    const idx = codeBlocks.length;
    const cleanCode = code.replace(/^\n+|\n+$/g, "");
    const language = lang || "code";
    codeBlocks.push(`
      <div class="code-container">
        <div class="code-header">
          <span lang="en">${language}</span>
          <button class="copy-code-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${copyPayload(cleanCode)}')).then(()=>this.innerHTML='<span style=\\'color:#10b981;\\'>Kopyalandı</span>')"><svg width='13' height='13' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' style='display:inline-block;margin-right:4px;'><rect x='9' y='9' width='13' height='13' rx='2' ry='2'/><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/></svg>Kopyala</button>
        </div>
        <pre class="code-content"><code>${cleanCode}</code></pre>
      </div>
    `);
    return `§§CODEBLOCK${idx}§§`;
  });

  // Inline code: `code`
  const inlineCodes: string[] = [];
  html = html.replace(/`([^`\n]+)`/g, (_m, c) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code class="inline-code">${c}</code>`);
    return `§§INLINECODE${idx}§§`;
  });

  // Links: [label](https://…) and bare http(s) URLs. Protected like code, so
  // bold/italic rules never touch a URL. Only http(s) (or www., upgraded to
  // https://) becomes a link (no javascript: or data:), and the text is
  // already HTML-escaped, so the URL cannot leave the href attribute.
  const links: string[] = [];
  const protectLink = (label: string, rawUrl: string) => {
    const idx = links.length;
    const url = /^www\./i.test(rawUrl) ? `https://${rawUrl}` : rawUrl;
    links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer" class="md-link">${formatLinkLabel(label)}</a>`);
    return `§§LINK${idx}§§`;
  };
  // [label](<https://...>)
  html = html.replace(
    /\[((?:[^[\]\n]|\[[^\]\n]*\])+)\][ \t\u00a0\u202f]*\(&lt;((?:https?:\/\/|www\.)(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s])+)&gt;\)/g,
    (_m, label: string, url: string) => protectLink(label, url)
  );
  // [label](https://...) with support for balanced parentheses in the URL and nested brackets in the label.
  html = html.replace(
    /\[((?:[^[\]\n]|\[[^\]\n]*\])+)\][ \t\u00a0\u202f]*\(((?:https?:\/\/|www\.)(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s()]|\((?:(?!&quot;|&#39;|&lt;|&gt;)[^\s()])*\))+)\)/g,
    (_m, label: string, url: string) => protectLink(label, url)
  );
  // Unlinked domain in parentheses: `(aspor.com.tr)` or `(aspor.com.tr, 26 Eylül 2026)`
  html = html.replace(
    new RegExp(`(\\(\\s*)(?:www\\.)?(${KNOWN_DOMAIN_TLD})(?=\\s*(?:[,;)\\]]|\\s+\\d))`, "gi"),
    (_m, open: string, domain: string) => `${open}${protectLink(domain, `https://${domain}`)}`
  );
  // Unlinked domain on a `Kaynak:` / `Kaynaklar:` / `Source:` / `Sources:` line.
  html = html.replace(
    /^([ \t]*(?:[-*•\u2011\u2013][ \t]+)?(?:\*\*|\*)?(?:Kaynak(?:lar)?|Sources?)(?:\*\*|\*)?[ \t]*:[ \t\u00a0\u202f]*)(.+)$/gim,
    (_m, prefix: string, rest: string) => {
      const linkedRest = rest.replace(
        new RegExp(`(^|[\\s([,;:\u00a0\u202f])(?:www\\.)?(${KNOWN_DOMAIN_TLD})(?=$|[\\s)\\].,;:!?\u00a0\u202f])`, "gi"),
        (_m2, lead: string, domain: string) => `${lead}${protectLink(domain, `https://${domain}`)}`
      );
      return `${prefix}${linkedRest}`;
    }
  );
  html = html.replace(BARE_URL, (match: string) => {
    const { url, trailing } = splitTrailing(match);
    return protectLink(url, url) + trailing;
  });

  // Bold + Italic: ***text***
  html = html.replace(/\*\*\*([^*]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold: **text**
  html = html.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  // Italic: *text*. Not after "* " and not across a line break, so a "* item"
  // list line is left for the list rule below.
  html = html.replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, "<em>$1</em>");
  // Strikethrough: ~~text~~
  html = html.replace(/~~([^~]+?)~~/g, "<del>$1</del>");

  // Blockquotes / Rich callout textboxes: lines starting with &gt;
  const blockquotes: string[] = [];
  html = html.replace(/(?:^[ \t]*&gt;[^\n]*(?:\n[ \t]*&gt;[^\n]*)*)/gm, (match) => {
    const rawLines = match.split("\n");
    const idx = blockquotes.length;
    const unescapedLines = rawLines.map((l) => l.replace(/^[ \t]*&gt;[ \t\u00a0\u202f]?/, ""));
    const plainQuoteText = unescapeHtml(unescapedLines.join("\n").trim());

    const paras = unescapedLines.join("\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const bodyHtml = paras.map((p) => {
      const pLines = p.split("\n");
      if (pLines.every((l) => /^[ \t]*[-*•\u2011\u2013][ \t\u00a0\u202f]+/.test(l))) {
        const lis = pLines.map((l) => `<li>${l.replace(/^[ \t]*[-*•\u2011\u2013][ \t\u00a0\u202f]+/, "")}</li>`).join("");
        return `<ul>${lis}</ul>`;
      }
      return `<p>${pLines.join("<br/>")}</p>`;
    }).join("");

    const isMultiLine = rawLines.length >= 2 || plainQuoteText.length > 80;
    const headerHtml = isMultiLine
      ? `<div class="md-blockquote-header"><span class="md-blockquote-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block mr-1 text-gold"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Taslak / Alıntı</span><button type="button" class="copy-code-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${copyPayload(plainQuoteText)}')).then(()=>this.innerHTML='<span style=\\'color:#10b981;\\'>Kopyalandı</span>')"><svg width='11' height='11' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' style='display:inline-block;margin-right:4px;'><rect x='9' y='9' width='13' height='13' rx='2' ry='2'/><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/></svg>Kopyala</button></div>`
      : "";

    blockquotes.push(`
      <blockquote class="md-blockquote">
        ${headerHtml}
        <div class="md-blockquote-body">${bodyHtml}</div>
      </blockquote>
    `);
    return `§§BLOCKQUOTE${idx}§§`;
  });

  // Ensure code blocks and blockquotes are always isolated in their own paragraph block.
  html = html.replace(/[ \t]*\n?(§§CODEBLOCK\d+§§|§§BLOCKQUOTE\d+§§)\n?[ \t]*/g, "\n\n$1\n\n");
  // Collapse blank lines between consecutive list items so loose lists stay in one <ul>/<ol>.
  html = html.replace(/^([ \t]*[-*•\u2011\u2013][ \t\u00a0\u202f]+[^\n]+)\n\n+(?=[ \t]*[-*•\u2011\u2013][ \t\u00a0\u202f]+)/gm, "$1\n");
  html = html.replace(/^([ \t]*\d+[.)][ \t\u00a0\u202f]+[^\n]+)\n\n+(?=[ \t]*(?:\d+[.)]|[-*•\u2011\u2013])[ \t\u00a0\u202f]+)/gm, "$1\n");

  // Paragraphs, Lists, Headings & Tables
  html = html.split("\n\n").map(para => {
    const trimmed = para.trim();
    if (!trimmed) return "";
    if (/^§§CODEBLOCK\d+§§$/.test(trimmed) || /^§§BLOCKQUOTE\d+§§$/.test(trimmed)) return trimmed;

    const lines = trimmed.split("\n");
    if (lines.length >= 2 && lines[0].includes("|") && isTableSeparatorLine(lines[1])) {
      return renderTableBlock(lines);
    }

    const hasBlockStructure = lines.some((l) =>
      /^[ \t]*(?:[-*•\u2011\u2013]|\d+[.)])[ \t\u00a0\u202f]+/.test(l) ||
      /^[ \t]*#{1,6}[ \t]+/.test(l) ||
      /^[ \t]*(?:---+|\*\*\*+)[ \t]*$/.test(l)
    );

    if (hasBlockStructure) {
      let blockHtml = "";
      let openList: "ul" | "ol" | null = null;
      let hasOpenLi = false;
      const closeList = () => {
        if (hasOpenLi) {
          blockHtml += "</li>";
          hasOpenLi = false;
        }
        if (openList) {
          blockHtml += `</${openList}>`;
          openList = null;
        }
      };

      for (const line of lines) {
        const subBulletMatch = line.match(/^[ \t]{2,}[-*•\u2011\u2013][ \t\u00a0\u202f]+(.*)$/);
        if (subBulletMatch && openList && hasOpenLi) {
          blockHtml += `<br/>${subBulletMatch[1]}`;
          continue;
        }
        const ulMatch = line.match(/^[ \t]*[-*•\u2011\u2013][ \t\u00a0\u202f]+(.*)$/);
        if (ulMatch) {
          if (hasOpenLi) { blockHtml += "</li>"; hasOpenLi = false; }
          if (openList === "ol") { blockHtml += "</ol>"; openList = null; }
          if (!openList) { blockHtml += "<ul>"; openList = "ul"; }
          blockHtml += `<li>${ulMatch[1]}`;
          hasOpenLi = true;
          continue;
        }
        const olMatch = line.match(/^[ \t]*\d+[.)][ \t\u00a0\u202f]+(.*)$/);
        if (olMatch) {
          if (hasOpenLi) { blockHtml += "</li>"; hasOpenLi = false; }
          if (openList === "ul") { blockHtml += "</ul>"; openList = null; }
          if (!openList) { blockHtml += "<ol>"; openList = "ol"; }
          blockHtml += `<li>${olMatch[1]}`;
          hasOpenLi = true;
          continue;
        }
        const headingMatch = line.match(/^[ \t]*#{1,6}[ \t]+(.*)$/);
        if (headingMatch) {
          closeList();
          blockHtml += `<p><strong>${headingMatch[1].trim()}</strong></p>`;
          continue;
        }
        if (/^[ \t]*(?:---+|\*\*\*+)[ \t]*$/.test(line)) {
          closeList();
          blockHtml += "<hr class=\"md-hr\"/>";
          continue;
        }
        closeList();
        if (line.trim()) blockHtml += `<p>${line.trim()}</p>`;
      }
      closeList();
      return blockHtml;
    }

    return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
  }).join("");

  // Restore protected blockquotes, code blocks, inline codes and links
  html = html.replace(/§§BLOCKQUOTE(\d+)§§/g, (_m, idx) => blockquotes[Number(idx)]);
  html = html.replace(/§§LINK(\d+)§§/g, (_m, idx) => links[Number(idx)]);
  html = html.replace(/§§INLINECODE(\d+)§§/g, (_m, idx) => inlineCodes[Number(idx)]);
  html = html.replace(/§§CODEBLOCK(\d+)§§/g, (_m, idx) => codeBlocks[Number(idx)]);

  return html;
}
