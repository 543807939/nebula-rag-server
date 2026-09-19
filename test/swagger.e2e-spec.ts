import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app.js';

/** 只声明断言真正用到的字段，其余不管 —— 避免文档加字段就让测试脆断 */
type Operation = {
  tags?: string[];
  summary?: string;
  security?: Record<string, unknown>[];
  responses?: Record<string, { content?: Record<string, unknown> } | undefined>;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, Operation | undefined>>;
  components?: {
    securitySchemes?: Record<string, { type?: string; scheme?: string }>;
  };
};

const NO_PREFIX = '/knowledge-bases/{kbId}/conversations';
const MESSAGES_PATH = `${NO_PREFIX}/{conversationId}/messages`;

/**
 * 已经补全 Swagger 装饰器的接口。
 *
 * 现在只有 conversation / chat 两个 controller 加了注解，所以只断言这些；
 * 等 kb / document / auth 都补齐后，这里应该改成「除 auth 外的全部接口」——
 * 那时它才是真正有约束力的守卫。
 */
const DECORATED: { path: string; method: string; tag: string }[] = [
  { path: NO_PREFIX, method: 'post', tag: 'conversation' },
  { path: NO_PREFIX, method: 'get', tag: 'conversation' },
  { path: `${NO_PREFIX}/{conversationId}`, method: 'delete', tag: 'conversation' },
  { path: MESSAGES_PATH, method: 'get', tag: 'conversation' },
  { path: MESSAGES_PATH, method: 'post', tag: 'chat' },
];

describe('接口文档 (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let doc: OpenApiDocument;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();

    const res = await request(server).get('/api/docs-json');
    expect(res.status).toBe(200);
    doc = res.body as OpenApiDocument;
  });

  afterAll(async () => {
    await app.close();
  });

  /** 遍历全部 operation，省得每个用例自己拼路径 */
  function allOperations() {
    const methods = ['get', 'post', 'put', 'patch', 'delete'];
    return Object.entries(doc.paths).flatMap(([path, byMethod]) =>
      Object.entries(byMethod)
        .filter(([method]) => methods.includes(method))
        .map(([method, op]) => ({ path, method, op: op as Operation })),
    );
  }

  it('文档能生成，且路径带上了 /api 全局前缀', () => {
    // 前缀漏了的话，这里会看到 '/knowledge-bases/...'，
    // 而前端照着文档拼 URL 会 404 —— 属于「文档和实现不一致」里最坑的一种
    expect(Object.keys(doc.paths)).toContain(`/api${MESSAGES_PATH}`);
  });

  it('addBearerAuth 生效：文档里声明了 bearer securityScheme', () => {
    expect(doc.components?.securitySchemes?.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('已补装饰器的接口都带 @ApiBearerAuth', () => {
    const missing = DECORATED.filter(({ path, method }) => {
      const security = doc.paths[`/api${path}`]?.[method]?.security;
      return !security?.some((scheme) => 'bearer' in scheme);
    }).map(({ method, path }) => `${method.toUpperCase()} ${path}`);

    // 少一个 @ApiBearerAuth，文档里该接口就「看起来不需要鉴权」，
    // 前端照着做 → 上线 401，而且没人会主动发现
    expect(missing).toEqual([]);
  });

  it('已补装饰器的接口都有 summary 和正确的 tag', () => {
    const problems = DECORATED.flatMap(({ path, method, tag }) => {
      const op = doc.paths[`/api${path}`]?.[method];
      const issues: string[] = [];
      if (!op?.summary) {
        issues.push('缺 summary');
      }
      if (op?.tags?.join(',') !== tag) {
        issues.push(`tag 期望 ${tag}，实际 ${op?.tags?.join(',') ?? '无'}`);
      }
      return issues.map((issue) => `${method.toUpperCase()} ${path}：${issue}`);
    });

    expect(problems).toEqual([]);
  });

  it('全文没有留下 summary: \'...\' 这样的占位符', () => {
    // 占位符不会被编译器和 lint 拦住，但会在 UI 上原样显示
    const placeholders = allOperations()
      .filter(({ op }) => op.summary?.trim() === '...')
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);

    expect(placeholders).toEqual([]);
  });

  it('SSE 接口声明返回 text/event-stream，而不是默认的 application/json', () => {
    const content =
      doc.paths[`/api${MESSAGES_PATH}`]?.post?.responses?.['200']?.content;

    expect(Object.keys(content ?? {})).toEqual(['text/event-stream']);
    // summary 里必须点明它是流式，否则前端会按一次性响应去接
    expect(doc.paths[`/api${MESSAGES_PATH}`]?.post?.summary).toContain('SSE');
  });

  /**
   * ⚠️ 这里**不能**断言 DTO 字段（如 ChatDto.question）出现在文档里。
   *
   * `@ApiProperty` 是靠 Nest CLI plugin 在 **tsc 编译期**注入的，而 vitest 用
   * esbuild 转译，不跑那个 plugin —— 测试环境里 DTO 的 properties 必然是空的。
   * 想在测试里断言 DTO 字段，得改成手写 @ApiProperty；否则只能在
   * `pnpm start:dev` 起来后用 /api/docs-json 人工核对。
   */
});
