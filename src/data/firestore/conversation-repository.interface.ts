import {
  ConversationDocument,
  ConversationMessageDocument,
  CreateConversationParams,
  AppendMessageParams,
  UpdateMessageParams,
  GetHistoryOptions
} from "./conversation.types.js";

/**
 * Standard configuration limits for conversation persistence.
 * Single source of truth for context window sizing.
 */
export const CONVERSATION_CONFIG = {
  /** Maximum number of recent messages retrieved for LLM prompt construction */
  MAX_CONTEXT_MESSAGES: 10,
  /** Maximum character length per message */
  MAX_MESSAGE_LENGTH: 4000,
  /** Default title when conversation starts */
  DEFAULT_CONVERSATION_TITLE: "New Conversation",
  /** Maximum length of deterministic auto-generated title */
  MAX_TITLE_LENGTH: 60
} as const;

/**
 * IConversationRepository
 *
 * Clean contract isolating Firestore details from the rest of the application.
 */
export interface IConversationRepository {
  /**
   * Creates a new conversation record.
   */
  createConversation(params: CreateConversationParams): Promise<ConversationDocument>;

  /**
   * Retrieves conversation metadata by ID.
   */
  getConversation(conversationId: string): Promise<ConversationDocument | null>;

  /**
   * Appends a message to the conversation subcollection atomically.
   * Increments conversation messageCount and updates lastMessageAt.
   */
  appendMessage(params: AppendMessageParams): Promise<ConversationMessageDocument>;

  /**
   * Updates an existing message (e.g. streaming accumulation completion or status change).
   */
  updateMessage(params: UpdateMessageParams): Promise<void>;

  /**
   * Retrieves messages for a conversation, ordered chronologically by sequence.
   * Supports bounded limit for LLM context windowing.
   */
  getMessages(
    conversationId: string,
    options?: GetHistoryOptions
  ): Promise<ConversationMessageDocument[]>;

  /**
   * Lists all conversations for a user.
   */
  listConversations(userId: string, limit?: number): Promise<ConversationDocument[]>;
}

/**
 * Generates a clean, deterministic conversation title from the first user message.
 * No secondary LLM call needed.
 */
export function generateDeterministicTitle(firstMessage: string): string {
  if (!firstMessage || !firstMessage.trim()) {
    return CONVERSATION_CONFIG.DEFAULT_CONVERSATION_TITLE;
  }

  // Clean and truncate
  const cleaned = firstMessage
    .replace(/[^\w\s\u00C0-\u017F\u0100-\u024F\u1E00-\u1EFF]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return CONVERSATION_CONFIG.DEFAULT_CONVERSATION_TITLE;
  }

  if (cleaned.length <= CONVERSATION_CONFIG.MAX_TITLE_LENGTH) {
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  const truncated = cleaned.slice(0, CONVERSATION_CONFIG.MAX_TITLE_LENGTH);
  const lastSpace = truncated.lastIndexOf(" ");
  const title = lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated;
  return title.charAt(0).toUpperCase() + title.slice(1);
}
