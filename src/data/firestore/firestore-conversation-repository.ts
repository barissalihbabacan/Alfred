import { getApps, initializeApp, cert, App } from "firebase-admin/app";
import { getFirestore, Firestore, FieldValue, Timestamp } from "firebase-admin/firestore";
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
 * Initializes and caches the Firebase Admin Firestore instance.
 * Supports standard application default credentials, service account environment variables,
 * or Firebase emulator.
 */
let firestoreInstance: Firestore | null = null;

export function getFirestoreDb(): Firestore {
  if (firestoreInstance) {
    return firestoreInstance;
  }

  let app: App;
  const existingApps = getApps();

  if (existingApps.length > 0 && existingApps[0]) {
    app = existingApps[0];
  } else {
    // Check service account from environment or fallback to project ID
    const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "butler-alfred";
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    const isRealEmail = clientEmail && !clientEmail.includes("your-service-account") && clientEmail.includes("@");
    const isRealKey = privateKey && privateKey.includes("-----BEGIN") && !privateKey.includes("...");

    if (isRealEmail && isRealKey && !process.env.FIRESTORE_EMULATOR_HOST) {
      app = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey
        }),
        projectId
      });
    } else {
      app = initializeApp({ projectId });
    }
  }

  firestoreInstance = getFirestore(app);
  // Ignore undefined properties to avoid Firestore serialization errors
  firestoreInstance.settings({ ignoreUndefinedProperties: true });

  return firestoreInstance;
}

/**
 * Set custom firestore instance (primarily for testing and emulators)
 */
export function setFirestoreDb(db: Firestore | null): void {
  firestoreInstance = db;
}

/**
 * FirestoreConversationRepository
 *
 * Implements persistent conversation management on Firestore:
 * - conversations/{conversationId}
 * - conversations/{conversationId}/messages/{messageId}
 *
 * Guarantees:
 * - Deterministic sequential ordering via atomic transactions
 * - Concurrency safety (messageCount incremented atomically)
 * - Strict separation: zero prompt or model execution logic here
 */
export class FirestoreConversationRepository implements IConversationRepository {
  private db: Firestore;

  constructor(db?: Firestore) {
    this.db = db || getFirestoreDb();
  }

  /**
   * Creates a new conversation.
   */
  async createConversation(params: CreateConversationParams): Promise<ConversationDocument> {
    const colRef = this.db.collection("conversations");
    const docRef = params.customId ? colRef.doc(params.customId) : colRef.doc();
    const now = Timestamp.now();

    const data = {
      userId: params.userId,
      title: params.title || CONVERSATION_CONFIG.DEFAULT_CONVERSATION_TITLE,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
      messageCount: 0
    };

    await docRef.set(data);

    return {
      id: docRef.id,
      ...data,
      createdAt: now.toDate(),
      updatedAt: now.toDate(),
      lastMessageAt: now.toDate()
    };
  }

  /**
   * Retrieves conversation metadata.
   */
  async getConversation(conversationId: string): Promise<ConversationDocument | null> {
    const docRef = this.db.collection("conversations").doc(conversationId);
    const snap = await docRef.get();

    if (!snap.exists) {
      return null;
    }

    const data = snap.data()!;
    return {
      id: snap.id,
      userId: data.userId || "anonymous",
      title: data.title || CONVERSATION_CONFIG.DEFAULT_CONVERSATION_TITLE,
      createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
      updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(),
      lastMessageAt: data.lastMessageAt?.toDate ? data.lastMessageAt.toDate() : new Date(),
      messageCount: data.messageCount || 0
    };
  }

  /**
   * Atomically appends a message with deterministic sequence numbering.
   * Runs inside a Firestore transaction to prevent sequence collisions.
   */
  async appendMessage(params: AppendMessageParams): Promise<ConversationMessageDocument> {
    const convRef = this.db.collection("conversations").doc(params.conversationId);
    const messagesCol = convRef.collection("messages");
    const messageDocRef = messagesCol.doc();

    const result = await this.db.runTransaction(async (tx) => {
      const convSnap = await tx.get(convRef);
      if (!convSnap.exists) {
        throw new Error(`Conversation not found: ${params.conversationId}`);
      }

      const convData = convSnap.data()!;
      const currentCount = (convData.messageCount || 0) as number;
      const nextSequence = currentCount + 1;
      const now = Timestamp.now();

      const messageData: Record<string, any> = {
        role: params.role,
        content: params.content,
        sequence: nextSequence,
        status: params.status || "completed",
        createdAt: now
      };

      if (params.provider) messageData.provider = params.provider;
      if (params.model) messageData.model = params.model;
      if (params.finishReason) messageData.finishReason = params.finishReason;

      tx.set(messageDocRef, messageData);

      // If this is the very first user message, deterministically set conversation title
      const updatePayload: Record<string, any> = {
        messageCount: nextSequence,
        updatedAt: now,
        lastMessageAt: now
      };

      if (
        nextSequence === 1 &&
        params.role === "user" &&
        (!convData.title || convData.title === CONVERSATION_CONFIG.DEFAULT_CONVERSATION_TITLE)
      ) {
        updatePayload.title = generateDeterministicTitle(params.content);
      }

      tx.update(convRef, updatePayload);

      return {
        id: messageDocRef.id,
        role: params.role,
        content: params.content,
        sequence: nextSequence,
        status: params.status || "completed",
        createdAt: now.toDate(),
        provider: params.provider,
        model: params.model,
        finishReason: params.finishReason
      };
    });

    return result;
  }

  /**
   * Updates an existing message in-place.
   */
  async updateMessage(params: UpdateMessageParams): Promise<void> {
    const msgRef = this.db
      .collection("conversations")
      .doc(params.conversationId)
      .collection("messages")
      .doc(params.messageId);

    const updateData: Record<string, any> = {};
    if (params.content !== undefined) updateData.content = params.content;
    if (params.status !== undefined) updateData.status = params.status;
    if (params.finishReason !== undefined) updateData.finishReason = params.finishReason;
    if (params.provider !== undefined) updateData.provider = params.provider;
    if (params.model !== undefined) updateData.model = params.model;

    if (Object.keys(updateData).length > 0) {
      await msgRef.update(updateData);
    }
  }

  /**
   * Retrieves messages for a conversation, ordered chronologically by sequence.
   * If limit is specified, returns the most recent N messages in chronological order.
   */
  async getMessages(
    conversationId: string,
    options?: GetHistoryOptions
  ): Promise<ConversationMessageDocument[]> {
    const messagesCol = this.db
      .collection("conversations")
      .doc(conversationId)
      .collection("messages");

    const limit = options?.limit || CONVERSATION_CONFIG.MAX_CONTEXT_MESSAGES;

    // To get the latest N messages, we query descending by sequence, then reverse
    let query = messagesCol.orderBy("sequence", "desc");
    if (options?.beforeSequence !== undefined) {
      query = query.where("sequence", "<", options.beforeSequence);
    }

    const snapshot = await query.limit(limit).get();

    if (snapshot.empty) {
      return [];
    }

    const messages: ConversationMessageDocument[] = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      messages.push({
        id: doc.id,
        role: data.role,
        content: data.content,
        sequence: data.sequence,
        status: data.status,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
        provider: data.provider,
        model: data.model,
        finishReason: data.finishReason
      });
    }

    // Return in ascending chronological order (oldest to newest)
    return messages.reverse();
  }

  /**
   * Lists conversations for a specific user, ordered by lastMessageAt descending.
   */
  async listConversations(userId: string, limit: number = 20): Promise<ConversationDocument[]> {
    const snapshot = await this.db
      .collection("conversations")
      .where("userId", "==", userId)
      .orderBy("lastMessageAt", "desc")
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        userId: data.userId,
        title: data.title || CONVERSATION_CONFIG.DEFAULT_CONVERSATION_TITLE,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
        updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : new Date(),
        lastMessageAt: data.lastMessageAt?.toDate ? data.lastMessageAt.toDate() : new Date(),
        messageCount: data.messageCount || 0
      };
    });
  }
}

let defaultRepoInstance: FirestoreConversationRepository | null = null;

/**
 * Returns the default Firestore conversation repository instance lazily.
 */
export function getDefaultConversationRepository(): FirestoreConversationRepository {
  if (!defaultRepoInstance) {
    defaultRepoInstance = new FirestoreConversationRepository();
  }
  return defaultRepoInstance;
}

