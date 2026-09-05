/**
 * Persistent Conversation and Message Schema for Firestore
 *
 * Firestore Hierarchy:
 * conversations/{conversationId}
 *   -> userId: string
 *   -> title: string
 *   -> createdAt: Timestamp
 *   -> updatedAt: Timestamp
 *   -> lastMessageAt: Timestamp
 *   -> messageCount: number
 *
 * conversations/{conversationId}/messages/{messageId}
 *   -> role: "user" | "assistant" | "system"
 *   -> content: string
 *   -> sequence: number (1-based integer, atomically incremented per message)
 *   -> status: "completed" | "interrupted" | "error"
 *   -> createdAt: Timestamp
 *   -> provider?: string
 *   -> model?: string
 *   -> finishReason?: string
 */

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "completed" | "interrupted" | "error";

export interface ConversationDocument {
  id: string;
  userId: string;
  title: string;
  createdAt: Date | any;
  updatedAt: Date | any;
  lastMessageAt: Date | any;
  messageCount: number;
}

export interface ConversationMessageDocument {
  id: string;
  role: MessageRole;
  content: string;
  sequence: number;
  status: MessageStatus;
  createdAt: Date | any;
  provider?: string;
  model?: string;
  finishReason?: string;
}

export interface CreateConversationParams {
  userId: string;
  title?: string;
  customId?: string;
}

export interface AppendMessageParams {
  conversationId: string;
  role: MessageRole;
  content: string;
  status?: MessageStatus;
  provider?: string;
  model?: string;
  finishReason?: string;
}

export interface UpdateMessageParams {
  conversationId: string;
  messageId: string;
  content?: string;
  status?: MessageStatus;
  finishReason?: string;
  provider?: string;
  model?: string;
}

export interface GetHistoryOptions {
  limit?: number;
  direction?: "asc" | "desc";
  beforeSequence?: number;
}
