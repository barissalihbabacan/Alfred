import { describe, it, expect, vi } from "vitest";
import {
  buildGoogleAuthUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  GOOGLE_SCOPES
} from "../../src/ai/tools/google/google-auth.js";
import {
  GOOGLE_CALENDAR_TOOL_DEFINITION,
  createGoogleCalendarTool
} from "../../src/ai/tools/google/calendar.js";
import {
  GOOGLE_TASKS_TOOL_DEFINITION,
  createGoogleTasksTool
} from "../../src/ai/tools/google/tasks.js";

describe("Google Auth Helper", () => {
  it("builds correct OAuth URL with offline access and prompt=consent", () => {
    const url = buildGoogleAuthUrl("my-client-id", "https://app.com/callback", "state_123");
    expect(url).toContain("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("client_id=my-client-id");
    expect(url).toContain("redirect_uri=https%3A%2F%2Fapp.com%2Fcallback");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain("state=state_123");
    expect(url).toContain("scope=");
  });

  it("exchanges code for tokens", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "ya29.mock",
        refresh_token: "1//mock_refresh",
        expires_in: 3600,
        scope: GOOGLE_SCOPES
      })
    });

    const res = await exchangeCodeForTokens({
      code: "test_code",
      clientId: "client_id",
      clientSecret: "client_secret",
      redirectUri: "https://app.com/callback",
      fetchFn: mockFetch as unknown as typeof fetch
    });

    expect(res.accessToken).toBe("ya29.mock");
    expect(res.refreshToken).toBe("1//mock_refresh");
    expect(res.expiresIn).toBe(3600);
  });

  it("refreshes access token with refresh_token", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "ya29.new_mock",
        expires_in: 3600
      })
    });

    const res = await refreshAccessToken({
      refreshToken: "1//mock_refresh",
      clientId: "client_id",
      clientSecret: "client_secret",
      fetchFn: mockFetch as unknown as typeof fetch
    });

    expect(res.accessToken).toBe("ya29.new_mock");
    expect(res.expiresIn).toBe(3600);
  });
});

describe("Google Calendar Tool", () => {
  it("has valid tool definition", () => {
    expect(GOOGLE_CALENDAR_TOOL_DEFINITION.type).toBe("function");
    expect(GOOGLE_CALENDAR_TOOL_DEFINITION.function.name).toBe("google_calendar");
    expect(GOOGLE_CALENDAR_TOOL_DEFINITION.function.parameters.required).toContain("action");
  });

  it("returns error if not connected (no accessToken)", async () => {
    const tool = createGoogleCalendarTool({
      getAccessToken: async () => null
    });
    const res = (await tool({ action: "list_events" })) as { error?: string };
    expect(res.error).toContain("Google hesabı bağlı değil");
  });

  it("lists events successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "ev_1",
            summary: "Sprint Planning",
            start: { dateTime: "2026-10-24T10:00:00Z" },
            end: { dateTime: "2026-10-24T11:00:00Z" }
          }
        ]
      })
    });

    const tool = createGoogleCalendarTool({
      getAccessToken: async () => "token_123",
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const res = (await tool({ action: "list_events" })) as { total: number; events: Array<{ summary: string }> };
    expect(res.total).toBe(1);
    expect(res.events[0].summary).toBe("Sprint Planning");
  });

  it("creates event with ISO dates", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "ev_new",
        summary: "Proje Toplantısı",
        start: { dateTime: "2026-10-25T14:00:00Z" },
        end: { dateTime: "2026-10-25T15:00:00Z" }
      })
    });

    const tool = createGoogleCalendarTool({
      getAccessToken: async () => "token_123",
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const res = (await tool({
      action: "create_event",
      summary: "Proje Toplantısı",
      start: "2026-10-25T14:00:00Z",
      end: "2026-10-25T15:00:00Z"
    })) as { status: string; id: string };

    expect(res.status).toBe("created");
    expect(res.id).toBe("ev_new");
  });
});

describe("Google Tasks Tool", () => {
  it("has valid tool definition", () => {
    expect(GOOGLE_TASKS_TOOL_DEFINITION.type).toBe("function");
    expect(GOOGLE_TASKS_TOOL_DEFINITION.function.name).toBe("google_tasks");
  });

  it("lists tasks successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "t_1",
            title: "Raporu hazırla",
            status: "needsAction"
          }
        ]
      })
    });

    const tool = createGoogleTasksTool({
      getAccessToken: async () => "token_123",
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const res = (await tool({ action: "list_tasks" })) as { total: number; tasks: Array<{ title: string; status: string }> };
    expect(res.total).toBe(1);
    expect(res.tasks[0].title).toBe("Raporu hazırla");
    expect(res.tasks[0].status).toBe("needsAction");
  });

  it("creates task successfully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "t_created",
        title: "Test görevi",
        status: "needsAction"
      })
    });

    const tool = createGoogleTasksTool({
      getAccessToken: async () => "token_123",
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const res = (await tool({ action: "create_task", title: "Test görevi" })) as { status: string; id: string };
    expect(res.status).toBe("created");
    expect(res.id).toBe("t_created");
  });
});
