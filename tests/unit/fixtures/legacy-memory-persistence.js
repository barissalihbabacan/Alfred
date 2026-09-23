// Verbatim copy of the memory persistence part of extractAndPersistMemories
// in functions/index.js as of origin/main ae21d49, before the decision logic
// moved to src/alfred/cognitive/memory/memory-write-planner.ts. Do not edit:
// tests/unit/memory-write-planner.test.ts runs it side by side with
// functions/memory-persistence.js to prove the refactor changed nothing.
//
// Only the wrapper is new: the free variables of the original (Firebase's db,
// logger and Timestamp, getEmbedding, errMessage, the turn's inputs) come in as
// parameters, and the tally/summary are returned instead of the summary alone.
import { cosineSimilarity } from "../../../src/data/vector/cosine-similarity.js";
import { validateMemoryCandidate } from "../../../src/ai/prompts/memory-extraction.js";
import {
  GEMINI_EMBEDDING_MODEL,
  isComparableEmbedding
} from "../../../src/ai/embedding/embedding-client.js";
import { PrivacyFilter } from "../../../src/alfred/cognitive/memory/privacy-filter.js";

export async function legacyPersistMemories({
  db,
  logger,
  Timestamp,
  getEmbedding,
  errMessage,
  ollamaUrl,
  geminiKey,
  memories,
  userId,
  conversationId,
  sourceMessageIds,
  extractorProvider
}) {
  // Aday basina sonuc sayaclari; memory_extraction olayi icin dondurulur.
  // rejected: gizli bilgi filtresi; invalid: validateMemoryCandidate reddetti.
  const tally = { stored: 0, superseded: 0, retracted: 0, duplicate: 0, rejected: 0, invalid: 0, failed: 0 };
  const summarize = (fallbackOutcome) => {
    const outcome = tally.superseded ? "superseded"
      : tally.stored ? "stored"
        : tally.retracted ? "retracted"
          : tally.duplicate ? "duplicate"
            : tally.failed ? "failed"
              : fallbackOutcome;
    return {
      outcome,
      count: tally.stored + tally.retracted,
      extractor_provider: extractorProvider,
      ...tally
    };
  };

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
        const queryEmbedding = await getEmbedding(content, ollamaUrl, geminiKey);
        const memSnap = await db.collection("memory_vectors")
          .where("userId", "==", userId)
          .where("status", "==", "active")
          .get();

        let bestMatch = null;
        let bestScore = 0;
        for (const doc of memSnap.docs) {
          const d = doc.data();
          if (isComparableEmbedding(d, queryEmbedding.model)) {
            const score = cosineSimilarity(queryEmbedding.values, d.embedding);
            if (score > bestScore) {
              bestScore = score;
              bestMatch = doc;
            }
          }
        }

        if (bestMatch && bestScore >= 0.5) {
          await bestMatch.ref.update({
            status: "retracted",
            updatedAt: Timestamp.now()
          });
          logger.info(`[Memory] Retracted memory ${bestMatch.id} ("${bestMatch.data().content}")`);
          tally.retracted++;
        }
      } catch (forgetErr) {
        logger.warn(`[Memory] Retraction failed: ${errMessage(forgetErr)}`);
        tally.failed++;
      }
      continue;
    }

    try {
      const embedding = await getEmbedding(content, ollamaUrl, geminiKey);
      const activeSnap = await db.collection("memory_vectors")
        .where("userId", "==", userId)
        .where("status", "==", "active")
        .get();

      let isDuplicate = false;
      let supersedeTargetDoc = null;

      for (const doc of activeSnap.docs) {
        const d = doc.data();
        if (isComparableEmbedding(d, embedding.model)) {
          const score = cosineSimilarity(embedding.values, d.embedding);
          if (action === "create" && score >= 0.85) {
            isDuplicate = true;
            logger.info(`[Memory] Suppressed duplicate memory: "${content}" (score: ${score})`);
            break;
          }
          if (action === "supersede" && score >= 0.5 && !supersedeTargetDoc) {
            supersedeTargetDoc = doc;
          }
        }
      }

      if (isDuplicate) {
        tally.duplicate++;
        continue;
      }

      const memoryId = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const now = Timestamp.now();

      if (action === "supersede" && supersedeTargetDoc) {
        await supersedeTargetDoc.ref.update({
          status: "superseded",
          supersededByMemoryId: memoryId,
          updatedAt: now
        });
        logger.info(`[Memory] Superseded memory ${supersedeTargetDoc.id} with ${memoryId}`);
      }

      await db.collection("memory_vectors").doc(memoryId).set({
        memoryId,
        userId,
        content,
        memoryType: validated.memoryType,
        sourceConversationId: conversationId,
        sourceMessageIds: sourceMessageIds || [],
        embeddingProvider: embedding.model === GEMINI_EMBEDDING_MODEL ? "gemini" : "ollama",
        embeddingModel: embedding.model,
        embeddingDimension: embedding.values.length,
        embedding: embedding.values,
        vectorStore: "firestore",
        vectorId: `vec_${memoryId}`,
        status: "active",
        supersedesMemoryId: supersedeTargetDoc ? supersedeTargetDoc.id : null,
        indexStatus: "indexed",
        createdAt: now,
        updatedAt: now,
        indexedAt: now
      });

      logger.info(`[Memory] Stored long-term memory in Firestore: "${content}" (${validated.memoryType})`);
      tally.stored++;
      if (action === "supersede" && supersedeTargetDoc) tally.superseded++;
    } catch (saveErr) {
      logger.warn(`[Memory] Failed to save memory candidate: ${errMessage(saveErr)}`);
      tally.failed++;
    }
  }

  return { tally, summary: summarize("nothing") };
}
