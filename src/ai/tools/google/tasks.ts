/**
 * Google Tasks Tool
 * 
 * Direct REST API client for Google Tasks.
 * Pure and dependency-free (no googleapis npm bloat), fully bundled.
 */

import type { ToolDefinition } from "../types.js";

export const GOOGLE_TASKS_TOOL_NAME = "google_tasks";

export const GOOGLE_TASKS_TOOL_DEFINITION: ToolDefinition = {
  type: "function",
  function: {
    name: GOOGLE_TASKS_TOOL_NAME,
    description:
      "Access Barış's Google Tasks. List pending tasks, create new todo items, " +
      "or mark tasks as completed.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list_tasks", "create_task", "complete_task", "delete_task"],
          description: "The tasks action to perform."
        },
        tasklist: {
          type: "string",
          description: "The tasklist ID (defaults to '@default' for the primary list)."
        },
        showCompleted: {
          type: "boolean",
          description: "Whether to include completed tasks when listing (default false)."
        },
        title: {
          type: "string",
          description: "Title of the task (required for create_task)."
        },
        notes: {
          type: "string",
          description: "Detailed notes or description for the task."
        },
        due: {
          type: "string",
          description: "Due date in RFC 3339 timestamp (e.g. 2026-10-24T18:00:00Z)."
        },
        taskId: {
          type: "string",
          description: "Task ID (required for complete_task and delete_task)."
        }
      },
      required: ["action"]
    }
  }
};

export interface GoogleTaskItem {
  id: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string;
  completed?: string;
}

export type GoogleTasksFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface GoogleTasksContext {
  getAccessToken: () => Promise<string | null>;
  fetchFn?: GoogleTasksFetch;
}

export function createGoogleTasksTool(ctx: GoogleTasksContext) {
  const fetcher = ctx.fetchFn || fetch;

  return async function runGoogleTasks(args: Record<string, unknown>): Promise<unknown> {
    const accessToken = await ctx.getAccessToken();
    if (!accessToken) {
      return {
        error: "Google hesabı bağlı değil. Lütfen önce sağ üstteki Google Takvim & Görevler butonundan hesabınızı bağlayın."
      };
    }

    const action = String(args.action || "list_tasks");
    const tasklist = typeof args.tasklist === "string" && args.tasklist ? args.tasklist : "@default";

    try {
      if (action === "list_tasks") {
        const showCompleted = Boolean(args.showCompleted);
        const params = new URLSearchParams({
          maxResults: "25",
          showCompleted: String(showCompleted),
          showHidden: "false"
        });

        const res = await fetcher(
          `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklist)}/tasks?${params.toString()}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json"
            }
          }
        );

        if (!res.ok) {
          const err = await res.text().catch(() => "");
          return { error: `Görevler alınamadı (HTTP ${res.status}): ${err}` };
        }

        const data = (await res.json()) as Record<string, any>;
        const items = Array.isArray(data.items) ? data.items : [];
        const tasks: GoogleTaskItem[] = items.map((t: any) => ({
          id: t.id,
          title: t.title || "(Başlıksız Görev)",
          notes: t.notes,
          status: t.status === "completed" ? "completed" : "needsAction",
          due: t.due,
          completed: t.completed
        }));

        return {
          total: tasks.length,
          tasks: tasks.length > 0 ? tasks : "Bekleyen görev bulunmuyor."
        };
      }

      if (action === "create_task") {
        const title = typeof args.title === "string" ? args.title.trim() : "";
        if (!title) return { error: "create_task için 'title' (görev başlığı) zorunludur." };

        const payload: Record<string, unknown> = {
          title,
          notes: typeof args.notes === "string" ? args.notes : undefined,
          due: typeof args.due === "string" && args.due ? new Date(args.due).toISOString() : undefined
        };

        const res = await fetcher(
          `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklist)}/tasks`,
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
          return { error: `Görev oluşturulamadı (HTTP ${res.status}): ${err}` };
        }

        const created = (await res.json()) as Record<string, any>;
        return {
          status: "created",
          id: created.id,
          title: created.title,
          notes: created.notes,
          due: created.due
        };
      }

      if (action === "complete_task") {
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
        if (!taskId) return { error: "complete_task için 'taskId' zorunludur." };

        const res = await fetcher(
          `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklist)}/tasks/${encodeURIComponent(taskId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              status: "completed"
            })
          }
        );

        if (!res.ok) {
          const err = await res.text().catch(() => "");
          return { error: `Görev tamamlanamadı (HTTP ${res.status}): ${err}` };
        }

        return { status: "completed", taskId };
      }

      if (action === "delete_task") {
        const taskId = typeof args.taskId === "string" ? args.taskId.trim() : "";
        if (!taskId) return { error: "delete_task için 'taskId' zorunludur." };

        const res = await fetcher(
          `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(tasklist)}/tasks/${encodeURIComponent(taskId)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` }
          }
        );

        if (!res.ok && res.status !== 404) {
          const err = await res.text().catch(() => "");
          return { error: `Görev silinemedi (HTTP ${res.status}): ${err}` };
        }

        return { status: "deleted", taskId };
      }

      return { error: `Bilinmeyen görev eylemi: ${action}` };
    } catch (err: unknown) {
      return { error: `Google Tasks işleminde beklenmeyen hata: ${(err as Error)?.message || String(err)}` };
    }
  };
}
