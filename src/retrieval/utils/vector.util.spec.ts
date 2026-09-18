import { cosineSimilarity } from './vector.util.js';

/**
 * 纯函数单测：不需要起 Nest 应用、不需要数据库、不需要 mock 外部依赖。
 * 毫秒级返回，可以放心在 watch 模式下一直跑。
 */
describe('cosineSimilarity', () => {
  it('相同向量返回 1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
  });

  it('正交向量返回 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it('方向相反返回 -1', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('只关心方向，与向量长度无关', () => {
    // 点积是 2、模长乘积也是 2 —— 如果哪天有人把实现「优化」成纯点积，
    // 这里会得到 2 而不是 1，立刻红
    expect(cosineSimilarity([1, 1], [1, 1])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 1], [100, 100])).toBeCloseTo(1);
  });

  it('零向量返回 0，而不是 NaN', () => {
    const a = cosineSimilarity([0, 0], [1, 0]);
    expect(a).toBe(0);
    expect(Number.isNaN(a)).toBe(false);

    const b = cosineSimilarity([1, 1], [0, 0]);
    expect(b).toBe(0);
    expect(Number.isNaN(b)).toBe(false);
  });

  it('两边都是零向量也返回 0', () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it('维度不一致时抛错，而不是算出个静默错误的值', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });

  it('结果落在 [-1, 1] 区间（允许浮点误差）', () => {
    // 这里必须留 epsilon：sqrt 是有理逼近，`dot / (normA * normB)` 可能算出
    // -1.0000000000000002 这种值。这不是实现的问题 —— 任何余弦实现都这样。
    // 所以任何依赖「分数严格 ≤ 1」的代码（比如把它当归一化值用）都是错的。
    const EPS = 1e-12;

    const cases: [number[], number[]][] = [
      [[0.3, -0.7, 1.2], [0.9, 0.1, -0.4]],
      [[-1, -1, -1], [-1, -1, -1]],
      [[1, 0, 0, 0], [0, 0, 0, 1]],
      [[2.5, -3.5], [-2.5, 3.5]],
    ];

    for (const [a, b] of cases) {
      const score = cosineSimilarity(a, b);
      expect(score).toBeGreaterThanOrEqual(-1 - EPS);
      expect(score).toBeLessThanOrEqual(1 + EPS);
    }
  });
});
