// 计算余弦相似度
export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length !== b.length) {
    throw new Error('向量长度不一致');
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (normA * normB);
}
