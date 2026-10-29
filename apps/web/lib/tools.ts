import { translate, type Lang, type MessageKey } from "./i18n";

/**
 * Status text for a `tool_call` SSE event, shown instead of "Thinking..."
 * while a slow tool runs. The server sends `{ toolCalls: [{ name, … }] }`
 * before running the calls and `{ tool }` per call afterwards.
 */
const TOOL_STATUS: Record<string, MessageKey> = {
  web_search: "tool.status.webSearch",
  read_url: "tool.status.readUrl",
  github: "tool.status.github",
  google_calendar: "tool.status.calendar",
  google_tasks: "tool.status.tasks",
  gmail: "tool.status.gmail"
};

/** Product names stay as they are; the rest is translated. */
const TOOL_BADGE_LABELS: Record<string, MessageKey | { name: string }> = {
  web_search: "tool.badge.webSearch",
  read_url: "tool.badge.readUrl",
  github: { name: "GitHub" },
  google_calendar: "tool.badge.calendar",
  google_tasks: "tool.badge.tasks",
  gmail: { name: "Gmail" },
  get_current_time: "tool.badge.time"
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

export function toolStatusText(event: { tool?: unknown; toolCalls?: unknown }, lang: Lang): string | undefined {
  for (const name of extractToolNames(event)) {
    if (Object.hasOwn(TOOL_STATUS, name)) return translate(lang, TOOL_STATUS[name]);
  }
  return undefined;
}

export function toolBadgeLabel(toolName: string, lang: Lang): string {
  if (!Object.hasOwn(TOOL_BADGE_LABELS, toolName)) return toolName;
  const label = TOOL_BADGE_LABELS[toolName];
  return typeof label === "string" ? translate(lang, label) : label.name;
}

