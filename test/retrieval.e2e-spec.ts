import type { INestApplication } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import type { Server } from 'node:http';
import { basename, join } from 'node:path';
import request from 'supertest';
import { DOCUMENT_UPLOAD_DIR } from '../src/document/document.constant.js';
import { DOCUMENT_STATUS } from '../src/document/types/document.type.js';
import { LlmService } from '../src/llm/llm.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { RetrievedChunk } from '../src/retrieval/types/retrieval.type.js';
import { createTestApp } from './utils/create-test-app.js';

const PASSWORD = 'Abcd1234';

/**
 * 假 embedding：把文本映射到「概念轴」上，命中哪个概念对应维度就是 1。
 *
 * 为什么不能用固定向量（比如全 0.1）：
 * 那样所有向量方向完全一致、两两余弦恒等于 1 ——
 * **排序和阈值过滤这两条核心逻辑在测试里根本不会被执行到**，
 * 用例全绿但什么都没验证。必须让不同文本产生方向不同的向量。
 */
const CONCEPTS = ['苹果', '香蕉', '汽车'];

function fakeVector(text: string): number[] {
  return CONCEPTS.map((concept) => (text.includes(concept) ? 1 : 0));
}

/**
 * 一个段落 393 字（概念词 + 390 个填充字符），
 * 两段相加 787 字 > 500，所以每段稳定切成一块。
 */
function paragraph(concept: string): string {
  return `${concept}：${'x'.repeat(390)}`;
}

/** 3 段 → 3 块，分别落在 苹果 / 香蕉 / 汽车 三个方向上 */
const DOC_TEXT = CONCEPTS.map(paragraph).join('\n\n');

describe('检索 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;

  const stamp = Date.now();
  const emailA = `search-a-${stamp}@example.com`;
  const emailB = `search-b-${stamp}@example.com`;

  let tokenA = '';
  let tokenB = '';

  /** 含 苹果 / 香蕉 / 汽车 三个 chunk 的库 */
  let kbId = 0;
  /** 只含「香蕉」的库，用来验知识库隔离 */
  let kb2Id = 0;
  /** kbId 下那份文档，断言来源信息要用 */
  let docId = 0;
  let docFileName = '';

  const createdFilePaths: string[] = [];

  const fakeLlm = {
    embed: (texts: string[]) => Promise.resolve(texts.map(fakeVector)),
  } as unknown as LlmService;

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function diskPathOf(filePath: string) {
    return join(DOCUMENT_UPLOAD_DIR, basename(filePath));
  }

  function search(token: string, targetKbId: number, query: string) {
    return request(server)
      .post(`/api/knowledge-bases/${targetKbId}/search`)
      .set(auth(token))
      .send({ query });
  }

  async function register(email: string) {
    const res = await request(server)
      .post('/api/auth/register')
      .send({ name: 'search-e2e', email, password: PASSWORD })
      .expect(201);
    return res.body.data.accessToken as string;
  }

  async function createKb(token: string, title: string) {
    const res = await request(server)
      .post('/api/knowledge-bases')
      .set(auth(token))
      .send({ title })
      .expect(201);
    return res.body.data.id as number;
  }

  async function uploadDoc(
    token: string,
    targetKbId: number,
    filename: string,
    content: string,
  ) {
    const res = await request(server)
      .post(`/api/knowledge-bases/${targetKbId}/documents`)
      .set(auth(token))
      .attach('file', Buffer.from(content), {
        filename,
        contentType: 'text/plain',
      })
      .expect(201);

    const data = res.body.data as { id: number; fileName: string; filePath: string };
    createdFilePaths.push(data.filePath);
    return data;
  }

  /** 轮询直到文档处理完；变成 failed 立刻抛原因，比等超时有用 */
  async function waitDone(documentId: number) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const doc = await prisma.document.findUnique({
        where: { id: documentId },
      });
      if (doc?.status === DOCUMENT_STATUS.COMPLETED) {
        return doc;
      }
      if (doc?.status === DOCUMENT_STATUS.FAILED) {
        throw new Error(`文档处理失败: ${doc.errorMessage}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`等待文档处理完成超时 id=${documentId}`);
  }

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(LlmService).useValue(fakeLlm),
    );
    prisma = app.get(PrismaService);
    server = app.getHttpServer();

    tokenA = await register(emailA);
    tokenB = await register(emailB);

    kbId = await createKb(tokenA, `检索测试库-${stamp}`);
    kb2Id = await createKb(tokenA, `检索隔离库-${stamp}`);

    const doc = await uploadDoc(tokenA, kbId, 'fruits.md', DOC_TEXT);
    docId = doc.id;
    docFileName = doc.fileName;
    await waitDone(doc.id);

    const doc2 = await uploadDoc(
      tokenA,
      kb2Id,
      'banana-only.md',
      paragraph('香蕉'),
    );
    await waitDone(doc2.id);
  });

  afterAll(async () => {
    for (const filePath of createdFilePaths) {
      await unlink(diskPathOf(filePath)).catch(() => {});
    }
    await app.close();
  });

  // ---------------- 鉴权与越权 ----------------

  it('未带 token 返回 401', async () => {
    await request(server)
      .post(`/api/knowledge-bases/${kbId}/search`)
      .send({ query: '苹果' })
      .expect(401);
  });

  it('B 查 A 的知识库返回 403', async () => {
    await search(tokenB, kbId, '苹果').expect(403);
  });

  it('知识库不存在返回 404', async () => {
    await search(tokenA, 999999, '苹果').expect(404);
  });

  // ---------------- 入参校验 ----------------

  it('query 为空返回 400', async () => {
    await search(tokenA, kbId, '').expect(400);
  });

  it('query 超过 500 字返回 400', async () => {
    await search(tokenA, kbId, 'x'.repeat(501)).expect(400);
  });

  // ---------------- 召回 ----------------

  it('能召回命中的 chunk，并带上来源信息与分数', async () => {
    const res = await search(tokenA, kbId, '苹果').expect(200);
    const list = res.body.data as RetrievedChunk[];

    expect(list).toHaveLength(1);
    expect(list[0].content).toContain('苹果');
    expect(list[0].documentId).toBe(docId);
    expect(list[0].fileName).toBe(docFileName);
    expect(list[0].chunkIndex).toBe(0);
    // fake 向量下命中的是同一个方向，余弦应为 1
    expect(list[0].score).toBeCloseTo(1);
  });

  it('换一个查询词命中另一块（结果确实按相似度排）', async () => {
    const res = await search(tokenA, kbId, '汽车').expect(200);
    const list = res.body.data as RetrievedChunk[];

    expect(list).toHaveLength(1);
    expect(list[0].content).toContain('汽车');
    expect(list[0].chunkIndex).toBe(2);
  });

  it('无关查询被阈值过滤，返回空数组而不是硬塞 topK 条', async () => {
    const res = await search(tokenA, kbId, '完全无关的一句话').expect(200);
    expect(res.body.data).toEqual([]);
  });

  // ---------------- 隔离 ----------------

  it('知识库隔离：另一个库里的 chunk 不会被召回', async () => {
    // kb2 里只有「香蕉」的文档，查「苹果」应该什么都拿不到
    const res = await search(tokenA, kb2Id, '苹果').expect(200);
    expect(res.body.data).toEqual([]);

    // 反向确认 kb2 自己确实能搜到东西 —— 否则上面的空数组可能是「功能坏了」而不是「隔离生效」
    const hit = await search(tokenA, kb2Id, '香蕉').expect(200);
    expect(hit.body.data).toHaveLength(1);
    expect(hit.body.data[0].content).toContain('香蕉');
  });

  // ---------------- 跨模块契约（放最后，它会改状态） ----------------

  it('不会召回未完成文档的 chunk', async () => {
    // 模拟「分批落库跑到一半失败」：chunk 已经写进库了，但状态是 failed。
    // 检索必须只认 completed，否则会把半截文档的内容喂给模型 ——
    // 表现为「引用了文件里根本不存在的内容」，极难排查。
    await prisma.document.update({
      where: { id: docId },
      data: { status: DOCUMENT_STATUS.FAILED },
    });

    const res = await search(tokenA, kbId, '苹果').expect(200);
    expect(res.body.data).toEqual([]);

    // 还原，避免影响后续可能新增的用例
    await prisma.document.update({
      where: { id: docId },
      data: { status: DOCUMENT_STATUS.COMPLETED },
    });
  });
});
