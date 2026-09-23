import { Firestore, Timestamp } from "firebase-admin/firestore";
import { getFirestoreDb } from "./firestore-conversation-repository.js";
import {
  IMemoryRepository,
  MEMORY_PERSISTENCE_CONFIG
} from "./memory-repository.interface.js";
import {
  MemoryVectorDocument,
  CreateMemoryRecordParams,
  UpdateMemoryIndexStatusParams,
  UpdateMemoryStatusParams,
  ListMemoriesOptions
} from "./memory.types.js";

/**
 * Helper to convert Firestore Timestamps to ISO string dates.
 */
function toIsoDate(val: any): string {
  if (!val) return new Date().toISOString();
  if (typeof val.toDate === "function") {
    return val.toDate().toISOString();
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  return String(val);
}

/**
 * FirestoreMemoryRepository
 *
 * Implements historical memory and vector metadata persistence on Google Cloud Firestore:
 * - Collection: memory_vectors/{memoryVectorId}
 * - Preserves metadata and canonical memory content necessary to rebuild vector index.
 */
export class FirestoreMemoryRepository implements IMemoryRepository {
  private db: Firestore;
  private collectionName = MEMORY_PERSISTENCE_CONFIG.COLLECTION_NAME;

  constructor(customDb?: Firestore) {
    this.db = customDb || getFirestoreDb();
  }

  public async createMemoryRecord(params: CreateMemoryRecordParams): Promise<MemoryVectorDocument> {
    if (!params.userId || !params.userId.trim()) {
      throw new Error("[FirestoreMemoryRepository] userId is required.");
    }
    if (!params.content || !params.content.trim()) {
      throw new Error("[FirestoreMemoryRepository] content cannot be empty.");
    }

    const collectionRef = this.db.collection(this.collectionName);
    const docRef = params.memoryId ? collectionRef.doc(params.memoryId) : collectionRef.doc();
    const id = docRef.id;
    const memoryId = params.memoryId || id;
    const vectorId = params.vectorId || `vec_${id}`;
    const now = Timestamp.now();

    const data: Record<string, any> = {
      memoryId,
      userId: params.userId,
      content: params.content.trim(),
      memoryType: params.memoryType || "general",
      sourceConversationId: params.sourceConversationId || null,
      sourceMessageIds: params.sourceMessageIds || [],
      embeddingProvider: params.embeddingProvider,
      embeddingModel: params.embeddingModel,
      embeddingDimension: params.embeddingDimension,
      embedding: params.embedding || null,
      vectorStore: params.vectorStore,
      vectorId,
      status: params.status || "active",
      supersedesMemoryId: params.supersedesMemoryId || null,
      supersededByMemoryId: params.supersededByMemoryId || null,
      indexStatus: params.indexStatus || "pending",
      createdAt: now,
      updatedAt: now
    };

    await docRef.set(data);

    return {
      id,
      memoryId,
      userId: params.userId,
      content: params.content.trim(),
      memoryType: params.memoryType || "general",
      sourceConversationId: params.sourceConversationId,
      sourceMessageIds: params.sourceMessageIds,
      embeddingProvider: params.embeddingProvider,
      embeddingModel: params.embeddingModel,
      embeddingDimension: params.embeddingDimension,
      embedding: params.embedding,
      vectorStore: params.vectorStore,
      vectorId,
      status: params.status || "active",
      supersedesMemoryId: params.supersedesMemoryId,
      supersededByMemoryId: params.supersededByMemoryId,
      indexStatus: params.indexStatus || "pending",
      createdAt: toIsoDate(now),
      updatedAt: toIsoDate(now)
    };
  }

  private toMemoryDoc(id: string, data: Record<string, any>): MemoryVectorDocument {
    return {
      id,
      memoryId: data.memoryId || id,
      userId: data.userId,
      content: data.content,
      memoryType: data.memoryType || "general",
      sourceConversationId: data.sourceConversationId || undefined,
      sourceMessageIds: data.sourceMessageIds || undefined,
      embeddingProvider: data.embeddingProvider,
      embeddingModel: data.embeddingModel,
      embeddingDimension: data.embeddingDimension,
      embedding: Array.isArray(data.embedding) ? data.embedding : undefined,
      vectorStore: data.vectorStore,
      vectorId: data.vectorId,
      status: data.status,
      supersedesMemoryId: data.supersedesMemoryId || undefined,
      supersededByMemoryId: data.supersededByMemoryId || undefined,
      indexStatus: data.indexStatus,
      lastError: data.lastError || undefined,
      createdAt: toIsoDate(data.createdAt),
      updatedAt: toIsoDate(data.updatedAt),
      indexedAt: data.indexedAt ? toIsoDate(data.indexedAt) : undefined
    };
  }

  public async getMemoryRecord(id: string): Promise<MemoryVectorDocument | null> {
    const docRef = this.db.collection(this.collectionName).doc(id);
    const snap = await docRef.get();
    if (!snap.exists) {
      return null;
    }

    return this.toMemoryDoc(snap.id, snap.data()!);
  }

  public async getMemoryRecordByMemoryId(memoryId: string): Promise<MemoryVectorDocument | null> {
    const query = await this.db
      .collection(this.collectionName)
      .where("memoryId", "==", memoryId)
      .limit(1)
      .get();

    if (query.empty || !query.docs[0]) {
      return null;
    }

    const snap = query.docs[0];
    return this.toMemoryDoc(snap.id, snap.data());
  }

  public async updateIndexStatus(params: UpdateMemoryIndexStatusParams): Promise<void> {
    const docRef = this.db.collection(this.collectionName).doc(params.id);
    const updates: Record<string, any> = {
      indexStatus: params.indexStatus,
      updatedAt: Timestamp.now()
    };

    if (params.indexedAt) {
      updates.indexedAt = Timestamp.fromDate(new Date(params.indexedAt));
    }
    if (params.lastError !== undefined) {
      updates.lastError = params.lastError;
    }

    await docRef.update(updates);
  }

  public async updateMemoryStatus(params: UpdateMemoryStatusParams): Promise<void> {
    const docRef = this.db.collection(this.collectionName).doc(params.id);
    const updates: Record<string, any> = {
      status: params.status,
      updatedAt: Timestamp.now()
    };
    if (params.supersededByMemoryId) {
      updates.supersededByMemoryId = params.supersededByMemoryId;
    }
    await docRef.update(updates);
  }

  public async listMemories(options: ListMemoriesOptions): Promise<MemoryVectorDocument[]> {
    let query: FirebaseFirestore.Query = this.db
      .collection(this.collectionName)
      .where("userId", "==", options.userId);

    if (options.status) {
      query = query.where("status", "==", options.status);
    }
    if (options.indexStatus) {
      query = query.where("indexStatus", "==", options.indexStatus);
    }
    if (options.memoryType) {
      query = query.where("memoryType", "==", options.memoryType);
    }

    query = query.limit(options.limit || MEMORY_PERSISTENCE_CONFIG.DEFAULT_LIST_LIMIT);

    const snap = await query.get();
    return snap.docs.map((d) => this.toMemoryDoc(d.id, d.data()));
  }

  public async listAllActive(userId?: string): Promise<MemoryVectorDocument[]> {
    let query: FirebaseFirestore.Query = this.db
      .collection(this.collectionName)
      .where("status", "==", "active");

    if (userId) {
      query = query.where("userId", "==", userId);
    }

    const snap = await query.get();
    return snap.docs.map((d) => this.toMemoryDoc(d.id, d.data()));
  }

  public async deleteMemoryRecord(id: string): Promise<void> {
    await this.db.collection(this.collectionName).doc(id).delete();
  }
}
