import type { INestApplication } from '@nestjs/common';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chunkText } from '../src/document/pipeline/text-chunker.js';
import { LlmService } from '../src/llm/llm.service.js';
import { cosineSimilarity } from '../src/retrieval/utils/vector.util.js';
import { createTestApp } from './utils/create-test-app.js';

/**
 * 手动验证：用真实模型测「相关 / 不相关」查询的余弦分数分布，
 * 用来给 RetrievalService 的 DEFAULT_THRESHOLD 定一个**有依据**的值。
 *
 * 跑法（PowerShell）：
 *   $env:RUN_REAL_LLM=1
 *   pnpm test:e2e -- test/retrieval.manual.e2e-spec.ts
 *
 * 默认使用仓库内的夹具文档（test/fixtures/docs）。
 * 想换成自己的语料时再指定目录：
 *   $env:MANUAL_DOCS_DIR="C:\path\to\docs"
 *
 * 为什么必须手动跑：
 *   - 自动化测试里 LlmService 是假的，分数只有 1 和 0，**阈值这条路径永远验证不到**
 *   - 真实调用要联网、要花钱、分数还会随模型版本漂移
 *
 * 输出怎么读：
 *   看最后一行的「建议阈值区间」—— 取在「无关查询最高分」和「相关查询最低分」之间。
 */
const DOCS_DIR =
  process.env.MANUAL_DOCS_DIR ?? join(process.cwd(), 'test/fixtures/docs');
const enabled = process.env.RUN_REAL_LLM === '1';

/** 与 pipeline 保持一致：一批 16 条 */
const EMBED_BATCH = 16;

/**
 * 每份文档生成几个问题。
 *
 * 不能只生成 1 个：实测两次跑出来的「相关查询最低分」差了 0.08
 * （0.4257 vs 0.5017）—— 因为无关查询是固定字符串所以很稳，
 * 而相关查询由模型现场生成（temperature 0.7），每次措辞都不同。
 * 样本太少会把阈值定偏，这里多采几条取最坏情况。
 */
const QUESTIONS_PER_DOC = 3;

/** 完全不相关的问题，用来测「阈值该挡在哪」 */
const IRRELEVANT_QUERIES = [
  '怎么做法式红酒炖牛肉',
  '下一届世界杯在哪个国家举办',
  '请解释一下量子纠缠现象',
];

describe.skipIf(!enabled)('检索阈值验证（需 RUN_REAL_LLM=1）', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('打印真实分数分布，给出阈值建议', async () => {
    const llm = app.get(LlmService);

    // ---------- 1. 读文档 + 分块 ----------
    const files = (await readdir(DOCS_DIR)).filter((f) =>
      /\.(md|txt)$/i.test(f),
    );
    const docs = await Promise.all(
      files.map(async (name) => {
        const content = await readFile(join(DOCS_DIR, name), 'utf8');
        return { name, content, chunks: chunkText(content) };
      }),
    );

    const allChunks = docs.flatMap((doc) =>
      doc.chunks.map((content) => ({ doc: doc.name, content })),
    );

    console.log(
      `\n文档 ${docs.length} 份 / 共 ${allChunks.length} 块 ` +
        `(${docs.map((d) => `${d.name}=${d.chunks.length}`).join(', ')})`,
    );

    // ---------- 2. 向量化所有 chunk ----------
    const chunkVectors: number[][] = [];
    for (let i = 0; i < allChunks.length; i += EMBED_BATCH) {
      const batch = allChunks.slice(i, i + EMBED_BATCH);
      chunkVectors.push(...(await llm.embed(batch.map((c) => c.content))));
    }

    // ---------- 3. 向量是否已 L2 归一化 ----------
    // 如果范数都是 1，点积就等于余弦；不过这不该被「假设」，
    // 我们的实现本来就除了模长，这里只是确认一下。
    const norms = chunkVectors.map((v) =>
      Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)),
    );
    console.log(
      `向量维度 ${chunkVectors[0].length}，范数 min=${Math.min(...norms).toFixed(6)} ` +
        `max=${Math.max(...norms).toFixed(6)}`,
    );

    // ---------- 4. 让模型给每份文档生成「用户会问的问题」 ----------
    // 比直接拿原文当查询更接近真实场景：真实查询不会和原文逐字重合。
    const relevantQueries: { label: string; query: string }[] = [];
    for (const doc of docs) {
      for (let k = 0; k < QUESTIONS_PER_DOC; k++) {
        const query = await llm.chat([
          {
            role: 'system',
            content:
              '你是一个文档使用者。请根据给定文档提出一个你会向这个知识库提出的问题。' +
              '只输出问题本身，不要任何解释或前缀。',
          },
          { role: 'user', content: doc.content.slice(0, 2000) },
        ]);
        relevantQueries.push({
          label: doc.name,
          query: query.trim().replace(/\n/g, ' '),
        });
      }
    }

    // ---------- 5. 全部查询一次向量化 ----------
    const queries = [
      ...relevantQueries,
      ...IRRELEVANT_QUERIES.map((q) => ({ label: '（无关）', query: q })),
    ];
    const queryVectors = await llm.embed(queries.map((q) => q.query));

    // ---------- 6. 打印每个查询的 top5 ----------
    const relevantBest: number[] = [];
    const irrelevantBest: number[] = [];

    for (let i = 0; i < queries.length; i++) {
      const scored = chunkVectors
        .map((vector, idx) => ({
          score: cosineSimilarity(queryVectors[i], vector),
          ...allChunks[idx],
        }))
        .sort((a, b) => b.score - a.score);

      const isIrrelevant = queries[i].label === '（无关）';
      if (isIrrelevant) {
        irrelevantBest.push(scored[0]?.score ?? 0);
      } else {
        relevantBest.push(scored[0]?.score ?? 0);
      }

      console.log(`\n[${queries[i].label}] ${queries[i].query.slice(0, 50)}`);
      for (const hit of scored.slice(0, 5)) {
        const mark = hit.doc === queries[i].label ? ' <== 同源文档' : '';
        console.log(`   ${hit.score.toFixed(4)}  ${hit.doc}${mark}`);
      }
    }

    // ---------- 7. 汇总 ----------
    const maxIrrelevant = Math.max(...irrelevantBest);
    const minRelevant = Math.min(...relevantBest);

    console.log('\n================ 汇总 ================');
    console.log(`相关查询 ${relevantBest.length} 条，按文档分：`);

    for (const doc of docs) {
      const mine = relevantQueries
        .map((q, idx) => ({ label: q.label, score: relevantBest[idx] }))
        .filter((item) => item.label === doc.name)
        .map((item) => item.score);
      console.log(
        `   ${doc.name.padEnd(26)} min=${Math.min(...mine).toFixed(4)} ` +
          `max=${Math.max(...mine).toFixed(4)}`,
      );
    }

    console.log(
      `\n无关查询 ${irrelevantBest.length} 条最高分：` +
        irrelevantBest.map((s) => s.toFixed(4)).join(', '),
    );
    console.log(
      `\n无关查询最高分的最大值：${maxIrrelevant.toFixed(4)}   <-- 阈值下界`,
    );
    console.log(
      `相关查询最高分的最小值：${minRelevant.toFixed(4)}   <-- 阈值上界`,
    );
    console.log(
      maxIrrelevant < minRelevant
        ? `\n>>> 建议阈值取 (${maxIrrelevant.toFixed(2)}, ${minRelevant.toFixed(2)}) 之间`
        : `\n>>> ⚠️ 区间重叠：无关查询的分数已经超过部分相关查询，` +
            `单纯靠阈值分不开，需要考虑 rerank`,
    );

    // 不断言具体数值 —— 分数会随模型版本变化，这里是给人看的
    expect(chunkVectors.length).toBe(allChunks.length);
  }, 180_000);
});
