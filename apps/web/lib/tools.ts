/**
 * Status text for a `tool_call` SSE event, shown instead of "Düşünüyor..."
 * while a slow tool runs. The server sends `{ toolCalls: [{ name, … }] }`
 * before running the calls and `{ tool }` per call afterwards.
 */
const TOOL_STATUS: Record<string, string> = {
  web_search: "Web'de aranıyor…",
  read_url: "Sayfa okunuyor…",
  github: "GitHub inceleniyor…"
};

const TOOL_BADGE_LABELS: Record<string, string> = {
  web_search: "Web Araması",
  read_url: "Bağlantı",
  github: "GitHub",
  get_current_time: "Sistem Zamanı"
};

export function extractToolNames(event: { tool?: unknown; toolCalls?: unknown }): string[] {
  const names: string[] = [];
  if (Array.isArray(event.toolCalls)) {
    for (const call of event.toolCalls) {
      const name = (call as { name?: unknown } | null)?.name;
      if (typeof name === "string" && name && !names.includes(name)) {
        names.push(name);
      }
    }
  }
  if (typeof event.tool === "string" && event.tool && !names.includes(event.tool)) {
    names.push(event.tool);
  }
  return names;
}

export function toolStatusText(event: { tool?: unknown; toolCalls?: unknown }): string | undefined {
  for (const name of extractToolNames(event)) {
    if (TOOL_STATUS[name]) return TOOL_STATUS[name];
  }
  return undefined;
}

export function toolBadgeLabel(toolName: string): string {
  return TOOL_BADGE_LABELS[toolName] || toolName;
}

