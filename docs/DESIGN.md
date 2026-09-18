# Nebula RAG — 设计文档

## 1. 项目简介

一句话：多用户数据隔离的 AI 知识库问答系统，支持多格式文档上传、基于文档的问答、多轮对话。

api约定
URL 路径用 kebab-case + 复数
JSON 字段用 camelCase

模型 embedding固定使用embedding-3 2048维,换模型或维度会是历史向量失效

## 2. 核心功能

- 用户认证与角色权限（user / admin）
- 头像上传（本地磁盘 + 静态资源托管）
- 知识库管理（多租户隔离）
- 文档上传与解析（智谱文件解析 API）
- 基于文档的问答（流式输出）
- 多轮对话（指代消解 + 话题漂移检测）

## 3. 技术选型

| 层       | 选型            | 理由                                          |
| -------- | --------------- | --------------------------------------------- |
| 后端框架 | NestJS 12       | 前端转全栈,nest框架生态成熟且容易上手         |
| ORM      | Prisma          | 兼容多种数据库 后续sqlite换成其他数据库时简单 |
| 数据库   | SQLite（开发）  | 开发过程中足够                                |
| 缓存     | Redis           | 缓存最近对话                                  |
| LLM      | 智谱 GLM        | 价格低功能全 学习阶段够用                     |
| 前端     | React 19 + Vite | 生态成熟 Vite冷启动快 组件化适配流式 UI       |

## 4. 数据模型

model User {
id Int @id @default(autoincrement())
name String
email String @unique
password String
role String @default("user")
avatar String?
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
knowledgeBases KnowledgeBase[]
refreshTokens RefreshToken[]
}

model RefreshToken {
id Int @id @default(autoincrement())
jti String @unique
user User @relation(fields: [userId], references: [id], onDelete: Cascade)
userId Int
expiresAt DateTime // 过期时间
revokedAt DateTime? // 撤销时间
createdAt DateTime @default(now())

@@index([userId])
}

model KnowledgeBase {
id Int @id @default(autoincrement())
title String
description String?
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt

user User @relation(fields: [userId], references: [id], onDelete: Cascade)
userId Int
conversations Conversation[]
documents Document[]

@@index([userId])
}

model Document {
id Int @id @default(autoincrement())
fileName String
fileType String
filePath String
fileSize Int
status String @default("pending")
errorMessage String?
knowledgeBase KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
knowledgeBaseId Int
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
chunks Chunk[]

@@index([knowledgeBaseId])
}

model Chunk {
id Int @id @default(autoincrement())
chunkIndex Int
content String
embedding String
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
document Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
documentId Int

@@index([documentId])
}

model Conversation {
id Int @id @default(autoincrement())
title String @default("新对话")
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
messages Message[]
knowledgeBase KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
knowledgeBaseId Int

@@index([knowledgeBaseId])
}

model Message {
id Int @id @default(autoincrement())
content String
role String
sources Json?
createdAt DateTime @default(now())
updatedAt DateTime @updatedAt
conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
conversationId Int

@@index([conversationId])
}

## 5. 核心流程

### 5.1 文档摄取

上传 → 解析 → 分块 → 向量化 → 入库
上传=>纯文本/md =>直接解析成utf-8=>优先基于段落分割,若不满500字多段落拼接500字,overlap 50字,确保句子语义完整.=>向量化=>入库
如果不是纯文本/md 调用智谱的文件识别 =>轮询是否解析完成=>基于解析完成的内容入库

上传落库之后状态为pending,之后开始在后台执行向量化,修改document状态为processing,根据向量化结果,若成功则将向量化结果落库(分批处理分配落库),并修改状态为completed;若失败则修改状态为failed,并将错误信息落库

程序关闭的时候可能还会有一些文档processing中或者写入chunk了,但是未来得及修改状态,为了避免重复写入chunk,每次解析文档之前都需要将document的chunk清空.

程序开始运行的时候,需要将所有processing和pending的文档的chunk清空,状态设置为pending,并开始解析.

设置定时任务(每五分钟)将超时还没结果的文档状态设置为failed,并将pending状态文件状态设置为processing,并开始解析.

### 5.2 问答流程

（一张流程图：查询理解 → 召回 → 精排 → 阈值 → 生成 → 流式返回）
用户输入=>带历史记录意图查询=>表述不清=>返回合适的词
用户输入=>带历史记录意图查询=>非表述不清=>返回合适的query=>基于query调向量库返回余弦相似度最高的K个=>过滤掉相似度过低的=>若没有就直接返回 有的话走下一步=>rerank返回3个=>拼接提示词 基于query和rerank三个分数最高的原文=>调用大模型=>返回结果

检索必须过滤 document.status = completed。分批落库后，失败的文档会残留部分 chunk

### 5.3 认证与会话

#### Token 设计

双 token：access token + refresh token

| 项       | access token   | refresh token     |
| -------- | -------------- | ----------------- |
| 载体     | JWT（无状态）  | JWT，但 jti 落库  |
| 有效期   | 15 分钟        | 30 天             |
| 校验方式 | 仅验签，不查库 | 验签 + 查库判撤销 |
| 主动作废 | 不能           | 能（撤销 jti）    |

为什么这样分：access token 无状态、签发后无法主动作废，**它的 TTL 就是泄露之后的危害窗口**，所以必须短；refresh token 有状态、可以被吊销，风险可控，所以可以长。

校验要区分两层，不要混淆：

- **签名验证** —— 防伪造、防篡改。JWT 默认**不加密**，header 和 payload 只是 base64url 编码，任何人拿到都能读出来（所以 JWT 不能放敏感信息），signature 只保证内容没被改过。
- **jti 查库** —— 判断「是否已被撤销」。篡改在签名层就被拦下了，根本走不到查库这一步。

因此双 token 的核心动机是：**用有状态的 refresh token，去补无状态 access token 不可撤销的缺陷**。

#### 登录与鉴权

- 登录：校验账号密码 → 签发一对 token，refresh token 的 jti 落库
- 鉴权：全局守卫 `JwtAuthGuard`（`APP_GUARD`）验签 → 校验 `tokenType` → 把 `{ sub, role }` 挂到 `request.user`；`@Public()` 标记的路由跳过

#### 刷新流程

refreshToken → 验签 → 校验 tokenType 与 jti 是否存在 → 判断 `revokedAt` → 撤销旧记录 → 签发新的一对 token。

**轮转（rotation）是重放检测能成立的前提。** 它把「一个 refresh token 在 30 天内可以反复使用」压缩成「一次只能用一次」。否则 token 被复制成两份之后，两份永远撞不上，就永远发现不了泄露。

#### 异常处理

- **重放检测**：用一个「已撤销但仍未过期」的 refresh token 发请求 —— 正常流程下被撤销的 token 不会再出现，它又出现了，说明这个 token 存在两份拷贝，判定为 **refresh token 泄露**。处理方式是撤销该用户全部会话并打 warn 日志。
  因为无法区分攻击者和本人，只能把全部会话踢掉让本人重新登录 —— 安全优先于可用性。
  注意这条**只覆盖「refresh token 被复制」**，检测不到「密码泄露后攻击者自行登录」；后者由改密码兜底。
- **改密码**：在同一个事务里做三件事 —— 校验旧密码 → 用新 hash 覆盖旧密码 → 撤销该用户全部 refresh token。攻击者旧密码失效、refresh token 全废，只剩最多 15 分钟的 access token 残窗，之后彻底出局。
- **并发刷新**：前端并发 401 会让多个请求携带**同一个已被轮转过的**旧 refresh token，从而触发重放误判、把自己踢下线。前端用单飞锁处理：同一时刻只允许一个刷新请求，其余请求等待**同一个 Promise**，拿到新 token 后重放原请求。（是「等待并重试」，只锁不重试会让后续请求直接失败。）
- **过期清理**：`RefreshTokenCleanupService` 每天 03:00 删除 `expiresAt < now` 的记录。**已撤销但未过期的记录必须保留** —— 它是重放检测的依据，提前删掉会让泄露永远无法被识别出来。

### 5.4 权限模型

三层：认证 → 角色 → 资源归属

1. **认证**：全局 `JwtAuthGuard`，`@Public()` 排除
2. **角色**：user / admin。admin 可以管理所有知识库，user 只能管理自己创建的
3. **资源归属**：（随知识库模块实现）每个操作知识库的接口都要校验 `kb.userId === 当前用户`，admin 放行。校验逻辑集中到 Guard，不散落在各个 handler 里

## 6. 关键技术决策

- 为什么用「向量召回 + reRank 精排」两阶段检索？
  向量检索是基于向量的余弦相似度计算的,越接近1代表关联度越强,但是精度有限
  reRank,能建模词级别的交互关系,准确度更高,但是比较慢,也贵.
  所以先粗筛出最相关的几项,然后再精排.
  单纯用reRank效果会更好,但是reRank会调用模型,速度慢,收费高,目前的方案是权衡之后的方案.

- 为什么历史只用于「查询理解」、不用于「生成」？
  查询理解是为了确保用户输入上下文强相关的内容时,粗排检索不到内容. 查询理解之后会生成新的query语句,用新的query语句来生成回答 query已经足够 如果带上上下文如果语义偏差太大会导致话题漂移 token也比较多

- 为什么 sources 存快照而不是引用？
  历史记录是已发送的,应该保存当时的内容,不因为未来的操作而变化.

- 为什么会话绑定知识库、而不是绑定文档？
  会话检索内容是它所属的知识库 而不是某一篇文档
  如果绑定文档会导致无法跨文档检索,知识库新增文档之后旧对话用不上

- 为什么用 KnowledgeBase 实体而不是「一个对话一个库」？
  "一个对话一个库"把「资料」和「会话」耦合死了，导致同一份资料被重复摄取、无法复用、无法沉淀。抽离出 KnowledgeBase 实体后，资料成为用户长期拥有的一等资源，对话只是对它的引用 —— 一次上传，多处复用。

- 为什么 refresh token 要落库，而不是让两个 token 都做成无状态？
  access token 无状态、签发后无法主动作废，用户登出或改密码后它在 TTL 内依然可用。要让「登出」和「改密码」真正生效，就必须有一个可被吊销的凭证，refresh token 承担这个角色：jti 落库，撤销即失效。代价是刷新时要查库，但刷新的频率远低于普通请求，可以接受。

- 为什么 refresh token 表里存的是 jti，而不是 token 字符串本身？
  jti 只是一个「引用」，不构成凭证。数据库泄露时，攻击者拿到 jti 既伪造不出签名有效的 token（拿不到 refresh secret），也无法直接拿去请求。如果存 token 本体，泄露就等于账号被接管，攻击者能一直换新 token 直到过期。附带好处：jti 是 UUID，比 JWT 字符串短，索引更小。

- 为什么重放检测要「撤销该用户全部会话」，而不是只拒绝这一次请求？
  无法判断这枚 token 现在握在攻击者手里还是本人手里，也不知道攻击者是否已经用别的会话做过什么。只拒绝一次等于放走攻击者。撤销全部会话让本人重新登录，是安全优先于可用性的取舍；同时打 warn 日志留痕，便于事后排查。

- 为什么「更新密码」和「撤销 refresh token」必须放在同一个事务里？
  两步分开会出现两种坏结果：只改密码不撤销 —— 攻击者的 refresh token 仍能续期，改密码等于白改；只撤销不改密码 —— 用户莫名全端下线，而攻击者照样能用旧密码重新登录。用事务保证「密码换掉」和「旧会话作废」同时发生。

- 为什么改密码后 access token 还能用最多 15 分钟，不立即失效？
  access token 是无状态的，签发之后服务端不再持有它的任何记录，所以无法提前作废 —— 这是无状态换来的性能优势所付出的代价。15 分钟的残窗在一般系统里可以接受。若要立即失效，方案是给 User 加 tokenVersion 字段并签进 JWT，守卫比对版本号，改密码时 version++；但代价是**每个请求都要多查一次库**，等于放弃了无状态的核心优势。所以更实际的做法是把 tokenVersion 缓存到 Redis，或者只在敏感操作上校验。

- 为什么轮转还不够，需要「会话绝对过期」？
  轮转只能让「同一 token 在两处被使用」暴露出来。如果 refresh token 被窃取、而受害者的那台设备不再使用（比如 token 是从日志或备份里扒出来的），拷贝只剩攻击者一份，永远不会撞车，重放检测也就永远不触发 —— 攻击者靠轮转每 30 天续一次，可以无限期挂着。所以需要一个从首次登录算起的硬上限（如 90 天），轮转时继承原始的绝对过期时间，而不是每次都重置。
  注意：这条只对「refresh token 被窃取」有意义，对「密码泄露」无效 —— 攻击者拿还能用的密码重新登录，就又是一个全新的会话。

- 为什么头像存 /uploads/avatars/x.webp 这种相对路径，而不是含 host 的完整 URL？
  持久化层不该耦合部署信息。host 和协议属于「环境」，不属于「数据」：同一条头像记录，本地是 localhost:3000、测试机是内网 IP、生产是域名 + HTTPS。存成绝对 URL 等于把数据绑死在某一个环境上，换域名或上 HTTPS 时历史数据会全部失效。前端本来就知道自己的 API base，拼接是零成本的。

- 为什么 run() 必须幂等？
  目前能触发它的路径有三条: 文档入库后,进程启动时恢复,定时任务触发,如果不开始前清空文档的chunks,那么文档的chunk可能会重复(分批入库和更新状态不在一个事务里,是串行任务).

- 为什么需要「启动时重置」，而不是只靠 cron 超时兜底？
  定时任务中将超时的任务状态设置为failed,将pending的文件状态设置为processing并开始处理
  若是遇到文档chunk入库到一半程序停止运行,则文档状态还是processing,chunk已有内容,文档向量化没问题,但是只能等定时任务将状态标记为failed,等用户重新上传处理.
  启动时重置,可以让这种任务重新处理,减少用户操作

- 为什么判死卡住的文档用 updatedAt 而不是 createdAt？
  超时的语义是「多久没动静了」，不是「创建多久了」。
  文档处理时chunk分配处理分配落库,每次分配落库时更新document的updatedAt,所以用updatedAt来判断是否超时.

## 7. 演进方向

- SQLite → PostgreSQL + pgvector
- 向量以JSON字符串存chunk.embedding,检索时全量加载内存算余弦相似度 → embedding改用pgvector + ANN 索引
- 会话历史 → 摘要压缩
- 部署方案
- 上传文件落本地磁盘 → 对象存储（且多实例下本地磁盘本身就不成立）
- CORS 配置（前端联调时就要）
- 引入 Session 实体 + 会话绝对过期，限制 refresh token 被窃取后的有效时长
- 「我的登录设备」列表 + 强制下线指定设备
- tokenVersion 让 access token 立即失效（配合 Redis 缓存）
- 多实例部署时@Cron会重复执行,需要分布式锁,启动时恢复同理,每个实例启动都会重置文档状态并开始处理(处理需要调用第三方模型,烧token).
