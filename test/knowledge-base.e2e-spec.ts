import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ROLE_TYPE } from '../src/auth/constant/role.constant.js';
import { createTestApp } from './utils/create-test-app.js';

const PASSWORD = 'Abcd1234';

describe('知识库 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Server;

  const stamp = Date.now();
  const emailA = `kb-a-${stamp}@example.com`;
  const emailB = `kb-b-${stamp}@example.com`;
  const emailAdmin = `kb-admin-${stamp}@example.com`;

  let idA = 0;
  let tokenA = '';
  let tokenB = '';
  let tokenAdmin = '';
  /** A 的主知识库，后面大部分用例都围绕它 */
  let kbAId = 0;

  function auth(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  async function register(email: string) {
    const res = await request(server)
      .post('/api/auth/register')
      .send({ name: 'kb-e2e', email, password: PASSWORD })
      .expect(201);
    return {
      userId: res.body.data.user.id as number,
      token: res.body.data.accessToken as string,
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    server = app.getHttpServer();

    const a = await register(emailA);
    idA = a.userId;
    tokenA = a.token;

    tokenB = (await register(emailB)).token;

    const admin = await register(emailAdmin);
    // 没有「注册管理员」的接口，只能在库里直接把角色改掉
    await prisma.user.update({
      where: { id: admin.userId },
      data: { role: ROLE_TYPE.ADMIN },
    });
    // 关键：access token 里的 role 是签发时写死的，
    // 改完数据库必须重新登录，才能拿到 role=admin 的 token
    const login = await request(server)
      .post('/api/auth/login')
      .send({ email: emailAdmin, password: PASSWORD })
      .expect(200);
    tokenAdmin = login.body.data.accessToken;

    // A 建一个知识库，作为后续用例的素材
    const created = await request(server)
      .post('/api/knowledge-bases')
      .set(auth(tokenA))
      .send({ title: 'A 的知识库', description: '初始描述' })
      .expect(201);
    kbAId = created.body.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------- 鉴权 ----------------

  it('未带 token 访问知识库列表返回 401', async () => {
    await request(server).get('/api/knowledge-bases').expect(401);
  });

  // ---------------- 创建 ----------------

  it('创建成功，且 userId 取自 token 而不是请求体', async () => {
    const res = await request(server)
      .post('/api/knowledge-bases')
      .set(auth(tokenA))
      .send({ title: `新建的库-${stamp}` })
      .expect(201);

    expect(res.body.code).toBe(0);
    // 请求体里根本没传 userId，服务端必须自己从 token 里取
    expect(res.body.data.userId).toBe(idA);
    expect(res.body.data.title).toBe(`新建的库-${stamp}`);
  });

  it('同一用户重名创建返回 409', async () => {
    await request(server)
      .post('/api/knowledge-bases')
      .set(auth(tokenA))
      .send({ title: 'A 的知识库' })
      .expect(409);
  });

  it('不同用户可以使用同名', async () => {
    // 唯一约束是 (userId, title)，A 用过的名字 B 应该能用
    await request(server)
      .post('/api/knowledge-bases')
      .set(auth(tokenB))
      .send({ title: 'A 的知识库' })
      .expect(201);
  });

  it('请求体里夹带 userId 会被 400 拒绝（防越权字段）', async () => {
    await request(server)
      .post('/api/knowledge-bases')
      .set(auth(tokenA))
      .send({ title: `越权尝试-${stamp}`, userId: 999999 })
      .expect(400);
  });

  it('title 超长返回 400', async () => {
    await request(server)
      .post('/api/knowledge-bases')
      .set(auth(tokenA))
      .send({ title: 'x'.repeat(31) })
      .expect(400);
  });

  // ---------------- 列表与隔离 ----------------

  it('列表只返回自己的知识库', async () => {
    const res = await request(server)
      .get('/api/knowledge-bases')
      .set(auth(tokenA))
      .expect(200);

    expect(res.body.data.total).toBeGreaterThan(0);
    // 每一条的 userId 都必须是自己的
    for (const item of res.body.data.list) {
      expect(item.userId).toBe(idA);
    }
  });

  it('B 的列表里看不到 A 的知识库（数据隔离）', async () => {
    const res = await request(server)
      .get('/api/knowledge-bases')
      .set(auth(tokenB))
      .expect(200);

    // B 只建过一个同名库，列表里绝不该出现 A 的那条
    for (const item of res.body.data.list) {
      expect(item.id).not.toBe(kbAId);
    }
  });

  it('size 超过上限返回 400', async () => {
    await request(server)
      .get('/api/knowledge-bases?size=101')
      .set(auth(tokenA))
      .expect(400);
  });

  it('page 非整数返回 400', async () => {
    await request(server)
      .get('/api/knowledge-bases?page=abc')
      .set(auth(tokenA))
      .expect(400);
  });

  // ---------------- 越权（核心） ----------------

  it('B 读取 A 的知识库返回 403', async () => {
    await request(server)
      .get(`/api/knowledge-bases/${kbAId}`)
      .set(auth(tokenB))
      .expect(403);
  });

  it('B 修改 A 的知识库返回 403', async () => {
    await request(server)
      .patch(`/api/knowledge-bases/${kbAId}`)
      .set(auth(tokenB))
      .send({ title: '我要改别人的' })
      .expect(403);
  });

  it('B 删除 A 的知识库返回 403，且 A 的数据没被改动', async () => {
    await request(server)
      .delete(`/api/knowledge-bases/${kbAId}`)
      .set(auth(tokenB))
      .expect(403);

    // 确认 A 的知识库还在
    await request(server)
      .get(`/api/knowledge-bases/${kbAId}`)
      .set(auth(tokenA))
      .expect(200);
  });

  it('PATCH 请求体里夹带 userId 会被 400 拒绝（防批量赋值）', async () => {
    await request(server)
      .patch(`/api/knowledge-bases/${kbAId}`)
      .set(auth(tokenA))
      .send({ userId: 999999 })
      .expect(400);
  });

  it('不存在的 id 返回 404', async () => {
    await request(server)
      .get('/api/knowledge-bases/999999')
      .set(auth(tokenA))
      .expect(404);
  });

  it('非数字 id 返回 400（守卫先于管道执行）', async () => {
    await request(server)
      .get('/api/knowledge-bases/abc')
      .set(auth(tokenA))
      .expect(400);
  });

  // ---------------- 修改 ----------------

  it('A 可以修改自己的知识库', async () => {
    const res = await request(server)
      .patch(`/api/knowledge-bases/${kbAId}`)
      .set(auth(tokenA))
      .send({ title: `改过的标题-${stamp}` })
      .expect(200);

    expect(res.body.data.title).toBe(`改过的标题-${stamp}`);
  });

  it('改成同用户下已存在的名字返回 409', async () => {
    // 先建一个用来占名的库
    await request(server)
      .post('/api/knowledge-bases')
      .set(auth(tokenA))
      .send({ title: `占位库-${stamp}` })
      .expect(201);

    await request(server)
      .patch(`/api/knowledge-bases/${kbAId}`)
      .set(auth(tokenA))
      .send({ title: `占位库-${stamp}` })
      .expect(409);
  });

  it('空请求体返回 400', async () => {
    await request(server)
      .patch(`/api/knowledge-bases/${kbAId}`)
      .set(auth(tokenA))
      .send({})
      .expect(400);
  });

  // ---------------- admin 放行 ----------------

  it('admin 可以读取别人的知识库', async () => {
    await request(server)
      .get(`/api/knowledge-bases/${kbAId}`)
      .set(auth(tokenAdmin))
      .expect(200);
  });

  it('admin 可以修改别人的知识库（守卫放行后服务层不能再拦）', async () => {
    const res = await request(server)
      .patch(`/api/knowledge-bases/${kbAId}`)
      .set(auth(tokenAdmin))
      .send({ title: `管理员改的-${stamp}` })
      .expect(200);

    expect(res.body.data.title).toBe(`管理员改的-${stamp}`);
  });

  // ---------------- 删除（放最后，会破坏前面的素材） ----------------

  it('A 删除自己的知识库后，再查返回 404', async () => {
    await request(server)
      .delete(`/api/knowledge-bases/${kbAId}`)
      .set(auth(tokenA))
      .expect(200);

    await request(server)
      .get(`/api/knowledge-bases/${kbAId}`)
      .set(auth(tokenA))
      .expect(404);
  });
});
