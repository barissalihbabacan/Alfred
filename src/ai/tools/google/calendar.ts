/**
 * Google Calendar Tool
 * 
 * Direct REST API client for Google Calendar.
 * Pure and dependency-free (no googleapis npm bloat), fully bundled.
 */

import type { ToolDefinition } from "../types.js";

interface RawCalendarEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  htmlLink?: string;
}

interface RawCalendarListResponse {
  items?: RawCalendarEvent[];
}

export const GOOGLE_CALENDAR_TOOL_NAME = "google_calendar";

export const GOOGLE_CALENDAR_TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: GOOGLE_CALENDAR_TOOL_NAME,
    description:
      "Access Barış's Google Calendar. Read upcoming events, schedule new appointments/events, " +
      "or delete events. Always check timezone context and provide start/end in ISO 8601 strings.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list_events", "create_event", "delete_event"],
          description: "The calendar action to perform."
        },
        timeMin: {
          type: "string",
          description: "Start of time range for listing events (ISO string, e.g. 2026-10-23T00:00:00Z). Defaults to now if omitted."
        },
        timeMax: {
          type: "string",
          description: "End of time range for listing events (ISO string, e.g. 2026-10-24T00:00:00Z)."
        },
        maxResults: {
          type: "number",
          description: "Max number of events to return (default 10, max 25)."
        },
        summary: {
          type: "string",
          description: "Title or summary of the event (required for create_event)."
        },
        description: {
          type: "string",
          description: "Description or notes for the event."
        },
        location: {
          type: "string",
          description: "Event location."
        },
        start: {
          type: "string",
          description: "Event start time (ISO string or YYYY-MM-DD for full day) (required for create_event)."
        },
        end: {
          type: "string",
          description: "Event end time (ISO string or YYYY-MM-DD for full day) (required for create_event)."
        },
        timeZone: {
          type: "string",
          description: "Timezone (e.g. Europe/Istanbul). Defaults to Europe/Istanbul."
        },
        eventId: {
          type: "string",
          description: "Event ID to delete (required for delete_event)."
        }
      },
      required: ["action"]
    }
  }
};

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  htmlLink?: string;
}

export type GoogleCalendarFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface GoogleCalendarContext {
  getAccessToken: () => Promise<string | null>;
  fetchFn?: GoogleCalendarFetch;
}

export function createGoogleCalendarTool(ctx: GoogleCalendarContext) {
  const fetcher = ctx.fetchFn || fetch;

  return async function runGoogleCalendar(args: Record<string, unknown>): Promise<unknown> {
    const accessToken = await ctx.getAccessToken();
    if (!accessToken) {
      return {
        error: "Google hesabı bağlı değil. Lütfen önce sağ üstteki Google Takvim & Görevler butonundan hesabınızı bağlayın."
      };
    }

    const action = String(args.action || "list_events");

    try {
      if (action === "list_events") {
        const timeMin = typeof args.timeMin === "string" && args.timeMin
          ? new Date(args.timeMin).toISOString()
          : new Date().toISOString();
        
        const params = new URLSearchParams({
          timeMin,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: String(Math.min(Number(args.maxResults) || 10, 25))
        });

        if (typeof args.timeMax === "string" && args.timeMax) {
          params.append("timeMax", new Date(args.timeMax).toISOString());
        }

        const res = await fetcher(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json"
            }
          }
        );

        if (!res.ok) {
          const err = await res.text().catch(() => "");
          return { error: `Takvim etkinlikleri alınamadı (HTTP ${res.status}): ${err}` };
        }

        const data = (await res.json()) as RawCalendarListResponse;
        const items = Array.isArray(data.items) ? data.items : [];
        const events: GoogleCalendarEvent[] = items.map((item: RawCalendarEvent) => ({
          id: item.id || "",
          summary: item.summary || "(Başlıksız Etkinlik)",
          description: item.description,
          location: item.location,
          start: item.start?.dateTime || item.start?.date || "",
          end: item.end?.dateTime || item.end?.date || "",
          htmlLink: item.htmlLink
        }));

        return {
          total: events.length,
          events: events.length > 0 ? events : "Belirtilen zaman aralığında planlanmış etkinlik bulunmuyor."
        };
      }

      if (action === "create_event") {
        const summary = typeof args.summary === "string" ? args.summary.trim() : "";
        if (!summary) return { error: "create_event için 'summary' (etkinlik başlığı) zorunludur." };

        const start = typeof args.start === "string" ? args.start.trim() : "";
        const end = typeof args.end === "string" ? args.end.trim() : "";
        if (!start || !end) return { error: "create_event için 'start' ve 'end' zamanları zorunludur." };

        const timeZone = typeof args.timeZone === "string" && args.timeZone ? args.timeZone : "Europe/Istanbul";

        const isFullDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
        const payload: Record<string, unknown> = {
          summary,
          description: typeof args.description === "string" ? args.description : undefined,
          location: typeof args.location === "string" ? args.location : undefined,
          start: isFullDay ? { date: start } : { dateTime: new Date(start).toISOString(), timeZone },
          end: isFullDay ? { date: end } : { dateTime: new Date(end).toISOString(), timeZone }
        };

        const res = await fetcher(
          "https://www.googleapis.com/calendar/v3/calendars/primary/events",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          }
        );

        if (!res.ok) {
          const err = await res.text().catch(() => "");
          return { error: `Etkinlik oluşturulamadı (HTTP ${res.status}): ${err}` };
        }

        const created = (await res.json()) as RawCalendarEvent;
        return {
          status: "created",
          id: created.id,
          summary: created.summary,
          start: created.start?.dateTime || created.start?.date,
          end: created.end?.dateTime || created.end?.date,
          htmlLink: created.htmlLink
        };
      }

      if (action === "delete_event") {
        const eventId = typeof args.eventId === "string" ? args.eventId.trim() : "";
        if (!eventId) return { error: "delete_event için 'eventId' zorunludur." };

        const res = await fetcher(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` }
          }
        );

        if (!res.ok && res.status !== 404) {
          const err = await res.text().catch(() => "");
          return { error: `Etkinlik silinemedi (HTTP ${res.status}): ${err}` };
        }

        return { status: "deleted", eventId };
      }

      return { error: `Bilinmeyen takvim eylemi: ${action}` };
    } catch (err: unknown) {
      return { error: `Google Calendar işleminde beklenmeyen hata: ${(err as Error)?.message || String(err)}` };
    }
  };
}
