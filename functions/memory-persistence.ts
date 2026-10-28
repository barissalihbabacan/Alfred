// Uzun sureli bellek kaliciligi: extractAndPersistMemories (memory-extraction.ts)
// cikarim modelinin adaylarini buraya verir. Aday dongusu (dogrulama, gizli
// bilgi filtresi, embedding, aktif bellekleri yeniden okuma, forget /
// duplicate / supersede / create karari, sayaclar) src/ ile ortak:
// src/alfred/cognitive/memory/memory-write-loop.ts (+ memory-write-planner.ts);
// MemoryService de ayni donguyu kullanir. Burada yalnizca depolama katmani
// kalir: Firestore okuma/yazma ve loglama. Firebase bagimliliklari (db,
// logger, Timestamp) parametre olarak gelir; boylece
// tests/unit/memory-write-planner.test.ts bu dosyayi dogrudan calistirip eski
// kodun birebir kopyalariyla karsilastirabilir.
//
// Loglar bellek metnini ICERMEZ (kullanici metni loglanmaz): yalnizca
// memory_id, memory_type ve content_length. Supersede tek bir Firestore
// batch'i ile yazilir: eski kaydin "superseded" isaretlenmesi ile yeni kayit
// birlikte commit edilir, ya ikisi ya hicbiri. (MemoryService bunu yapamaz:
// depo ve vektor deposu ayri sistemler; bkz. memory-write-loop.ts.)
import {
  buildMemoryRetractionUpdate,
  buildMemorySupersessionUpdate,
  buildMemoryVectorRecord,
  generateMemoryId,
  type MemoryWriteTally
} from "../src/alfred/cognitive/memory/memory-write-planner.js";
import type { MemoryType } from "../src/data/firestore/memory.types.js";
import { runMemoryWriteLoop } from "../src/alfred/cognitive/memory/memory-write-loop.js";

interface DocRecord {
  id: string;
  ref: {
    update: (data: unknown) => Promise<unknown>;
  };
  data: () => Record<string, unknown> | undefined;
}

interface FirestoreLike {
  collection: (name: string) => {
    where: (field: string, op: string, value: unknown) => {
      where: (field: string, op: string, value: unknown) => {
        get: () => Promise<{ docs: DocRecord[] }>;
      };
      get: () => Promise<{ docs: DocRecord[] }>;
    };
    doc: (id: string) => {
      set: (data: unknown) => Promise<unknown>;
    };
  };
  batch: () => {
    update: (ref: unknown, data: unknown) => void;
    set: (ref: unknown, data: unknown) => void;
    commit: () => Promise<unknown>;
  };
}

// Aktif bellekler her aday icin yeniden okunur: ayni turda once yazilan,
// supersede ya da retract edilen kayit sonraki adayin kararina yansir.
async function readActiveMemories(db: FirestoreLike, userId: string, projectId?: string | null) {
  const snap = await db.collection("memory_vectors")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .get();
  if (projectId === undefined) return snap.docs;
  const targetProject = projectId || null;
  return snap.docs.filter((doc) => (doc.data()?.projectId || null) === targetProject);
}

const docData = (doc: DocRecord) => (doc.data() || {}) as Record<string, unknown>;

export interface PersistMemoryCandidatesParams {
  db: unknown;
  memories: unknown[];
  userId: string;
  projectId?: string | null;
  conversationId: string;
  sourceMessageIds?: string[];
  embed: (text: string) => Promise<{ values: number[]; model: string }>;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
  now: () => unknown;
  errMessage: (err: unknown) => string;
  tally: MemoryWriteTally;
  [key: string]: unknown;
}

/**
 * Adaylari sirayla isler ve `tally` sayaclarini gunceller.
 */
export async function persistMemoryCandidates({
  db: rawDb,
  memories,
  userId,
  projectId,
  conversationId,
  sourceMessageIds,
  embed,
  logger,
  now,
  errMessage,
  tally
}: PersistMemoryCandidatesParams): Promise<void> {
  const db = rawDb as FirestoreLike;
  await runMemoryWriteLoop({
    candidates: memories,
    tally,
    ports: {
      embed,
      readActive: () => readActiveMemories(db, userId, projectId),
      recordOf: docData,

      async retract(target) {
        await target.ref.update(buildMemoryRetractionUpdate(now()));
        const retracted = target.data() || {};
        logger.info(`[Memory] Retracted memory ${target.id}`, {
          memory_id: target.id,
          memory_type: retracted.memoryType ?? null,
          content_length: typeof retracted.content === "string" ? retracted.content.length : 0
        });
      },

      async store({ candidate, embedding, supersedeTarget }) {
        const memoryId = generateMemoryId();
        const timestamp = now();
        const newRef = db.collection("memory_vectors").doc(memoryId);
        const record = buildMemoryVectorRecord({
          memoryId,
          userId,
          content: candidate.content,
          memoryType: candidate.memoryType as MemoryType,
          ...(projectId ? { projectId } : {}),
          sourceConversationId: conversationId,
          sourceMessageIds,
          embedding,
          supersedesMemoryId: supersedeTarget ? supersedeTarget.id : null,
          now: timestamp
        });

        if (supersedeTarget) {
          // Tek batch: eski kaydi "superseded" isaretle + yeni kaydi yaz. Commit
          // basarisiz olursa ikisi de yazilmaz; eski bilgi kaybolmaz.
          const batch = db.batch();
          batch.update(supersedeTarget.ref, buildMemorySupersessionUpdate(memoryId, timestamp));
          batch.set(newRef, record);
          await batch.commit();
          logger.info(`[Memory] Superseded memory ${supersedeTarget.id} with ${memoryId}`);
        } else {
          await newRef.set(record);
        }

        logger.info("[Memory] Stored long-term memory in Firestore", {
          memory_id: memoryId,
          memory_type: candidate.memoryType,
          content_length: candidate.content.length
        });
      }
    },
    hooks: {
      onRejected(candidate) {
        // Aday gizli bilgi iceriyor: icerigi loglamak onu sizdirmak olur.
        logger.warn("[Memory] Candidate rejected due to sensitive data policy.", {
          memory_type: candidate.memoryType
        });
      },
      onDuplicate(candidate, plan) {
        logger.info("[Memory] Suppressed duplicate memory", {
          memory_id: plan.target.id,
          memory_type: candidate.memoryType,
          content_length: candidate.content.length,
          match: plan.match,
          score: plan.score
        });
      },
      onFailed(candidate, err, stage) {
        logger.warn(stage === "forget"
          ? `[Memory] Retraction failed: ${errMessage(err)}`
          : `[Memory] Failed to save memory candidate: ${errMessage(err)}`);
      }
    }
  });
}
