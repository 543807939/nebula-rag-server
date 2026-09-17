import type { INestApplication } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import type { Server } from 'node:http';
import { basename, join } from 'node:path';
import request from 'supertest';
import { AVATAR_UPLOAD_DIR } from '../src/upload/upload.constant.js';
import { createTestApp } from './utils/create-test-app.js';

const PASSWORD = 'Abcd1234';

describe('头像上传 (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  const stamp = Date.now();
  let token = '';
  const createdFilePaths: string[] = [];

  function auth() {
    return { Authorization: `Bearer ${token}` };
  }

  function diskPathOf(avatarPath: string) {
    return join(AVATAR_UPLOAD_DIR, basename(avatarPath));
  }

  async function uploadAvatar(filename: string) {
    const res = await request(server)
      .post('/api/upload/me/avatar')
      .set(auth())
      .attach('avatar', Buffer.from('fake-image-bytes'), {
        filename,
        contentType: 'image/png',
      })
      .expect(201);

    const avatar = res.body.data.avatar as string;
    createdFilePaths.push(avatar);
    return avatar;
  }

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();

    const reg = await request(server)
      .post('/api/auth/register')
      .send({
        name: 'avatar-e2e',
        email: `avatar-${stamp}@example.com`,
        password: PASSWORD,
      })
      .expect(201);
    token = reg.body.data.accessToken;
  });

  afterAll(async () => {
    for (const avatarPath of createdFilePaths) {
      await unlink(diskPathOf(avatarPath)).catch(() => {});
    }
    await app.close();
  });

  it('未带 token 上传返回 401', async () => {
    await request(server)
      .post('/api/upload/me/avatar')
      .attach('avatar', Buffer.from('x'), {
        filename: 'a.png',
        contentType: 'image/png',
      })
      .expect(401);
  });

  it('不支持的类型返回 400', async () => {
    await request(server)
      .post('/api/upload/me/avatar')
      .set(auth())
      .attach('avatar', Buffer.from('x'), {
        filename: 'a.exe',
        contentType: 'application/octet-stream',
      })
      .expect(400);
  });

  it('上传成功后 avatar 是 URL，文件真的落在磁盘上', async () => {
    const avatar = await uploadAvatar('first.png');

    expect(avatar.startsWith('/uploads/avatars/')).toBe(true);
    // 入库的是 URL，磁盘上要有对应的真实文件
    expect(existsSync(diskPathOf(avatar))).toBe(true);
  });

  it('再次上传会删掉旧头像文件', async () => {
    const first = await uploadAvatar('old.png');
    const firstDisk = diskPathOf(first);
    expect(existsSync(firstDisk)).toBe(true);

    const second = await uploadAvatar('new.png');

    // 关键断言：旧文件必须真的被删掉。
    // 历史上 removeFileSafely 被改成忽略 baseDir 参数、永远去 documents 目录找文件，
    // 导致头像删除静默失效 —— 这条断言就是为了拦住那类改动。
    expect(second).not.toBe(first);
    expect(existsSync(firstDisk)).toBe(false);
    expect(existsSync(diskPathOf(second))).toBe(true);
  });
});
