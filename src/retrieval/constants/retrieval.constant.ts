export const RETRIEVAL_TOP_K = 3;

/**
 * 检索命中阈值。
 *
 * 实测依据（2026-09-19 / embedding-3 / 2048 维 / 中文政策类文档 4 份 9 块）：
 *   无关查询最高分 0.2475，相关查询最低分 0.4257
 *   取 0.35 落在两者之间，两侧均有余量
 *
 * ⚠️ 换 embedding 模型或换语种后必须重新测
 *    （跑 `pnpm test:e2e -- test/retrieval.manual.e2e-spec.ts`）
 */
export const DEFAULT_THRESHOLD = 0.35;
