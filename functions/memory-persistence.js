// Uzun sureli bellek kaliciligi: extractAndPersistMemories (index.js) cikarim
// modelinin adaylarini buraya verir. Karar mantigi (forget / duplicate /
// supersede / create, esikler, kayit alanlari) src/ ile ortak:
// src/alfred/cognitive/memory/memory-write-planner.ts. Burada yalnizca G/C
// kalir: Firestore okuma/yazma, embedding cagrisi ve loglama. Firebase
// bagimliliklari (db, logger, Timestamp) parametre olarak gelir; boylece
// tests/unit/memory-write-planner.test.ts bu dosyayi dogrudan calistirip eski
// satir ici dongunun birebir kopyasiyla karsilastirabilir.
//
// Loglar bellek metnini ICERMEZ (kullanici metni loglanmaz): yalnizca
// memory_id, memory_type ve content_length. Supersede tek bir Firestore
// batch'i ile yazilir: eski kaydin "superseded" isaretlenmesi ile yeni kayit
// birlikte commit edilir, ya ikisi ya hicbiri.
import {
  buildMemoryRetractionUpdate,
  buildMemorySupersessionUpdate,
  buildMemoryVectorRecord,
  generateMemoryId,
  planMemoryWrite
} from "../src/alfred/cognitive/memory/memory-write-planner.js";
import { validateMemoryCandidate } from "../src/ai/prompts/memory-extraction.js";
import { PrivacyFilter } from "../src/alfred/cognitive/memory/privacy-filter.js";

// Aktif bellekler her aday icin yeniden okunur: ayni turda once yazilan,
// supersede ya da retract edilen kayit sonraki adayin kararina yansir.
async function readActiveMemories(db, userId) {
  const snap = await db.collection("memory_vectors")
    .where("userId", "==", userId)
    .where("status", "==", "active")
    .get();
  return snap.docs;
}

const docData = (doc) => doc.data();

/**
 * Adaylari sirayla isler ve `tally` sayaclarini gunceller.
 *
 * @param {object} p
 * @param {object} p.db Firestore (collection/where/get/doc/set, doc.ref.update)
 * @param {unknown[]} p.memories cikarim modelinin ham adaylari
 * @param {string} p.userId
 * @param {string} p.conversationId
 * @param {string[]} [p.sourceMessageIds]
 * @param {(text: string) => Promise<{ values: number[], model: string }>} p.embed
 * @param {{ info: Function, warn: Function }} p.logger
 * @param {() => unknown} p.now sunucu zaman damgasi (Timestamp.now)
 * @param {(err: unknown) => string} p.errMessage
 * @param {import("../src/alfred/cognitive/memory/memory-write-planner.js").MemoryWriteTally} p.tally
 */
export async function persistMemoryCandidates({
  db,
  memories,
  userId,
  conversationId,
  sourceMessageIds,
  embed,
  logger,
  now,
  errMessage,
  tally
}) {
  for (const candidate of memories) {
    // Aday dogrulamasi src/ ile ortak (validateMemoryCandidate): nesne olmayan
    // aday, icerik, uzunluk ve guven esigi; action ve memoryType istemdeki
    // degerlere normalize edilir. Gecersiz aday atlanir, liste devam eder.
    const validated = validateMemoryCandidate(candidate);
    if (!validated) {
      tally.invalid++;
      continue;
    }
    const content = validated.content;

    // Gizli bilgi filtresi src/ ile ortak (PrivacyFilter); bkz. privacy-filter.ts.
    if (!PrivacyFilter.check(content).isSafe) {
      // Aday gizli bilgi iceriyor: icerigi loglamak onu sizdirmak olur.
      logger.warn("[Memory] Candidate rejected due to sensitive data policy.", {
        memory_type: validated.memoryType
      });
      tally.rejected++;
      continue;
    }

    const action = validated.action;

    if (action === "forget") {
      try {
        const queryEmbedding = await embed(content);
        const activeDocs = await readActiveMemories(db, userId);
        const plan = planMemoryWrite({
          action,
          content,
          embedding: queryEmbedding,
          activeMemories: activeDocs,
          recordOf: docData
        });

        if (plan.kind === "retract") {
          const target = plan.target;
          await target.ref.update(buildMemoryRetractionUpdate(now()));
          const retracted = target.data() || {};
          logger.info(`[Memory] Retracted memory ${target.id}`, {
            memory_id: target.id,
            memory_type: retracted.memoryType ?? null,
            content_length: typeof retracted.content === "string" ? retracted.content.length : 0
          });
          tally.retracted++;
        }
      } catch (forgetErr) {
        logger.warn(`[Memory] Retraction failed: ${errMessage(forgetErr)}`);
        tally.failed++;
      }
      continue;
    }

    try {
      const embedding = await embed(content);
      const activeDocs = await readActiveMemories(db, userId);
      const plan = planMemoryWrite({
        action,
        content,
        embedding,
        activeMemories: activeDocs,
        recordOf: docData
      });

      if (plan.kind === "skipDuplicate") {
        logger.info("[Memory] Suppressed duplicate memory", {
          memory_id: plan.target.id,
          memory_type: validated.memoryType,
          content_length: content.length,
          match: plan.match,
          score: plan.score
        });
        tally.duplicate++;
        continue;
      }

      const supersedeTargetDoc = plan.kind === "supersede" ? plan.target : null;
      const memoryId = generateMemoryId();
      const timestamp = now();
      const newRef = db.collection("memory_vectors").doc(memoryId);
      const record = buildMemoryVectorRecord({
        memoryId,
        userId,
        content,
        memoryType: validated.memoryType,
        sourceConversationId: conversationId,
        sourceMessageIds,
        embedding,
        supersedesMemoryId: supersedeTargetDoc ? supersedeTargetDoc.id : null,
        now: timestamp
      });

      if (supersedeTargetDoc) {
        // Tek batch: eski kaydi "superseded" isaretle + yeni kaydi yaz. Commit
        // basarisiz olursa ikisi de yazilmaz; eski bilgi kaybolmaz.
        const batch = db.batch();
        batch.update(supersedeTargetDoc.ref, buildMemorySupersessionUpdate(memoryId, timestamp));
        batch.set(newRef, record);
        await batch.commit();
        logger.info(`[Memory] Superseded memory ${supersedeTargetDoc.id} with ${memoryId}`);
      } else {
        await newRef.set(record);
      }

      logger.info("[Memory] Stored long-term memory in Firestore", {
        memory_id: memoryId,
        memory_type: validated.memoryType,
        content_length: content.length
      });
      tally.stored++;
      if (supersedeTargetDoc) tally.superseded++;
    } catch (saveErr) {
      logger.warn(`[Memory] Failed to save memory candidate: ${errMessage(saveErr)}`);
      tally.failed++;
    }
  }
}
