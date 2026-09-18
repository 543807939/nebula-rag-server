import type { INestApplication } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import type { Server } from 'node:http';
import { basename, join } from 'node:path';
import request from 'supertest';
import { DOCUMENT_UPLOAD_DIR } from '../src/document/document.constant.js';
import { DocumentService } from '../src/document/document.service.js';
import { DocumentPipelineService } from '../src/document/pipeline/document-pipeline.service.js';
import { DOCUMENT_STATUS } from '../src/document/types/document.type.js';
import { LlmService } from '../src/llm/llm.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/create-test-app.js';

const PASSWORD = 'Abcd1234';

/** 假向量维度，随便定 —— 这里只关心「能不能重新跑回来」 */
const FAKE_DIM = 8;

/**
 * 12 个段落、每段 94 字，按 500 字一块会稳定切成 3 块。
 * 必须是多块：单块时「chunk 被插了两遍」也可能侥幸通过断言。
 */
const LONG_TEXT = Array.from(
  { length: 12 },
  (_, i) => `段落${i}：${'x'.repeat(90)}`,
).join('\n\n');

describe('文档状态恢复 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let documentService: DocumentService;
  let pipeline: DocumentPipelineService;
  let server: Server;

  const stamp = Date.now();
  let token = '';
  let kbId = 0;

  /** 记录测试期间产生的文件，afterAll 统一清理 */
  const createdFilePaths: string[] = [];

  /** 外部依赖（联网、花钱、会抖动）一律不进自动化测试 */
  const fakeLlm = {
    embed: (texts: string[]) =>
      Promise.resolve(
        texts.map(() => Array.from({ length: FAKE_DIM }, () => 0.1)),
      ),
  } as unknown as LlmService;

  function auth() {
    return { Authorization: `Bearer ${token}` };
  }

  function diskPathOf(filePath: string) {
    return join(DOCUMENT_UPLOAD_DIR, basename(filePath));
  }

  async function bootApp() {
    app = await createTestApp((builder) =>
      builder.overrideProvider(LlmService).useValue(fakeLlm),
    );
    prisma = app.get(PrismaService);
    documentService = app.get(DocumentService);
    pipeline = app.get(DocumentPipelineService);
    server = app.getHttpServer();
  }

  /** 关掉再起一个 —— 真实地走一遍 onApplicationBootstrap */
  async function rebootApp() {
    await app.close();
    await bootApp();
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

  /** 轮询直到状态变成期望值；变成 failed 立刻抛原因，比等超时有用得多 */
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
    // 超时把「实际是什么状态」一起打出来 —— 停在 pending 就说明没被重新派发
    const actual = await prisma.document.findUnique({
      where: { id: documentId },
    });
    throw new Error(
      `等待文档状态超时：期望 ${expected}，实际 ${actual?.status}（${timeoutMs}ms）`,
    );
  }

  /** chunk 快照：数量 + 顺序 + 内容。翻倍、错位、丢块都能被它抓住 */
  function snapshotChunks(documentId: number) {
    return prisma.chunk.findMany({
      where: { documentId },
      orderBy: { chunkIndex: 'asc' },
      select: { chunkIndex: true, content: true },
    });
  }

  /** 强行把文档改成某个状态，模拟「进程写到一半被杀」 */
  function forceStatus(
    documentId: number,
    status: string,
    times: { createdAt?: Date; updatedAt?: Date } = {},
  ) {
    return prisma.document.update({
      where: { id: documentId },
      data: { status, ...times },
    });
  }

  beforeAll(async () => {
    await bootApp();

    const reg = await request(server)
      .post('/api/auth/register')
      .send({
        name: 'recover-e2e',
        email: `recover-${stamp}@example.com`,
        password: PASSWORD,
      })
      .expect(201);
    token = reg.body.data.accessToken;

    const kb = await request(server)
      .post('/api/knowledge-bases')
      .set(auth())
      .send({ title: `恢复测试库-${stamp}` })
      .expect(201);
    kbId = kb.body.data.id;
  });

  afterAll(async () => {
    for (const filePath of createdFilePaths) {
      await unlink(diskPathOf(filePath)).catch(() => {});
    }
    await app.close();
  });

  // ---------------- 地基：run() 必须幂等 ----------------

  it('run() 是幂等的：重复处理同一文档，chunk 不会翻倍', async () => {
    const doc = await uploadDoc('idempotent.md', LONG_TEXT);
    await waitForStatus(doc.id, DOCUMENT_STATUS.COMPLETED);

    const before = await snapshotChunks(doc.id);
    expect(before.length).toBeGreaterThan(1);

    // 直接再跑一次，模拟任意一条「重新派发」的路径
    await pipeline.run(doc.id);

    // 少了 run() 开头那次 deleteChunks，这里会是 6 条而不是 3 条
    expect(await snapshotChunks(doc.id)).toEqual(before);
  });

  // ---------------- 启动恢复：processing ----------------

  it('重启后，卡在 processing 的文档会被自动恢复并跑完，且不产生重复 chunk', async () => {
    const doc = await uploadDoc('restart-processing.md', LONG_TEXT);
    await waitForStatus(doc.id, DOCUMENT_STATUS.COMPLETED);

    const before = await snapshotChunks(doc.id);
    expect(before.length).toBeGreaterThan(1);

    // 模拟「chunk 已经落库了，但还没来及把状态改成 completed，进程就被杀掉」
    await forceStatus(doc.id, DOCUMENT_STATUS.PROCESSING);

    // 这里特意重启整个应用，而不是直接调 service：
    // 走一遍 onApplicationBootstrap，连「钩子有没有接上」一起验了。
    // 钩子没实现 / 接错模块 / 忘了重新派发，这条都会红。
    await rebootApp();

    await waitForStatus(doc.id, DOCUMENT_STATUS.COMPLETED);

    // 恢复必须先清掉残留 chunk 再重跑，否则这里会是 6 条
    expect(await snapshotChunks(doc.id)).toEqual(before);
  });

  // ---------------- 启动恢复：pending ----------------

  it('重启后，卡在 pending 的文档也会被重新派发', async () => {
    const doc = await uploadDoc('restart-pending.md', LONG_TEXT);
    await waitForStatus(doc.id, DOCUMENT_STATUS.COMPLETED);

    // 模拟「落库成功了，但触发 run() 的那行没跑到」——
    // 连 chunk 一起清掉，退回「从没处理过」的样子
    await prisma.chunk.deleteMany({ where: { documentId: doc.id } });
    await forceStatus(doc.id, DOCUMENT_STATUS.PENDING);

    await documentService.recoverInterruptedDocuments();

    await waitForStatus(doc.id, DOCUMENT_STATUS.COMPLETED);

    // 光看状态不够（可能是别处改的），这里确认真的重新分块了
    expect((await snapshotChunks(doc.id)).length).toBeGreaterThan(1);
  });

  // ---------------- 超时判死：只看 updatedAt ----------------

  it('markStaleDocumentsFailed 只看 updatedAt，不会误杀还在处理的慢文档', async () => {
    const slowButAlive = await uploadDoc('slow-alive.md', LONG_TEXT);
    const reallyDead = await uploadDoc('slow-dead.md', LONG_TEXT);
    await waitForStatus(slowButAlive.id, DOCUMENT_STATUS.COMPLETED);
    await waitForStatus(reallyDead.id, DOCUMENT_STATUS.COMPLETED);

    const longAgo = new Date(Date.now() - 30 * 60 * 1000);

    // 两条都是「30 分钟前创建」，区别只在最近有没有动过
    await forceStatus(slowButAlive.id, DOCUMENT_STATUS.PROCESSING, {
      createdAt: longAgo,
      updatedAt: new Date(),
    });
    await forceStatus(reallyDead.id, DOCUMENT_STATUS.PROCESSING, {
      createdAt: longAgo,
      updatedAt: longAgo,
    });

    // 前置断言：先确认 Prisma 真按我们给的时间写进去了，
    // 否则下面判的是个根本没生效的前提
    const [alivePre, deadPre] = await Promise.all([
      prisma.document.findUnique({ where: { id: slowButAlive.id } }),
      prisma.document.findUnique({ where: { id: reallyDead.id } }),
    ]);
    expect(alivePre?.updatedAt.getTime() ?? 0).toBeGreaterThan(
      longAgo.getTime(),
    );
    expect(
      Math.abs((deadPre?.updatedAt.getTime() ?? 0) - longAgo.getTime()),
    ).toBeLessThan(1000);

    await documentService.markStaleDocumentsFailed();

    const [alive, dead] = await Promise.all([
      prisma.document.findUnique({ where: { id: slowButAlive.id } }),
      prisma.document.findUnique({ where: { id: reallyDead.id } }),
    ]);

    // 刚更新过 —— 说明还活着。判据若用 createdAt，这条会被误杀
    expect(alive?.status).toBe(DOCUMENT_STATUS.PROCESSING);
    expect(dead?.status).toBe(DOCUMENT_STATUS.FAILED);
  });
});
