import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './utils/create-test-app.js';

describe('认证 + 用户 (e2e)', () => {
  let app: INestApplication;

  const email = `e2e-${Date.now()}@example.com`;
  const oldPassword = 'Abcd1234';
  const newPassword = 'Zxcv5678';

  let accessToken = '';
  let refreshToken = '';
  let userId = 0;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('注册成功并返回 token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'e2e', email, password: oldPassword })
      .expect(201);

    expect(res.body.code).toBe(0);
    expect(res.body.data.user.email).toBe(email);
    // 全局 omit 生效，响应里不能出现密码
    expect(res.body.data.user.password).toBeUndefined();

    accessToken = res.body.data.accessToken;
    refreshToken = res.body.data.refreshToken;
    userId = res.body.data.user.id;
  });

  it('重复注册返回 409', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'e2e', email, password: oldPassword })
      .expect(409);
  });

  it('密码不满足强度返回 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'e2e', email: `weak-${email}`, password: '123456' })
      .expect(400);
  });

  it('未带 token 访问 /users/me 返回 401', async () => {
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
  });

  it('GET /users/me 返回当前用户', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.data.id).toBe(userId);
  });

  it('PATCH /users/me 可以改昵称', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: '改名了' })
      .expect(200);

    expect(res.body.data.name).toBe('改名了');
  });

  it('旧密码错误时改密码返回 400', async () => {
    await request(app.getHttpServer())
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword: 'WrongPass1', newPassword })
      .expect(400);
  });

  it('改密码后，旧的 refreshToken 必须失效（验证事务）', async () => {
    await request(app.getHttpServer())
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ oldPassword, newPassword })
      .expect(200);

    // 核心断言：密码更新和 token 撤销必须在同一事务里一起提交
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('新密码可以登录，旧密码不行', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: oldPassword })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: newPassword })
      .expect(200);
  });
});
