import type { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { Server } from 'node:http';
import { basename, join } from 'node:path';
import request from 'supertest';
import { DOCUMENT_UPLOAD_DIR } from '../src/document/document.constant.js';
import { createTestApp } from './utils/create-test-app.js';

const PASSWORD = 'Abcd1234';

describe('文档 (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  const stamp = Date.now();
  const emailA = `doc-a-${stamp}@example.com`;
  const emailB = `doc-b-${stamp}@example.com`;

  let tokenA = '';
  let tokenB = '';
  let kbId = 0;

  /** 记录测试期间产生的文件，afterAll 统一清理，避免污染 uploads/documents */
  const createdFilePaths: string[] = [];

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  /** 把入库的 URL 还原成磁盘路径（正文里就是用 basename 做这件事的） */
  function diskPathOf(filePath: string) {
    return join(DOCUMENT_UPLOAD_DIR, basename(filePath));
  }

  async function register(email: string) {
    const res = await request(server)
      .post('/api/auth/register')
      .send({ name: 'doc-e2e', email, password: PASSWORD })
      .expect(201);
    return res.body.data.accessToken as string;
  }

  /** 上传一个文档，返回响应体里的 data */
  async function uploadDoc(
    token: string,
    targetKbId: number,
    filename: string,
    content = 'e2e content',
  ) {
    const res = await request(server)
      .post(`/api/knowledge-bases/${targetKbId}/documents`)
      .set(auth(token))
      .attach('file', Buffer.from(content), {
        filename,
        contentType: 'application/octet-stream',
      })
      .expect(201);

    createdFilePaths.push(res.body.data.filePath);
    return res.body.data;
  }

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();

    tokenA = await register(emailA);
    tokenB = await register(emailB);

    const kb = await request(server)
      .post('/api/knowledge-bases')
      .set(auth(tokenA))
      .send({ title: `文档测试库-${stamp}` })
      .expect(201);
    kbId = kb.body.data.id;
  });

  afterAll(async () => {
    // 清掉测试产生的文件，别留在 uploads/documents 里
    for (const filePath of createdFilePaths) {
      await unlink(diskPathOf(filePath)).catch(() => {});
    }
    await app.close();
  });

  // ---------------- 鉴权与越权 ----------------

  it('未带 token 上传返回 401', async () => {
    await request(server)
      .post(`/api/knowledge-bases/${kbId}/documents`)
      .attach('file', Buffer.from('x'), 'no-token.md')
      .expect(401);
  });

  it('上传到不存在的知识库返回 404', async () => {
    await request(server)
      .post('/api/knowledge-bases/999999/documents')
      .set(auth(tokenA))
      .attach('file', Buffer.from('x'), 'ghost.md')
      .expect(404);
  });

  it('B 往 A 的知识库上传返回 403（越权）', async () => {
    await request(server)
      .post(`/api/knowledge-bases/${kbId}/documents`)
      .set(auth(tokenB))
      .attach('file', Buffer.from('x'), 'intrude.md')
      .expect(403);
  });

  it('B 读取 A 的文档列表返回 403', async () => {
    await request(server)
      .get(`/api/knowledge-bases/${kbId}/documents`)
      .set(auth(tokenB))
      .expect(403);
  });

  // ---------------- 上传 -----------------

  it('不支持的文件类型返回 400', async () => {
    await request(server)
      .post(`/api/knowledge-bases/${kbId}/documents`)
      .set(auth(tokenA))
      .attach('file', Buffer.from('x'), 'virus.exe')
      .expect(400);
  });

  it('扩展名大小写不影响校验', async () => {
    const doc = await uploadDoc(tokenA, kbId, 'UPPER.MD');
    expect(doc.fileType).toBe('md');
  });

  it('fileName 存原始文件名，fileType 存扩展名，初始状态是 pending', async () => {
    const doc = await uploadDoc(tokenA, kbId, `e2e-doc-${stamp}.md`);

    expect(doc.fileName).toBe(`e2e-doc-${stamp}.md`);
    expect(doc.fileType).toBe('md');
    expect(doc.status).toBe('pending');
    expect(doc.knowledgeBaseId).toBe(kbId);
  });

  it('filePath 是 URL 前缀 + 磁盘名，且磁盘上真的有这个文件', async () => {
    const doc = await uploadDoc(tokenA, kbId, 'on-disk.txt');

    expect(doc.filePath.startsWith('/uploads/documents/')).toBe(true);
    // 关键：URL 里用的是 multer 生成的 UUID 名，不是用户上传的原始名
    expect(doc.filePath).not.toContain('on-disk.txt');
    // 关键：用 basename 还原出的磁盘路径确实存在
    expect(existsSync(diskPathOf(doc.filePath))).toBe(true);
  });

  it('入库的 filePath 可以直接通过静态资源访问（不带 /api 前缀）', async () => {
    const doc = await uploadDoc(tokenA, kbId, 'reachable.md', '# 能访问到');
    await request(server).get(doc.filePath).expect(200);
  });

  // ---------------- 列表 -----------------

  it('列表只返回该知识库下的文档', async () => {
    const res = await request(server)
      .get(`/api/knowledge-bases/${kbId}/documents`)
      .set(auth(tokenA))
      .expect(200);

    expect(res.body.data.total).toBeGreaterThan(0);
    for (const item of res.body.data.list) {
      expect(item.knowledgeBaseId).toBe(kbId);
    }
  });

  it('列表支持按文件名搜索（搜的是原始名，不是 UUID）', async () => {
    const res = await request(server)
      .get(`/api/knowledge-bases/${kbId}/documents`)
      .query({ keyword: `e2e-doc-${stamp}` })
      .set(auth(tokenA))
      .expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.list[0].fileName).toBe(`e2e-doc-${stamp}.md`);
  });

  it('size 超过上限返回 400', async () => {
    await request(server)
      .get(`/api/knowledge-bases/${kbId}/documents?size=101`)
      .set(auth(tokenA))
      .expect(400);
  });

  // ---------------- 详情 -----------------

  it('A 能读取自己的文档详情', async () => {
    const doc = await uploadDoc(tokenA, kbId, 'mine.md');
    const res = await request(server)
      .get(`/api/knowledge-bases/${kbId}/documents/${doc.id}`)
      .set(auth(tokenA))
      .expect(200);

    expect(res.body.data.id).toBe(doc.id);
    expect(res.body.data.fileName).toBe('mine.md');
  });

  it('B 读取 A 的文档详情返回 403', async () => {
    const doc = await uploadDoc(tokenA, kbId, 'private.md');
    await request(server)
      .get(`/api/knowledge-bases/${kbId}/documents/${doc.id}`)
      .set(auth(tokenB))
      .expect(403);
  });

  it('不存在的 docId 返回 404', async () => {
    await request(server)
      .get(`/api/knowledge-bases/${kbId}/documents/999999`)
      .set(auth(tokenA))
      .expect(404);
  });

  // ---------------- 删除（放最后） ----------------

  it('B 删除 A 的文档返回 403，且磁盘文件仍在', async () => {
    const doc = await uploadDoc(tokenA, kbId, 'protected.md');

    await request(server)
      .delete(`/api/knowledge-bases/${kbId}/documents/${doc.id}`)
      .set(auth(tokenB))
      .expect(403);

    expect(existsSync(diskPathOf(doc.filePath))).toBe(true);
  });

  it('A 删除自己的文档后，磁盘上的文件也真的没了', async () => {
    const doc = await uploadDoc(tokenA, kbId, 'to-delete.md');
    const target = diskPathOf(doc.filePath);
    expect(existsSync(target)).toBe(true);

    await request(server)
      .delete(`/api/knowledge-bases/${kbId}/documents/${doc.id}`)
      .set(auth(tokenA))
      .expect(200);

    // 这条断言专门守住 originalname/filename 混用、以及磁盘路径基准写错这两个坑：
    // 一旦 URL 与磁盘文件名对不上，删除会静默失败（ENOENT 被忽略），这里立刻红
    expect(existsSync(target)).toBe(false);

    await request(server)
      .get(`/api/knowledge-bases/${kbId}/documents/${doc.id}`)
      .set(auth(tokenA))
      .expect(404);
  });
});
