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
import {
  GMAIL_TOOL_DEFINITION,
  createGmailTool,
  buildRawEmail
} from "../../src/ai/tools/google/gmail.js";

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

describe("Gmail Tool", () => {
  it("has valid tool definition", () => {
    expect(GMAIL_TOOL_DEFINITION.type).toBe("function");
    expect(GMAIL_TOOL_DEFINITION.function.name).toBe("gmail");
    expect(GMAIL_TOOL_DEFINITION.function.parameters.required).toContain("action");
  });

  it("returns error if not connected (no accessToken)", async () => {
    const tool = createGmailTool({
      getAccessToken: async () => null
    });
    const res = (await tool({ action: "list_messages" })) as { error?: string };
    expect(res.error).toContain("Google hesabı bağlı değil");
  });

  it("handles 403 insufficient scope gracefully", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "ACCESS_TOKEN_SCOPE_INSUFFICIENT"
    });

    const tool = createGmailTool({
      getAccessToken: async () => "token_123",
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const res = (await tool({ action: "list_messages" })) as { error?: string };
    expect(res.error).toContain("Gmail okuma izni (gmail.readonly) henüz onaylanmamış");
  });

  it("lists messages and retrieves metadata summaries", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/messages?")) {
        return {
          ok: true,
          json: async () => ({
            messages: [{ id: "m_1", threadId: "th_1" }]
          })
        };
      }
      if (url.includes("/messages/m_1?format=metadata")) {
        return {
          ok: true,
          json: async () => ({
            id: "m_1",
            threadId: "th_1",
            snippet: "Yarınki toplantı saat 10:00'da yapılacak.",
            payload: {
              headers: [
                { name: "From", value: "Ahmet Yılmaz <ahmet@example.com>" },
                { name: "Subject", value: "Haftalık Senkronizasyon" },
                { name: "Date", value: "Sat, 24 Oct 2026 14:00:00 +0300" }
              ]
            }
          })
        };
      }
      return { ok: false, status: 404 };
    });

    const tool = createGmailTool({
      getAccessToken: async () => "token_123",
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const res = (await tool({ action: "list_messages" })) as {
      total: number;
      messages: Array<{ id: string; subject: string; from: string; snippet: string }>;
    };

    expect(res.total).toBe(1);
    expect(res.messages[0].subject).toBe("Haftalık Senkronizasyon");
    expect(res.messages[0].from).toContain("ahmet@example.com");
    expect(res.messages[0].snippet).toContain("saat 10:00'da");
  });

  it("gets full message with decoded plain text body", async () => {
    const sampleBody = "Merhaba Barış, proje teslim tarihi haftaya ertelendi.";
    const base64Body = Buffer.from(sampleBody, "utf-8").toString("base64url");

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "m_detail_1",
        threadId: "th_1",
        snippet: "Merhaba Barış...",
        payload: {
          mimeType: "multipart/alternative",
          headers: [
            { name: "From", value: "can@example.com" },
            { name: "To", value: "owner@gmail.com" },
            { name: "Subject", value: "Proje Durumu" },
            { name: "Date", value: "Sat, 24 Oct 2026 15:30:00 +0300" }
          ],
          parts: [
            {
              mimeType: "text/plain",
              body: { data: base64Body }
            }
          ]
        }
      })
    });

    const tool = createGmailTool({
      getAccessToken: async () => "token_123",
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const res = (await tool({ action: "get_message", messageId: "m_detail_1" })) as {
      status: string;
      message: { id: string; subject: string; from: string; to: string; body: string };
    };

    expect(res.status).toBe("success");
    expect(res.message.subject).toBe("Proje Durumu");
    expect(res.message.from).toBe("can@example.com");
    expect(res.message.body).toBe(sampleBody);
  });

  it("buildRawEmail encodes headers, non-ASCII Turkish characters, and body cleanly", () => {
    const raw = buildRawEmail({
      to: "colleague@example.com",
      subject: "Tebrikler: Guess the City Onaylandı!",
      body: "Merhaba Fatih,\nApp Store onayı harika bir haber. Eline sağlık!",
      cc: "team@example.com"
    });
    expect(typeof raw).toBe("string");
    expect(raw.length).toBeGreaterThan(0);
    // Decode base64url to verify RFC 2822 structure
    const decoded = Buffer.from(raw, "base64url").toString("utf-8");
    expect(decoded).toContain("To: colleague@example.com");
    expect(decoded).toContain("Cc: team@example.com");
    expect(decoded).toContain("Subject: =?UTF-8?B?");
    expect(decoded).toContain("Content-Type: text/plain; charset=\"UTF-8\"");
    expect(decoded).toContain("Merhaba Fatih,\nApp Store onayı harika bir haber. Eline sağlık!");
  });

  it("creates a draft in Gmail successfully", async () => {
    let capturedBody: { message?: { raw?: string } } | undefined;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as { message?: { raw?: string } };
      return {
        ok: true,
        json: async () => ({
          id: "draft_123",
          message: { id: "msg_draft_123", threadId: "th_draft_123" }
        })
      };
    });

    const tool = createGmailTool({
      getAccessToken: async () => "token_123",
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const res = (await tool({
      action: "create_draft",
      to: "colleague@example.com",
      subject: "Guess the City Tebrik",
      body: "Uygulama yayına hazır."
    })) as {
      status: string;
      action: string;
      draftId: string;
      to: string;
      subject: string;
    };

    expect(res.status).toBe("success");
    expect(res.action).toBe("create_draft");
    expect(res.draftId).toBe("draft_123");
    expect(res.to).toBe("colleague@example.com");
    expect(capturedBody?.message?.raw).toBeDefined();
  });

  it("sends an email directly in Gmail successfully", async () => {
    let capturedBody: { raw?: string } | undefined;
    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as { raw?: string };
      return {
        ok: true,
        json: async () => ({
          id: "sent_msg_456",
          threadId: "th_sent_456"
        })
      };
    });

    const tool = createGmailTool({
      getAccessToken: async () => "token_123",
      fetchFn: mockFetch as unknown as typeof fetch
    });

    const res = (await tool({
      action: "send_message",
      to: "colleague@example.com",
      subject: "Canlı Yayında",
      body: "Tüm öğeler App Store Connect üzerinde aktif."
    })) as {
      status: string;
      action: string;
      messageId: string;
      to: string;
    };

    expect(res.status).toBe("success");
    expect(res.action).toBe("send_message");
    expect(res.messageId).toBe("sent_msg_456");
    expect(capturedBody?.raw).toBeDefined();
  });

  it("returns error if body is missing for draft creation", async () => {
    const tool = createGmailTool({
      getAccessToken: async () => "token_123"
    });
    const res = (await tool({ action: "create_draft", to: "test@example.com" })) as { error?: string };
    expect(res.error).toContain("body");
  });
});
