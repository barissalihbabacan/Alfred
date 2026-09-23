/**
 * Vector similarity math utilities for B.U.T.L.E.R. Alfred
 *
 * Shared with the production backend: functions/index.js bundles this module
 * via esbuild (see functions/build.js). Changes here ship to Cloud Functions.
 */

/**
 * Computes cosine similarity between two numeric vectors.
 * Returns a value between -1.0 and 1.0 (or 0.0 to 1.0 for positive embeddings).
 *
 * Returns 0 when either input is missing, not an array, empty, or when the two
 * vectors have different lengths. Vectors of different dimensions come from
 * different embedding spaces (or a different `outputDimensionality`), so
 * comparing a truncated prefix would produce a meaningless score.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  const similarity = dotProduct / denominator;
  // Clamp between -1 and 1 against floating point precision errors
  return Math.max(-1, Math.min(1, similarity));
}
