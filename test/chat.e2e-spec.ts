import type { INestApplication } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import type { Server } from 'node:http';
import { basename, join } from 'node:path';
import request from 'supertest';
import { DOCUMENT_UPLOAD_DIR } from '../src/document/document.constant.js';
import { DOCUMENT_STATUS } from '../src/document/types/document.type.js';
import { ANSWER_SYSTEM_PROMPT } from '../src/chat/constants/answer.prompt.js';
import { NO_RESULT_SYSTEM_PROMPT } from '../src/chat/constants/no-result-system.prompt.js';
import { REWRITE_QUERY_SYSTEM_PROMPT } from '../src/chat/constants/rewrite-query.prompt.js';
import { LlmService } from '../src/llm/llm.service.js';
import type { ChatMessage } from '../src/llm/types/llm.type.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp } from './utils/create-test-app.js';

const PASSWORD = 'Abcd1234';

const CONCEPTS = ['苹果', '香蕉'];

/** 假 embedding：命中概念词就把对应维度置 1（固定向量会让排序和阈值都不生效） */
function fakeVector(text: string): number[] {
  return CONCEPTS.map((concept) => (text.includes(concept) ? 1 : 0));
}

/** 两段各 393 字 → 稳定切成 2 块，分别落在两个概念方向上 */
const DOC_TEXT = CONCEPTS.map((c) => `${c}：${'x'.repeat(390)}`).join('\n\n');

/** 改写分支的固定返回值 —— 故意带上「苹果」，这样它仍能召回对应片段 */
const REWRITE_MARKER = '苹果的改写标记';
const ANSWER_MARKER = '这是模型生成的回答';
const FALLBACK_MARKER = '我是知识库问答助手，你可以问我文档里的内容';

/**
 * 模拟「模型认得闲聊、原样返回」这个行为（对应 prompt 规则 6）。
 *
 * 为什么要在这里模拟它：**prompt 本身的效果用 fake 测不了** —— 那只能靠
 * test/rewrite.manual.e2e-spec.ts 用真实模型验（已验：8/8，三次输出一致）。
 *
 * fake 能测的是**另一半**：拿到「原样返回」之后，代码有没有走对分支 ——
 * 即「不带话题词 → 检索为空 → 兜底」，而不是拿着无关资料去生成。
 */
const CHITCHAT_INPUTS = ['在吗', '谢谢', '讲个笑话吧'];

describe('问答 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;

  const stamp = Date.now();
  let token = '';
  let kbId = 0;
  let docFileName = '';

  const createdFilePaths: string[] = [];

  /** 记录每次 chat 收到的 system prompt —— 用来断言「走了哪条分支」 */
  const chatSystemPrompts: string[] = [];
  /** 记录每次 embed 收到的文本 —— 用来断言「送去检索的 query 是哪一个」 */
  const embeddedTexts: string[] = [];
  /** 打开后，改写那次调用会抛错，用来验降级 */
  let rewriteShouldFail = false;

  /**
   * 假 LLM 必须按输入区分返回，否则编排的三个分支根本走不到。
   * 判别方式是看第一条 system 消息是不是那三个 prompt 之一。
   */
  const fakeLlm = {
    chat: (messages: ChatMessage[]) => {
      const systemPrompt = messages[0]?.content ?? '';
      chatSystemPrompts.push(systemPrompt);

      if (systemPrompt === REWRITE_QUERY_SYSTEM_PROMPT) {
        if (rewriteShouldFail) {
          return Promise.reject(new Error('模拟改写调用失败'));
        }
        // 闲聊原样返回，其余改写成一个带「苹果」的标记
        const lastMessage = messages[messages.length - 1]?.content ?? '';
        return Promise.resolve(
          CHITCHAT_INPUTS.includes(lastMessage) ? lastMessage : REWRITE_MARKER,
        );
      }
      if (systemPrompt === NO_RESULT_SYSTEM_PROMPT) {
        return Promise.resolve(FALLBACK_MARKER);
      }
      return Promise.resolve(ANSWER_MARKER);
    },
    embed: (texts: string[]) => {
      embeddedTexts.push(...texts);
      return Promise.resolve(texts.map(fakeVector));
    },
  } as unknown as LlmService;

  function auth() {
    return { Authorization: `Bearer ${token}` };
  }

  function diskPathOf(filePath: string) {
    return join(DOCUMENT_UPLOAD_DIR, basename(filePath));
  }

  /** 每个用例用自己的会话，避免互相污染历史 */
  async function newConversation() {
    const res = await request(server)
      .post(`/api/knowledge-bases/${kbId}/conversations`)
      .set(auth());
    if (res.status >= 300) {
      throw new Error(`创建会话失败: ${res.status}`);
    }
    return res.body.data.id as number;
  }

  /**
   * 提问。这里只要求 2xx，不硬断言具体状态码 ——
   * 状态码契约由单独一条用例守，否则一个状态码改动会把所有用例连带弄红，
   * 看不出真正的问题在哪。
   */
  async function send(conversationId: number, question: string) {
    const res = await request(server)
      .post(
        `/api/knowledge-bases/${kbId}/conversations/${conversationId}/messages`,
      )
      .set(auth())
      .send({ question });

    if (res.status >= 300) {
      throw new Error(`提问失败: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res;
  }

  async function waitDone(documentId: number) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const doc = await prisma.document.findUnique({
        where: { id: documentId },
      });
      if (doc?.status === DOCUMENT_STATUS.COMPLETED) return doc;
      if (doc?.status === DOCUMENT_STATUS.FAILED) {
        throw new Error(`文档处理失败: ${doc.errorMessage}`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('等待文档处理完成超时');
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
        name: 'chat-e2e',
        email: `chat-${stamp}@example.com`,
        password: PASSWORD,
      })
      .expect(201);
    token = reg.body.data.accessToken;

    const kb = await request(server)
      .post('/api/knowledge-bases')
      .set(auth())
      .send({ title: `问答测试库-${stamp}` })
      .expect(201);
    kbId = kb.body.data.id;

    const doc = await request(server)
      .post(`/api/knowledge-bases/${kbId}/documents`)
      .set(auth())
      .attach('file', Buffer.from(DOC_TEXT), {
        filename: 'fruits.md',
        contentType: 'text/plain',
      })
      .expect(201);

    createdFilePaths.push(doc.body.data.filePath);
    docFileName = doc.body.data.fileName;
    await waitDone(doc.body.data.id);
  });

  afterAll(async () => {
    for (const filePath of createdFilePaths) {
      await unlink(diskPathOf(filePath)).catch(() => {});
    }
    await app.close();
  });

  /** 每个用例开始前清掉记录，只留本次调用 */
  function resetRecorders() {
    chatSystemPrompts.length = 0;
    embeddedTexts.length = 0;
    rewriteShouldFail = false;
  }

  // ---------------- 鉴权 ----------------

  it('未带 token 提问返回 401', async () => {
    const conversationId = await newConversation();
    await request(server)
      .post(
        `/api/knowledge-bases/${kbId}/conversations/${conversationId}/messages`,
      )
      .send({ question: '苹果是什么' })
      .expect(401);
  });

  it('提问返回 200，而不是 201', async () => {
    // 虽然内部会往 Message 表插两条记录，但响应表达的是「本次问答的结果」，
    // 客户端不会拿一个 URL 去单独访问这条消息 —— 所以是 200 不是 201。
    // 换 SSE 之后更是如此（流式响应没有 201 的语义位置）。
    const conversationId = await newConversation();
    await request(server)
      .post(
        `/api/knowledge-bases/${kbId}/conversations/${conversationId}/messages`,
      )
      .set(auth())
      .send({ question: '苹果是什么' })
      .expect(200);
  });

  // ---------------- 正常问答 ----------------

  it('检索到内容时生成回答，并把用户/助手两条消息都落库', async () => {
    resetRecorders();
    const conversationId = await newConversation();

    const res = await send(conversationId, '苹果是什么');

    expect(res.body.data.content).toBe(ANSWER_MARKER);

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { id: 'asc' },
    });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].content).toBe('苹果是什么');
    expect(messages[1].content).toBe(ANSWER_MARKER);
  });

  it('sources 存的是快照：带上当时的原文、文件名和分数', async () => {
    resetRecorders();
    const conversationId = await newConversation();

    const res = await send(conversationId, '苹果是什么');
    const sources = res.body.data.sources as {
      fileName: string;
      chunkIndex: number;
      content: string;
      score: number;
      documentId: number;
    }[];

    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0].fileName).toBe(docFileName);
    expect(sources[0].chunkIndex).toBe(0);
    // 关键：存的是「当时的原文」，不是 documentId + chunkIndex 这种引用
    // 文档被删或重传后，引用会指向别的内容，快照不会
    expect(sources[0].content).toContain('苹果');
    expect(typeof sources[0].score).toBe('number');
  });

  // ---------------- 查询改写 ----------------

  it('第一轮没有历史，跳过改写，只调用一次模型', async () => {
    resetRecorders();
    const conversationId = await newConversation();

    await send(conversationId, '苹果是什么');

    // 只有「生成回答」那一次调用 —— 改写被短路了
    expect(chatSystemPrompts).toHaveLength(1);
    expect(chatSystemPrompts[0]).toContain(ANSWER_SYSTEM_PROMPT);
    // 检索用的就是原句
    expect(embeddedTexts).toContain('苹果是什么');
  });

  it('有历史时会做改写，且改写后的 query 真的被送去检索', async () => {
    resetRecorders();
    const conversationId = await newConversation();
    // 先制造一轮历史
    await send(conversationId, '苹果是什么');

    resetRecorders();
    await send(conversationId, '那它的价格呢');

    // 两次调用：先改写、再生成
    expect(chatSystemPrompts).toHaveLength(2);
    expect(chatSystemPrompts[0]).toBe(REWRITE_QUERY_SYSTEM_PROMPT);
    expect(chatSystemPrompts[1]).toContain(ANSWER_SYSTEM_PROMPT);
    // 改写的结果确实进入了检索，而不是被丢掉
    expect(embeddedTexts).toContain(REWRITE_MARKER);
    expect(embeddedTexts).not.toContain('那它的价格呢');
  });

  it('改写调用失败时降级用原始输入，回答照样返回', async () => {
    resetRecorders();
    const conversationId = await newConversation();
    await send(conversationId, '苹果是什么');

    resetRecorders();
    rewriteShouldFail = true;

    // 没崩，正常返回
    const res = await send(conversationId, '苹果的价格');

    expect(res.body.data.content).toBe(ANSWER_MARKER);
    // 降级生效：检索用的是原句，不是改写标记
    expect(embeddedTexts).toContain('苹果的价格');
    expect(embeddedTexts).not.toContain(REWRITE_MARKER);

    rewriteShouldFail = false;
  });

  // ---------------- 多轮之后的闲聊 ----------------

  it('多轮之后说闲聊：原样返回 → 检索为空 → 走兜底，不拿无关资料硬答', async () => {
    resetRecorders();
    const conversationId = await newConversation();
    // 先聊一轮，制造「上文有话题」的语境
    await send(conversationId, '苹果是什么');

    resetRecorders();
    const res = await send(conversationId, '在吗');

    // 有历史，所以改写确实被调用了
    expect(chatSystemPrompts[0]).toBe(REWRITE_QUERY_SYSTEM_PROMPT);
    // 关键①：送去检索的是原句，没有被塞进「苹果」这类上文话题词
    expect(embeddedTexts).toContain('在吗');
    expect(embeddedTexts).not.toContain(REWRITE_MARKER);
    // 关键②：没有走生成分支。
    // 一旦改写把话题塞进去，检索会「误命中」，然后模型被迫拿着无关资料回答 ——
    // 这比「检索为空」更糟，因为它绕过了兜底
    expect(
      chatSystemPrompts.some((p) => p.includes(ANSWER_SYSTEM_PROMPT)),
    ).toBe(false);
    expect(res.body.data.content).toBe(FALLBACK_MARKER);
  });

  // ---------------- 检索为空 ----------------

  it('检索为空时不走生成分支，返回兜底回复且 sources 为空', async () => {
    resetRecorders();
    const conversationId = await newConversation();

    const res = await send(conversationId, '完全无关的一句话');

    // 断言「没走生成分支」而不是「没调用模型」——
    // 后者在换成固定文案版时会假红，前者两种实现下都成立
    expect(
      chatSystemPrompts.some((p) => p.includes(ANSWER_SYSTEM_PROMPT)),
    ).toBe(false);
    // 走的是兜底分支
    expect(chatSystemPrompts).toContain(NO_RESULT_SYSTEM_PROMPT);
    expect(res.body.data.content).toBe(FALLBACK_MARKER);
    expect(res.body.data.sources).toEqual([]);

    // 兜底回复也要落库，否则下一轮历史里少一条
    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { id: 'asc' },
    });
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});
