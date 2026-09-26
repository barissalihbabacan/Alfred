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

export function renderMarkdown(text: string): string {
  if (!text) return "";

  // Completely remove <think>...</think> or unclosed <think>... from display
  const cleanText = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
  if (!cleanText) {
    return "";
  }

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
          <span>${language}</span>
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

  // Bold + Italic: ***text***
  html = html.replace(/\*\*\*([^*]+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold: **text**
  html = html.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  // Italic: *text*. Not after "* " and not across a line break, so a "* item"
  // list line is left for the list rule below.
  html = html.replace(/\*(?!\s)([^*\n]+?)(?<!\s)\*/g, "<em>$1</em>");
  // Strikethrough: ~~text~~
  html = html.replace(/~~([^~]+?)~~/g, "<del>$1</del>");

  // Paragraphs & Lists
  html = html.split("\n\n").map(para => {
    const trimmed = para.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("§§CODEBLOCK")) return trimmed;

    // Check if paragraph is an unordered list
    if (/^[-*]\s+/m.test(trimmed)) {
      const lines = trimmed.split("\n");
      let listHtml = "";
      let inUl = false;
      for (const line of lines) {
        const m = line.match(/^[-*]\s+(.*)$/);
        if (m) {
          if (!inUl) { listHtml += "<ul>"; inUl = true; }
          listHtml += `<li>${m[1]}</li>`;
        } else {
          if (inUl) { listHtml += "</ul>"; inUl = false; }
          if (line.trim()) listHtml += `<p>${line.trim()}</p>`;
        }
      }
      if (inUl) listHtml += "</ul>";
      return listHtml;
    }

    // Check if paragraph is an ordered list
    if (/^\d+\.\s+/m.test(trimmed)) {
      const lines = trimmed.split("\n");
      let listHtml = "";
      let inOl = false;
      for (const line of lines) {
        const m = line.match(/^\d+\.\s+(.*)$/);
        if (m) {
          if (!inOl) { listHtml += "<ol>"; inOl = true; }
          listHtml += `<li>${m[1]}</li>`;
        } else {
          if (inOl) { listHtml += "</ol>"; inOl = false; }
          if (line.trim()) listHtml += `<p>${line.trim()}</p>`;
        }
      }
      if (inOl) listHtml += "</ol>";
      return listHtml;
    }

    return `<p>${trimmed.replace(/\n/g, "<br/>")}</p>`;
  }).join("");

  // Restore protected code blocks & inline codes
  html = html.replace(/§§INLINECODE(\d+)§§/g, (_m, idx) => inlineCodes[Number(idx)]);
  html = html.replace(/§§CODEBLOCK(\d+)§§/g, (_m, idx) => codeBlocks[Number(idx)]);

  return html;
}
