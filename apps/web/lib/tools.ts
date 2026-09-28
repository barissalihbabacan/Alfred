/**
 * Status text for a `tool_call` SSE event, shown instead of "Düşünüyor..."
 * while a slow tool runs. The server sends `{ toolCalls: [{ name, … }] }`
 * before running the calls and `{ tool }` per call afterwards.
 */
const TOOL_STATUS: Record<string, string> = {
  web_search: "Web'de aranıyor…"
};

export function toolStatusText(event: { tool?: unknown; toolCalls?: unknown }): string | undefined {
  const names: unknown[] = [];
  if (Array.isArray(event.toolCalls)) {
    for (const call of event.toolCalls) names.push((call as { name?: unknown } | null)?.name);
  }
  names.push(event.tool);
  for (const name of names) {
    if (typeof name === "string" && TOOL_STATUS[name]) return TOOL_STATUS[name];
  }
  return undefined;
}
