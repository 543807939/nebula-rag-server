# Nebula RAG Server

多用户数据隔离的 AI 知识库问答服务：支持多格式文档上传、基于文档的问答、多轮对话。

设计文档见 [docs/DESIGN.md](docs/DESIGN.md)。

## 功能

- 用户认证与角色权限（user / admin），access + refresh 双 token
- 头像上传（本地磁盘 + 静态资源托管）
- 知识库管理（多租户隔离）
- 文档上传与解析（智谱文件解析 API）
- 基于文档的问答（流式输出）
- 多轮对话（指代消解 + 话题漂移检测）

## 技术栈

| 层     | 选型              |
| ------ | ----------------- |
| 框架   | NestJS 12         |
| ORM    | Prisma 6          |
| 数据库 | SQLite（开发）    |
| 缓存   | Redis             |
| LLM    | 智谱 GLM          |
| 测试   | Vitest + Supertest |

## 快速开始

### 环境要求

- Node.js >= 20
- pnpm

### 安装依赖

```bash
pnpm install
```

### 配置环境变量

复制 `.env.example` 为 `.env` 并按需修改：

```bash
cp .env.example .env
```

| 变量                 | 说明                                                          |
| -------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`       | SQLite 连接串。**相对路径是相对 `prisma/` 目录解析的**，`file:./dev.db` 实际落在 `prisma/dev.db` |
| `JWT_ACCESS_SECRET`  | access token 签名密钥                                          |
| `JWT_REFRESH_SECRET` | refresh token 签名密钥                                         |
| `PORT`               | 服务端口，默认 3000                                            |

### 初始化数据库

```bash
pnpm prisma:migrate:dev
```

### 启动

```bash
pnpm start:dev
```

默认监听 `http://localhost:3000`，所有接口带 `/api` 前缀。

## 常用脚本

| 命令                  | 说明                                          |
| --------------------- | --------------------------------------------- |
| `pnpm start:dev`      | 开发模式（watch）                             |
| `pnpm build`          | 构建（会先执行 `prisma generate`）            |
| `pnpm start:prod`     | 以生产模式运行 `dist/main`                    |
| `pnpm test`           | 单元测试                                      |
| `pnpm test:e2e`       | e2e 测试（会重建 `prisma/test.db`）           |
| `pnpm lint`           | oxlint                                        |
| `pnpm prisma:studio`  | 打开 Prisma Studio                            |

> 注意：`pnpm start:dev` 运行时会锁住 Prisma 的 query engine，此时 `pnpm build` 里的 `prisma generate` 可能报 `EPERM`。先停掉 watch 再构建。

## 目录结构

```
src/
  auth/         认证：登录 / 注册 / 刷新 / 登出、JWT 双 token、全局守卫
  user/         用户资料
  upload/       文件上传（头像）
  common/       跨模块基础设施：装饰器、守卫、过滤器、拦截器、常量
  prisma/       PrismaService
  generated/    Prisma 生成的客户端（不入库）
test/           e2e 测试
docs/           设计文档
prisma/         schema、迁移、本地数据库文件
uploads/        上传文件落盘目录（不入库）
```

## 测试

e2e 使用独立的 SQLite 文件 `prisma/test.db`，每次运行前通过 `prisma db push --force-reset` 重建，不会影响开发数据。

```bash
pnpm test:e2e
```

> `main.ts` 里的全局配置（`ValidationPipe`、`setGlobalPrefix('api')`、静态资源托管）**不会被 e2e 自动继承**，`test/auth.e2e-spec.ts` 中手动补了一遍，新增 e2e 时注意同样处理。

## 许可

UNLICENSED（个人学习项目）
