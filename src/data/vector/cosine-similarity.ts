/**
 * Vector similarity math utilities for B.U.T.L.E.R. Alfred
 */

/**
 * Computes cosine similarity between two numeric vectors.
 * Returns a value between -1.0 and 1.0 (or 0.0 to 1.0 for positive embeddings).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) {
    return 0;
  }

  const length = Math.min(a.length, b.length);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < length; i++) {
    const valA = a[i]!;
    const valB = b[i]!;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  // Clamp between -1 and 1 against floating point precision errors
  return Math.max(-1, Math.min(1, similarity));
}
