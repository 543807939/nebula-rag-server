import type { INestApplication } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import type { Server } from 'node:http';
import { basename, join } from 'node:path';
import request from 'supertest';
import { DOCUMENT_UPLOAD_DIR } from '../src/document/document.constant.js';
import { DOCUMENT_STATUS } from '../src/document/types/document.type.js';
import { LlmService } from '../src/llm/llm.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/create-test-app.js';

const PASSWORD = 'Abcd1234';

/** 假向量的维度，随便定的 —— 测试只关心"能不能解析回来" */
const FAKE_DIM = 8;

describe('文档流水线 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;

  const stamp = Date.now();
  let token = '';
  let kbId = 0;

  /** 记录产生的文件，afterAll 清理，别把 uploads/documents 撑爆 */
  const createdFilePaths: string[] = [];

  /**
   * 把真实的 LlmService 换成假的。
   * 外部依赖（花钱、联网、会抖动）一律不进自动化测试。
   */
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
});
