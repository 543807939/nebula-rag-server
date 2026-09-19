import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { CHAT_ROLE_TYPE } from '../src/llm/constants/chat-role.constants.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/create-test-app.js';

const PASSWORD = 'Abcd1234';

describe('会话与消息 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;

  const stamp = Date.now();
  const emailA = `conv-a-${stamp}@example.com`;
  const emailB = `conv-b-${stamp}@example.com`;

  let tokenA = '';
  let tokenB = '';
  /** A 自己的知识库 */
  let kbA = 0;
  /** A 的第二个知识库：验「同一个用户也不能跨库访问会话」 */
  let kbA2 = 0;
  /** B 自己的知识库：验「用自己的 kbId 去访问别人的会话」 */
  let kbB = 0;

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function register(email: string) {
    const res = await request(server)
      .post('/api/auth/register')
      .send({ name: 'conv-e2e', email, password: PASSWORD })
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

  /**
   * 建一个会话并返回它。
   * 这里不硬断言 201 —— 让「状态码契约」只由那一条专门的用例守，
   * 否则一个状态码改动会把所有用例连带弄红，看不出真正的问题在哪。
   */
  async function newConversation(token: string, kbId: number) {
    const res = await request(server)
      .post(`/api/knowledge-bases/${kbId}/conversations`)
      .set(auth(token));

    if (res.status >= 300) {
      throw new Error(
        `创建会话失败: ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    return res.body.data as {
      id: number;
      title: string;
      knowledgeBaseId: number;
    };
  }

  function listConversations(token: string, kbId: number, qs = '') {
    return request(server)
      .get(`/api/knowledge-bases/${kbId}/conversations${qs}`)
      .set(auth(token));
  }

  function listMessages(
    token: string,
    kbId: number,
    conversationId: number,
    qs = '',
  ) {
    return request(server)
      .get(
        `/api/knowledge-bases/${kbId}/conversations/${conversationId}/messages${qs}`,
      )
      .set(auth(token));
  }

  function deleteConversation(
    token: string,
    kbId: number,
    conversationId: number,
  ) {
    return request(server)
      .delete(`/api/knowledge-bases/${kbId}/conversations/${conversationId}`)
      .set(auth(token));
  }

  /** 直接插消息 —— 提问接口还没做，这里只验证消息的读取语义 */
  async function seedMessages(conversationId: number, contents: string[]) {
    await prisma.message.createMany({
      data: contents.map((content, index) => ({
        conversationId,
        content,
        role: index % 2 === 0 ? CHAT_ROLE_TYPE.USER : CHAT_ROLE_TYPE.ASSISTANT,
      })),
    });
  }

  /** 取响应里的消息正文（后端保证是正序） */
  function contentsOf(res: request.Response) {
    return (res.body.data.list as { content: string }[]).map((m) => m.content);
  }

  /** 取这一页最早那条的 id —— 前端就是拿它当下一页的游标 */
  function firstIdOf(res: request.Response) {
    return (res.body.data.list as { id: number }[])[0].id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer();

    tokenA = await register(emailA);
    tokenB = await register(emailB);

    kbA = await createKb(tokenA, `会话测试库A-${stamp}`);
    kbA2 = await createKb(tokenA, `会话测试库A2-${stamp}`);
    kbB = await createKb(tokenB, `会话测试库B-${stamp}`);
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------- 鉴权与归属 ----------------

  it('未带 token 创建会话返回 401', async () => {
    await request(server)
      .post(`/api/knowledge-bases/${kbA}/conversations`)
      .expect(401);
  });

  it('B 往 A 的知识库建会话返回 403', async () => {
    await request(server)
      .post(`/api/knowledge-bases/${kbA}/conversations`)
      .set(auth(tokenB))
      .expect(403);
  });

  it('B 列 A 的知识库的会话返回 403', async () => {
    await listConversations(tokenB, kbA).expect(403);
  });

  // ---------------- 创建 ----------------

  it('创建会话返回 201，title 用 schema 默认值', async () => {
    const res = await request(server)
      .post(`/api/knowledge-bases/${kbA}/conversations`)
      .set(auth(tokenA))
      .expect(201);

    // 创建资源就是 201 —— 不能因为「只是建个空壳」就改成 200
    expect(res.body.data.title).toBe('新对话');
    expect(res.body.data.knowledgeBaseId).toBe(kbA);
  });

  // ---------------- 会话列表 ----------------

  it('列表返回的是分页结构，且只含该知识库的会话', async () => {
    const convA = await newConversation(tokenA, kbA);
    const convB = await newConversation(tokenB, kbB);

    const res = await listConversations(tokenA, kbA).expect(200);
    const { list } = res.body.data as { list: { id: number }[] };

    expect(list.some((c) => c.id === convA.id)).toBe(true);
    // 别的知识库（哪怕是同一个用户的）不能串进来
    expect(list.some((c) => c.id === convB.id)).toBe(false);
  });

  it('分页的 total / totalPage 反映总数，而不是当前页条数', async () => {
    // 用独立的知识库，避免和上面用例的会话混在一起
    const kb = await createKb(tokenA, `分页库-${stamp}`);
    for (let i = 0; i < 3; i++) {
      await newConversation(tokenA, kb);
    }

    const first = await listConversations(tokenA, kb, '?page=1&size=2').expect(
      200,
    );
    expect(first.body.data.list).toHaveLength(2);
    // 关键：写成 list.length 的话这里是 2 和 1，前端会以为只有一页
    expect(first.body.data.total).toBe(3);
    expect(first.body.data.totalPage).toBe(2);

    const second = await listConversations(tokenA, kb, '?page=2&size=2').expect(
      200,
    );
    expect(second.body.data.list).toHaveLength(1);
    expect(second.body.data.total).toBe(3);
  });

  it('关键词搜索按 title 过滤', async () => {
    const kb = await createKb(tokenA, `搜索库-${stamp}`);
    const hit = await newConversation(tokenA, kb);
    await prisma.conversation.update({
      where: { id: hit.id },
      data: { title: `独一无二的标题-${stamp}` },
    });
    await newConversation(tokenA, kb);

    const res = await listConversations(
      tokenA,
      kb,
      `?keyword=${encodeURIComponent(`独一无二的标题-${stamp}`)}`,
    ).expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.list[0].id).toBe(hit.id);
  });

  // ---------------- 消息读取 ----------------

  it('历史消息按时间正序返回，条数不足时 hasMore 为 false', async () => {
    const conv = await newConversation(tokenA, kbA);
    await seedMessages(conv.id, ['第 1 条', '第 2 条', '第 3 条']);

    const res = await listMessages(tokenA, kbA, conv.id).expect(200);
    expect(contentsOf(res)).toEqual(['第 1 条', '第 2 条', '第 3 条']);
    expect(res.body.data.hasMore).toBe(false);
  });

  it('首屏取的是最近的消息，但仍按正序返回', async () => {
    const conv = await newConversation(tokenA, kbA);
    await seedMessages(conv.id, ['第 1 条', '第 2 条', '第 3 条']);

    const res = await listMessages(tokenA, kbA, conv.id, '?limit=2').expect(
      200,
    );

    // 要么是「最新的 2 条且正序」，要么是「最旧的 2 条」——
    // 守住的是「先倒序取最近，再 reverse 回来」。
    // 谁把 .reverse() 删了、或把 orderBy 改成 asc，这条立刻红。
    expect(contentsOf(res)).toEqual(['第 2 条', '第 3 条']);
    expect(res.body.data.hasMore).toBe(true);
  });

  it('用返回的第一条 id 当 beforeId 能继续往上翻，翻到底 hasMore 变 false', async () => {
    const conv = await newConversation(tokenA, kbA);
    await seedMessages(conv.id, [
      '第 1 条',
      '第 2 条',
      '第 3 条',
      '第 4 条',
      '第 5 条',
    ]);

    // 首屏：最近 2 条
    const page1 = await listMessages(tokenA, kbA, conv.id, '?limit=2').expect(
      200,
    );
    expect(contentsOf(page1)).toEqual(['第 4 条', '第 5 条']);
    expect(page1.body.data.hasMore).toBe(true);

    // 前端滚到顶部时，拿「这一页最早那条」的 id 继续往上要
    const cursor1 = firstIdOf(page1);
    const page2 = await listMessages(
      tokenA,
      kbA,
      conv.id,
      `?limit=2&beforeId=${cursor1}`,
    ).expect(200);
    expect(contentsOf(page2)).toEqual(['第 2 条', '第 3 条']);
    expect(page2.body.data.hasMore).toBe(true);

    const cursor2 = firstIdOf(page2);
    const page3 = await listMessages(
      tokenA,
      kbA,
      conv.id,
      `?limit=2&beforeId=${cursor2}`,
    ).expect(200);
    expect(contentsOf(page3)).toEqual(['第 1 条']);
    // 到最早了
    expect(page3.body.data.hasMore).toBe(false);
  });

  it('翻页途中来了新消息，不会打乱 beforeId 分页', async () => {
    // 这一条是 cursor 相对 page/size 的核心价值所在。
    // 换成分页偏移量的话，尾部多一条会让第二页重复或跳过「第 2 条」。
    const conv = await newConversation(tokenA, kbA);
    await seedMessages(conv.id, ['第 1 条', '第 2 条', '第 3 条']);

    const page1 = await listMessages(tokenA, kbA, conv.id, '?limit=2').expect(
      200,
    );
    expect(contentsOf(page1)).toEqual(['第 2 条', '第 3 条']);
    const cursor = firstIdOf(page1);

    // 用户还在看历史，此时尾部插入了新消息
    await seedMessages(conv.id, ['第 4 条']);

    const page2 = await listMessages(
      tokenA,
      kbA,
      conv.id,
      `?limit=2&beforeId=${cursor}`,
    ).expect(200);
    expect(contentsOf(page2)).toEqual(['第 1 条']);
    expect(page2.body.data.hasMore).toBe(false);
  });

  it('limit 超出范围返回 400', async () => {
    const conv = await newConversation(tokenA, kbA);
    await listMessages(tokenA, kbA, conv.id, '?limit=101').expect(400);
    await listMessages(tokenA, kbA, conv.id, '?limit=0').expect(400);
  });

  // ---------------- 越权（本文件的核心） ----------------

  it('用自己的 kbId + 别人的 conversationId 查消息，返回 404 而不是 200', async () => {
    // Guard 只看 kbId —— B 传自己的 kbB 是能过 Guard 的。
    // 如果 service 里没有校验「会话属于该知识库」，这里会返回 A 的完整对话历史。
    const convA = await newConversation(tokenA, kbA);
    await seedMessages(convA.id, ['A 的私密内容']);

    await listMessages(tokenB, kbB, convA.id).expect(404);
  });

  it('用自己的 kbId + 别人的 conversationId 删除会话，返回 404 且会话还在', async () => {
    const convA = await newConversation(tokenA, kbA);

    await deleteConversation(tokenB, kbB, convA.id).expect(404);

    const still = await prisma.conversation.findUnique({
      where: { id: convA.id },
    });
    expect(still).not.toBeNull();
  });

  it('同一个用户也不能用自己的另一个知识库去访问会话', async () => {
    const convA = await newConversation(tokenA, kbA);
    // kbA2 也是 A 的，Guard 一定放行（不是 403），
    // 所以这里必须靠 service 层的「会话属于该知识库」校验挡住
    await listMessages(tokenA, kbA2, convA.id).expect(404);
  });

  it('会话不存在返回 404', async () => {
    await listMessages(tokenA, kbA, 999999).expect(404);
  });

  // ---------------- 删除 ----------------

  it('删除会话会级联删掉它的消息', async () => {
    const conv = await newConversation(tokenA, kbA);
    await seedMessages(conv.id, ['会被一起删掉']);

    expect(
      await prisma.message.count({ where: { conversationId: conv.id } }),
    ).toBe(1);

    await deleteConversation(tokenA, kbA, conv.id).expect(200);

    expect(
      await prisma.message.count({ where: { conversationId: conv.id } }),
    ).toBe(0);
  });
});
