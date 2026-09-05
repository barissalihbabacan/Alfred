import {
  ConversationDocument,
  ConversationMessageDocument,
  CreateConversationParams,
  AppendMessageParams,
  UpdateMessageParams,
  GetHistoryOptions
} from "./conversation.types.js";
import {
  IConversationRepository,
  CONVERSATION_CONFIG,
  generateDeterministicTitle
} from "./conversation-repository.interface.js";

/**
 * InMemoryConversationRepository
 *
 * Implements IConversationRepository in memory.
 * Used for:
 * 1. Fast, deterministic unit tests without network or emulator dependencies.
 * 2. Local development fallback when Firebase credentials are not provisioned.
 *
 * Faithfully mirrors FirestoreConversationRepository semantics:
 * - Deterministic sequential ordering (1..N per conversation)
 * - Atomic messageCount incrementing
 * - Title auto-derivation on the first user message
 * - Bounded history retrieval in ascending chronological order
 * - User conversation isolation
 */
export class InMemoryConversationRepository implements IConversationRepository {
  private conversations: Map<string, ConversationDocument> = new Map();
  private messages: Map<string, ConversationMessageDocument[]> = new Map();

  async createConversation(params: CreateConversationParams): Promise<ConversationDocument> {
    const id = params.customId || "conv_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();
    const now = new Date();

    const conversation: ConversationDocument = {
      id,
      userId: params.userId,
      title: params.title || CONVERSATION_CONFIG.DEFAULT_CONVERSATION_TITLE,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      messageCount: 0
    };

    this.conversations.set(id, conversation);
    this.messages.set(id, []);
    return { ...conversation };
  }

  async getConversation(conversationId: string): Promise<ConversationDocument | null> {
    const conv = this.conversations.get(conversationId);
    if (!conv) return null;
    return { ...conv };
  }

  async appendMessage(params: AppendMessageParams): Promise<ConversationMessageDocument> {
    const conv = this.conversations.get(params.conversationId);
    if (!conv) {
      throw new Error(`Conversation not found: ${params.conversationId}`);
    }

    const messageList = this.messages.get(params.conversationId) || [];
    const nextSequence = conv.messageCount + 1;
    const now = new Date();

    const messageId = "msg_" + Math.random().toString(36).substring(2, 11) + "_" + Date.now();
    const message: ConversationMessageDocument = {
      id: messageId,
      role: params.role,
      content: params.content,
      sequence: nextSequence,
      status: params.status || "completed",
      createdAt: now,
      provider: params.provider,
      model: params.model,
      finishReason: params.finishReason
    };

    messageList.push(message);
    this.messages.set(params.conversationId, messageList);

    // Update conversation metadata
    conv.messageCount = nextSequence;
    conv.updatedAt = now;
    conv.lastMessageAt = now;

    // Auto-generate title if this is the first user message
    if (
      nextSequence === 1 &&
      params.role === "user" &&
      (!conv.title || conv.title === CONVERSATION_CONFIG.DEFAULT_CONVERSATION_TITLE)
    ) {
      conv.title = generateDeterministicTitle(params.content);
    }

    return { ...message };
  }

  async updateMessage(params: UpdateMessageParams): Promise<void> {
    const messageList = this.messages.get(params.conversationId);
    if (!messageList) {
      throw new Error(`Conversation not found: ${params.conversationId}`);
    }

    const message = messageList.find((m) => m.id === params.messageId);
    if (!message) {
      throw new Error(`Message not found: ${params.messageId}`);
    }

    if (params.content !== undefined) message.content = params.content;
    if (params.status !== undefined) message.status = params.status;
    if (params.finishReason !== undefined) message.finishReason = params.finishReason;
    if (params.provider !== undefined) message.provider = params.provider;
    if (params.model !== undefined) message.model = params.model;
  }

  async getMessages(
    conversationId: string,
    options?: GetHistoryOptions
  ): Promise<ConversationMessageDocument[]> {
    const messageList = this.messages.get(conversationId);
    if (!messageList) return [];

    let filtered = [...messageList];

    if (options?.beforeSequence !== undefined) {
      filtered = filtered.filter((m) => m.sequence < options.beforeSequence!);
    }

    const limit = options?.limit || CONVERSATION_CONFIG.MAX_CONTEXT_MESSAGES;
    // Bounded recent messages: take the last N messages in ascending chronological order
    const bounded = filtered.slice(-limit);
    return bounded.map((m) => ({ ...m }));
  }

  async listConversations(userId: string, limit: number = 20): Promise<ConversationDocument[]> {
    const userConvs = Array.from(this.conversations.values())
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
      .slice(0, limit);

    return userConvs.map((c) => ({ ...c }));
  }

  async deleteConversation(conversationId: string): Promise<void> {
    this.conversations.delete(conversationId);
    this.messages.delete(conversationId);
  }

  /**
   * Clears all stored data. Useful between unit test cases.
   */
  clear(): void {
    this.conversations.clear();
    this.messages.clear();
  }
}
