/**
 * Google Gmail Tool
 *
 * Direct REST API client for Gmail (read-only).
 * Pure and dependency-free (no googleapis npm bloat), fully bundled.
 */

import type { ToolDefinition } from "../types.js";

interface RawMessageHeader {
  name?: string;
  value?: string;
}

interface RawMessagePartBody {
  data?: string;
  size?: number;
}

interface RawMessagePart {
  mimeType?: string;
  body?: RawMessagePartBody;
  parts?: RawMessagePart[];
}

interface RawMessageItem {
  id?: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    mimeType?: string;
    headers?: RawMessageHeader[];
    body?: RawMessagePartBody;
    parts?: RawMessagePart[];
  };
}

interface RawMessageListResponse {
  messages?: Array<{ id?: string; threadId?: string }>;
  resultSizeEstimate?: number;
}

export const GMAIL_TOOL_NAME = "gmail";

export const GMAIL_TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: GMAIL_TOOL_NAME,
    description:
      "Access the user's Gmail account. Search or list recent/unread emails (list_messages), " +
      "retrieve the detailed body and headers of a specific email (get_message), " +
      "compose and create an email draft in Gmail (create_draft), " +
      "or send an email directly (send_message). " +
      "Always respect user privacy and prefer creating drafts when drafting responses for the user to review.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list_messages", "get_message", "create_draft", "send_message"],
          description: "Action to perform: 'list_messages' to query/list emails, 'get_message' to read a specific email, 'create_draft' to create an email draft in Gmail, 'send_message' to send an email directly."
        },
        query: {
          type: "string",
          description: "Search filter query for list_messages (e.g. 'is:unread', 'label:INBOX', 'from:sender', 'subject:report'). Defaults to 'is:unread'."
        },
        maxResults: {
          type: "number",
          description: "Max number of messages to return for list_messages (1-10, default is 5)."
        },
        messageId: {
          type: "string",
          description: "The unique message ID required for get_message."
        },
        to: {
          type: "string",
          description: "Recipient email address for create_draft or send_message (e.g. 'colleague@example.com')."
        },
        subject: {
          type: "string",
          description: "Subject line of the email for create_draft or send_message."
        },
        body: {
          type: "string",
          description: "Body text / content of the email for create_draft or send_message."
        },
        cc: {
          type: "string",
          description: "Optional CC email address."
        },
        bcc: {
          type: "string",
          description: "Optional BCC email address."
        }
      },
      required: ["action"]
    }
  }
};

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface GmailMessageDetail {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  body: string;
}

export type GmailFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface GmailContext {
  getAccessToken: () => Promise<string | null>;
  fetchFn?: GmailFetch;
}

function getHeader(headers: RawMessageHeader[] | undefined, name: string): string {
  if (!Array.isArray(headers)) return "";
  const target = name.toLowerCase();
  const found = headers.find((h) => (h.name || "").toLowerCase() === target);
  return found?.value || "";
}

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data, "base64url").toString("utf-8");
  } catch {
    return "";
  }
}

export function buildRawEmail({
  to,
  subject,
  body,
  cc,
  bcc
}: {
  to?: string;
  subject?: string;
  body: string;
  cc?: string;
  bcc?: string;
}): string {
  const headers: string[] = [
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
    `Content-Transfer-Encoding: 8bit`
  ];

  if (to && to.trim()) headers.push(`To: ${to.trim()}`);
  if (cc && cc.trim()) headers.push(`Cc: ${cc.trim()}`);
  if (bcc && bcc.trim()) headers.push(`Bcc: ${bcc.trim()}`);
  if (subject && subject.trim()) {
    const s = subject.trim();
    if (/^[\x20-\x7E]*$/.test(s)) {
      headers.push(`Subject: ${s}`);
    } else {
      const b64 = Buffer.from(s, "utf-8").toString("base64");
      headers.push(`Subject: =?UTF-8?B?${b64}?=`);
    }
  }

  const rawMime = `${headers.join("\r\n")}\r\n\r\n${body}`;

  return Buffer.from(rawMime, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function extractTextBody(part: RawMessagePart | undefined): string {
  if (!part) return "";

  if (part.mimeType === "text/plain" && part.body?.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (decoded.trim()) return decoded;
  }

  if (Array.isArray(part.parts)) {
    for (const subPart of part.parts) {
      const text = extractTextBody(subPart);
      if (text.trim()) return text;
    }
  }

  // Fallback to text/html stripped of tags if no text/plain found
  if (part.mimeType === "text/html" && part.body?.data) {
    const rawHtml = decodeBase64Url(part.body.data);
    return rawHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  return "";
}

export function createGmailTool(ctx: GmailContext) {
  const fetcher = ctx.fetchFn || fetch;

  return async function runGmail(args: Record<string, unknown>): Promise<unknown> {
    const accessToken = await ctx.getAccessToken();
    if (!accessToken) {
      return {
        error: "Google hesabı bağlı değil. Lütfen önce Hesap Bilgileri menüsünden Google hesabınızı bağlayın."
      };
    }

    const action = String(args.action || "list_messages");

    try {
      if (action === "list_messages") {
        const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : "is:unread";
        const maxResults = typeof args.maxResults === "number" && args.maxResults > 0
          ? Math.min(Math.floor(args.maxResults), 10)
          : 5;

        const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
        listUrl.searchParams.set("q", query);
        listUrl.searchParams.set("maxResults", String(maxResults));

        const listRes = await fetcher(listUrl.toString(), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
          }
        });

        if (!listRes.ok) {
          const err = await listRes.text().catch(() => "");
          if (listRes.status === 403 && (err.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || err.includes("insufficientPermissions"))) {
            return {
              error: "Gmail okuma izni (gmail.readonly) henüz onaylanmamış. Lütfen Hesap Bilgileri penceresinden Google hesabınızı yeniden bağlayıp Gmail iznini onaylayın."
            };
          }
          return { error: `E-postalar listelenemedi (HTTP ${listRes.status}): ${err}` };
        }

        const listData = (await listRes.json()) as RawMessageListResponse;
        const msgStubs = Array.isArray(listData.messages) ? listData.messages : [];

        if (msgStubs.length === 0) {
          return {
            total: 0,
            query,
            messages: "Belirtilen arama kriterine uygun e-posta bulunamadı."
          };
        }

        // Fetch lightweight metadata for each stub in parallel
        const summaries: GmailMessageSummary[] = await Promise.all(
          msgStubs.map(async (stub) => {
            if (!stub.id) return { id: "", threadId: "", from: "", subject: "", date: "", snippet: "" };
            const metaUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(stub.id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`;
            try {
              const metaRes = await fetcher(metaUrl, {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  Accept: "application/json"
                }
              });
              if (!metaRes.ok) {
                return {
                  id: stub.id,
                  threadId: stub.threadId || "",
                  from: "",
                  subject: "(Erişilemedi)",
                  date: "",
                  snippet: ""
                };
              }
              const item = (await metaRes.json()) as RawMessageItem;
              return {
                id: item.id || stub.id,
                threadId: item.threadId || stub.threadId || "",
                from: getHeader(item.payload?.headers, "From") || "(Bilinmeyen Gönderici)",
                subject: getHeader(item.payload?.headers, "Subject") || "(Konusuz)",
                date: getHeader(item.payload?.headers, "Date") || "",
                snippet: item.snippet || ""
              };
            } catch {
              return {
                id: stub.id,
                threadId: stub.threadId || "",
                from: "",
                subject: "(Okunamadı)",
                date: "",
                snippet: ""
              };
            }
          })
        );

        return {
          total: summaries.length,
          query,
          messages: summaries
        };
      }

      if (action === "get_message") {
        const messageId = typeof args.messageId === "string" ? args.messageId.trim() : "";
        if (!messageId) {
          return { error: "get_message işlemi için 'messageId' zorunludur." };
        }

        const detailUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`;
        const res = await fetcher(detailUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json"
          }
        });

        if (!res.ok) {
          const err = await res.text().catch(() => "");
          if (res.status === 403 && (err.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || err.includes("insufficientPermissions"))) {
            return {
              error: "Gmail okuma izni (gmail.readonly) henüz onaylanmamış. Lütfen Hesap Bilgileri penceresinden Google hesabınızı yeniden bağlayıp Gmail iznini onaylayın."
            };
          }
          return { error: `E-posta detayı alınamadı (HTTP ${res.status}): ${err}` };
        }

        const msg = (await res.json()) as RawMessageItem;
        const headers = msg.payload?.headers;
        let body = extractTextBody(msg.payload);
        if (!body) body = msg.snippet || "(İçerik metni bulunamadı)";

        // Truncate body to ~2500 chars to avoid blowing LLM context window
        if (body.length > 2500) {
          body = body.slice(0, 2500) + "\n... [İçerik çok uzun olduğu için devamı kırpıldı]";
        }

        const detail: GmailMessageDetail = {
          id: msg.id || messageId,
          threadId: msg.threadId || "",
          from: getHeader(headers, "From") || "(Bilinmeyen Gönderici)",
          to: getHeader(headers, "To") || "",
          subject: getHeader(headers, "Subject") || "(Konusuz)",
          date: getHeader(headers, "Date") || "",
          snippet: msg.snippet || "",
          body
        };

        return {
          status: "success",
          message: detail
        };
      }

      if (action === "create_draft") {
        const bodyText = typeof args.body === "string" ? args.body.trim() : "";
        if (!bodyText) {
          return { error: "create_draft işlemi için 'body' (e-posta metni) zorunludur." };
        }
        const to = typeof args.to === "string" ? args.to.trim() : undefined;
        const subject = typeof args.subject === "string" ? args.subject.trim() : "";
        const cc = typeof args.cc === "string" ? args.cc.trim() : undefined;
        const bcc = typeof args.bcc === "string" ? args.bcc.trim() : undefined;

        const raw = buildRawEmail({ to, subject, body: bodyText, cc, bcc });

        const draftRes = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            message: {
              raw
            }
          })
        });

        if (!draftRes.ok) {
          const err = await draftRes.text().catch(() => "");
          if (draftRes.status === 403 && (err.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || err.includes("insufficientPermissions"))) {
            return {
              error: "Gmail taslak oluşturma izni (gmail.compose) henüz onaylanmamış. Lütfen Hesap Bilgileri penceresinden Google hesabınızı yeniden bağlayıp Gmail iznini onaylayın."
            };
          }
          return { error: `E-posta taslağı oluşturulamadı (HTTP ${draftRes.status}): ${err}` };
        }

        const draftData = (await draftRes.json()) as { id?: string; message?: { id?: string; threadId?: string } };
        return {
          status: "success",
          action: "create_draft",
          draftId: draftData.id,
          messageId: draftData.message?.id,
          to: to || "(Alıcı belirtilmedi)",
          subject: subject || "(Konusuz)",
          snippet: bodyText.slice(0, 160),
          message: "E-posta taslağı Gmail hesabınızda başarıyla oluşturuldu."
        };
      }

      if (action === "send_message") {
        const bodyText = typeof args.body === "string" ? args.body.trim() : "";
        if (!bodyText) {
          return { error: "send_message işlemi için 'body' (e-posta metni) zorunludur." };
        }
        const to = typeof args.to === "string" ? args.to.trim() : "";
        if (!to) {
          return { error: "send_message işlemi için 'to' (alıcı e-posta adresi) zorunludur." };
        }
        const subject = typeof args.subject === "string" ? args.subject.trim() : "";
        const cc = typeof args.cc === "string" ? args.cc.trim() : undefined;
        const bcc = typeof args.bcc === "string" ? args.bcc.trim() : undefined;

        const raw = buildRawEmail({ to, subject, body: bodyText, cc, bcc });

        const sendRes = await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({
            raw
          })
        });

        if (!sendRes.ok) {
          const err = await sendRes.text().catch(() => "");
          if (sendRes.status === 403 && (err.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || err.includes("insufficientPermissions"))) {
            return {
              error: "Gmail e-posta gönderme izni (gmail.compose) henüz onaylanmamış. Lütfen Hesap Bilgileri penceresinden Google hesabınızı yeniden bağlayıp Gmail iznini onaylayın."
            };
          }
          return { error: `E-posta gönderilemedi (HTTP ${sendRes.status}): ${err}` };
        }

        const sendData = (await sendRes.json()) as { id?: string; threadId?: string };
        return {
          status: "success",
          action: "send_message",
          messageId: sendData.id,
          to,
          subject: subject || "(Konusuz)",
          message: "E-posta başarıyla gönderildi."
        };
      }

      return { error: `Bilinmeyen action: '${action}'. Geçerli eylemler: 'list_messages', 'get_message', 'create_draft', 'send_message'.` };
    } catch (err: unknown) {
      return { error: `Gmail işlemi sırasında beklenmeyen hata: ${(err as Error)?.message || String(err)}` };
    }
  };
}
