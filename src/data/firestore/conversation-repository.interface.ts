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
  /** Maximum length of a generated title (generateDeterministicTitle: 37 chars + "...") */
  MAX_TITLE_LENGTH: 40
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

  /**
   * Deletes a conversation and its messages.
   */
  deleteConversation(conversationId: string): Promise<void>;
}

/**
 * Deterministic conversation title from the first user message. Defined in
 * ./conversation-title.ts, which functions/index.js also bundles, so src/ and
 * production name conversations identically.
 */
export { generateDeterministicTitle } from "./conversation-title.js";
