import type { INestApplication } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import type { Server } from 'node:http';
import { basename, join } from 'node:path';
import request from 'supertest';
import { DOCUMENT_UPLOAD_DIR } from '../src/document/document.constant.js';
import { DocumentPipelineService } from '../src/document/pipeline/document-pipeline.service.js';
import { DOCUMENT_STATUS } from '../src/document/types/document.type.js';
import { LlmService } from '../src/llm/llm.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/create-test-app.js';

const PASSWORD = 'Abcd1234';

/** 假向量的维度，随便定的 —— 测试只关心"能不能解析回来" */
const FAKE_DIM = 8;

/** 与 pipeline 里的 BATCH 保持一致：一批 16 条 */
const EMBED_BATCH = 16;

/**
 * 30 段、每段 394 字 —— 一段一块（两段 789 字 > 500），稳定切成 30 块。
 *
 * 必须超过 EMBED_BATCH：只有跨批才可能暴露「chunkIndex 用了批内索引」这个 bug。
 * 单批时批内索引和全局索引恰好相等，测试会给出假绿。
 */
const CROSS_BATCH_PARAGRAPHS = 30;
const CROSS_BATCH_TEXT = Array.from(
  { length: CROSS_BATCH_PARAGRAPHS },
  (_, i) => `段落${i}：${'x'.repeat(390)}`,
).join('\n\n');

describe('文档流水线 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let pipeline: DocumentPipelineService;
  let server: Server;

  const stamp = Date.now();
  let token = '';
  let kbId = 0;

  /** 记录产生的文件，afterAll 清理，别把 uploads/documents 撑爆 */
  const createdFilePaths: string[] = [];

  /** 每批 embed 之前的钩子与耗时，只给「心跳」用例用；平时是 null / 0 */
  let onEmbed: (() => Promise<void>) | null = null;
  let embedDelayMs = 0;

  /**
   * 把真实的 LlmService 换成假的。
   * 外部依赖（花钱、联网、会抖动）一律不进自动化测试。
   */
  const fakeLlm = {
    embed: async (texts: string[]) => {
      if (onEmbed) {
        await onEmbed();
      }
      if (embedDelayMs > 0) {
        await new Promise((r) => setTimeout(r, embedDelayMs));
      }
      return texts.map(() => Array.from({ length: FAKE_DIM }, () => 0.1));
    },
  } as unknown as LlmService;

  function auth() {
    return { Authorization: `Bearer ${token}` };
  }

  function diskPathOf(filePath: string) {
    return join(DOCUMENT_UPLOAD_DIR, basename(filePath));
  }

  async function uploadDoc(filename: string, content: string) {
    const res = await request(server)
      .post(`/api/knowledge-bases/${kbId}/documents`)
      .set(auth())
      .attach('file', Buffer.from(content), {
        filename,
        contentType: 'text/plain',
      })
      .expect(201);

    const data = res.body.data as { id: number; filePath: string };
    createdFilePaths.push(data.filePath);
    return data;
  }

  /**
   * 轮询直到状态变成期望值。
   * 变成 FAILED 就直接抛出 errorMessage —— 比等到超时再报错有用得多。
   */
  async function waitForStatus(
    documentId: number,
    expected: string,
    timeoutMs = 5000,
  ) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const doc = await prisma.document.findUnique({
        where: { id: documentId },
      });
      if (doc?.status === expected) {
        return doc;
      }
      if (doc?.status === DOCUMENT_STATUS.FAILED) {
        throw new Error(`文档处理失败: ${doc.errorMessage}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`等待文档状态超时：期望 ${expected}（${timeoutMs}ms）`);
  }

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(LlmService).useValue(fakeLlm),
    );
    prisma = app.get(PrismaService);
    pipeline = app.get(DocumentPipelineService);
    server = app.getHttpServer();

    const reg = await request(server)
      .post('/api/auth/register')
      .send({
        name: 'pipeline-e2e',
        email: `pipeline-${stamp}@example.com`,
        password: PASSWORD,
      })
      .expect(201);
    token = reg.body.data.accessToken;

    const kb = await request(server)
      .post('/api/knowledge-bases')
      .set(auth())
      .send({ title: `流水线测试库-${stamp}` })
      .expect(201);
    kbId = kb.body.data.id;
  });

  afterAll(async () => {
    for (const filePath of createdFilePaths) {
      await unlink(diskPathOf(filePath)).catch(() => {});
    }
    await app.close();
  });

  it('上传 txt 会自动分块、向量化并落库，状态变为 completed', async () => {
    const text = 'A'.repeat(200);
    const doc = await uploadDoc('simple.txt', text);

    await waitForStatus(doc.id, DOCUMENT_STATUS.COMPLETED);

    const chunks = await prisma.chunk.findMany({
      where: { documentId: doc.id },
      orderBy: { chunkIndex: 'asc' },
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkIndex).toBe(0);
    // 短文本单段，分块后内容应与原文一致
    expect(chunks[0].content).toBe(text);
    // embedding 必须是能解析回来的 JSON，且维度正确
    expect(JSON.parse(chunks[0].embedding)).toHaveLength(FAKE_DIM);
  });

  it('长文本切成多块，chunkIndex 连续、每个段落都不丢', async () => {
    const paragraphs = Array.from(
      { length: 20 },
      (_, i) => `段落${i}：${'x'.repeat(20)}`,
    );
    const text = paragraphs.join('\n\n');

    const doc = await uploadDoc('multi.txt', text);
    await waitForStatus(doc.id, DOCUMENT_STATUS.COMPLETED);

    const chunks = await prisma.chunk.findMany({
      where: { documentId: doc.id },
      orderBy: { chunkIndex: 'asc' },
    });

    expect(chunks.length).toBeGreaterThan(1);
    // chunkIndex 必须从 0 开始连续，不能有洞
    expect(chunks.map((c) => c.chunkIndex)).toEqual(
      chunks.map((_, i) => i),
    );
    // 每个段落都要完整落在某个块里 —— 不允许丢内容
    for (const paragraph of paragraphs) {
      expect(chunks.some((c) => c.content.includes(paragraph))).toBe(true);
    }
    for (const chunk of chunks) {
      expect(JSON.parse(chunk.embedding)).toHaveLength(FAKE_DIM);
    }
  });

  it('空文件直接标记 completed，且不产生任何 chunk', async () => {
    const doc = await uploadDoc('empty.txt', '   \n\n  \n ');
    await waitForStatus(doc.id, DOCUMENT_STATUS.COMPLETED);

    const count = await prisma.chunk.count({ where: { documentId: doc.id } });
    expect(count).toBe(0);
  });

  it('暂不支持的格式会被标记 failed，并把原因写进 errorMessage', async () => {
    // pdf 能通过上传校验（在 ALLOWED_EXT 里），但流水线还没接文件解析
    const doc = await uploadDoc('not-supported.pdf', 'fake pdf content');

    const failed = await waitForStatus(doc.id, DOCUMENT_STATUS.FAILED);
    expect(failed.errorMessage).toContain('暂不支持');
  });

  // ---------------- 分批落库 ----------------

  it('跨批的 chunkIndex 是全局连续的，不是每批从 0 重新开始', async () => {
    const doc = await uploadDoc('cross-batch.txt', CROSS_BATCH_TEXT);
    await waitForStatus(doc.id, DOCUMENT_STATUS.COMPLETED);

    const chunks = await prisma.chunk.findMany({
      where: { documentId: doc.id },
      orderBy: { chunkIndex: 'asc' },
    });

    expect(chunks.length).toBe(CROSS_BATCH_PARAGRAPHS);
    // 先确认真的跨了批，否则这条用例守不住任何东西
    expect(chunks.length).toBeGreaterThan(EMBED_BATCH);

    // 核心断言：0..N-1 连续、无重复、无缺口。
    // 若 chunkIndex 写成批内的 j，这里会拿到 0..15,0..13 这种重复序列，立刻红。
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));

    // 内容不能错位：第 i 块必须正好是第 i 段
    for (let i = 0; i < CROSS_BATCH_PARAGRAPHS; i++) {
      expect(chunks[i].content).toContain(`段落${i}：`);
    }

    // 每一批都要落向量，不能只有第一批有
    for (const chunk of chunks) {
      expect(JSON.parse(chunk.embedding)).toHaveLength(FAKE_DIM);
    }
  });

  it('每批落库都会回写 Document（心跳），cron 的 updatedAt 判据才成立', async () => {
    const doc = await uploadDoc('heartbeat.txt', CROSS_BATCH_TEXT);
    await waitForStatus(doc.id, DOCUMENT_STATUS.COMPLETED);

    // 每批 embed 之前先看一眼此刻库里的 updatedAt。
    // chunk.createMany 写的是 Chunk 表，不会动 Document.updatedAt ——
    // 所以只有 pipeline 显式回写了，这些采样值才会变化。
    const samples: number[] = [];
    embedDelayMs = 10;
    onEmbed = async () => {
      const current = await prisma.document.findUnique({
        where: { id: doc.id },
      });
      if (current) {
        samples.push(current.updatedAt.getTime());
      }
    };

    try {
      await pipeline.run(doc.id);
    } finally {
      embedDelayMs = 0;
      onEmbed = null;
    }

    // 30 块 ÷ 每批 16 条 = 2 批
    expect(samples).toHaveLength(2);
    // 两批看到的 updatedAt 必须不同 —— 说明第 1 批之后确实回写过 Document。
    // 去掉心跳那次 update，两个值都会停在 run() 开头那次，这里立刻红。
    expect(new Set(samples).size).toBe(samples.length);
    // 而且是单调递增的
    expect([...samples].sort((a, b) => a - b)).toEqual(samples);
  });
});
