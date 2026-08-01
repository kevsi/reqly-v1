export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function topByScore<T>(items: T[], scores: number[], k: number): Array<{ item: T; score: number }> {
  const indexed = items.map((item, i) => ({ item, score: scores[i] }));
  indexed.sort((a, b) => b.score - a.score);
  return indexed.slice(0, k);
}
