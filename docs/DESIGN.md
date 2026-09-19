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

目标流程：查询理解 → 召回 → 精排（rerank）→ 阈值 → 生成 → 流式返回

**目前已实现到「查询理解 + 召回 + 阈值 + 生成（非流式）」**，rerank 与 SSE 流式待补。
（把实现边界写出来，避免文档跑到代码前面 —— 文档写了代码没有，是最容易露馅的一类不一致）

#### 已实现的链路

1. 取该会话最近 10 条历史（正序）
2. 落库用户消息
3. **查询改写**
   - 没有历史 → 直接用原句，不调用模型（省一次调用，第一轮的输入本身就是完整 query）
   - 有历史 → 一次 chat（temperature 0），把指代 / 省略补全成自包含的 query
   - 调用失败、清洗后为空、或长度异常 → 降级用原句（改写只是优化，不该让请求失败）
4. **召回**：`retrieve(query, kbId)`
   - 必须过滤 `document.status = completed`：分批落库后，失败的文档会残留部分 chunk
5. **分支**
   - 命中 → 拼提示词（带编号的原文）→ 生成（temperature 0.3）→ 落库
   - 为空 → 见下一节
6. `sources` 以**快照**形式落库（见 §6）

#### 检索为空：一次调用同时做两件事

闲聊和「资料里确实没有」都会落到这里。用一次 chat 调用同时完成判断和回复：

- 寒暄 / 与知识库无关 → 友好回应，并引导用户问文档相关的问题
- 确实是知识库问题、只是资料里没有 → 说明没找到，建议换个说法再问

temperature 取 0.2 且 prompt 里重复强调「不要编造」—— 这条路径上模型**没有资料可依据**，
是全链路幻觉风险最高的地方。调用失败或返回空 → 降级到固定文案，不让它变成 500。

#### 前端要用的一个约定

`role === 'assistant' && sources.length === 0` ⇒ 这是兜底回复，说明没有召回到相关文档。
（成立的前提：检索为空就不会走生成，两者互斥）

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
  实测（同检索阈值的标定数据）也印证了这一点：
  一次查询里第一名和第三名的分数只差 0.024（0.4257 / 0.4048 / 0.4021），
  也就是说余弦只能决定「要不要召回」，决定不了「谁更相关」。

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

- 检索阈值（0.35）是怎么定出来的？
  不能拍脑袋。用一个手动验证脚本 `test/retrieval.manual.e2e-spec.ts` 在真实模型上测量
  「相关查询」和「无关查询」的分数分布，阈值取在两者之间。

  实测（2026-09-19 / embedding-3 / 2048 维 / 4 份中文政策文档共 9 块 chunk）：
  - 无关查询最高分 **0.2475**（3 条固定问题）
  - 相关查询最低分 **0.4257**（每份文档由模型生成 3 个问题，多轮取最坏值）
  - 取 **0.35**：距下界 0.10、距上界 0.076，两侧都留了余量

  两个容易踩的点：
  1. **只采一次定不准。** 多轮跑出来的「相关查询最低分」是 0.4257 / 0.5017 / 0.4423 ——
     因为查询由模型生成（temperature 0.7），措辞每次都不同；而无关查询是固定字符串，
     分数几乎不动（0.2475 / 0.2474 / 0.2475）。所以样本量要够，并且要取最坏情况。
  2. **单次结果会随模型版本漂移**，换 embedding 模型后必须重新标定。

  为什么不用自动化测试守住：自动化测试里 LlmService 是假的，分数只有 1 和 0，
  阈值这条路径**永远验证不到**，只能手动标定。

- 为什么已知智谱向量已经 L2 归一化，代码里还要除模长？
  实测（同上）embedding-3 返回的向量范数恒为 1.000000，所以点积就等于余弦，
  除模长在数值上是多余的。
  但不除就等于把「模型恰好做了归一化」当成契约：换模型（甚至同一模型换版本）
  这个假设就可能不成立，而它的失效方式是**排序整体错乱且不报错**。
  代价只是两次乘法和一次开方，相对于一次网络调用可以忽略，所以保留完整公式。

- 为什么闲聊识别放在「检索为空」之后，而不是前置？
  先说清楚它的成本定位：两种做法**都不省调用**，区别是「谁付钱」。

  四条路径的 chat 调用次数只有两档，只取决于有没有历史，和闲聊 / 正常无关：
  - 第一轮 + 命中 → 1 次（生成）
  - 第一轮 + 为空 → 1 次（兜底）
  - 多轮 + 命中 → 2 次（改写 + 生成）
  - 多轮 + 为空 → 2 次（改写 + 兜底）

  所以「识别出闲聊」一步都没省。后置方案的价值不是「省」，而是「**不增加**」：
  闲聊走的是「检索为空」这条路，而这条路本来就要产生一条回复，
  把固定文案换成一次模型调用是 0 → 1 的增量，只影响这一条路。
  前置分类则是**所有请求** 0 → 1 的增量：按闲聊占比 5%、有历史占比 70% 估算，
  平均每次请求的 chat 次数是后置 1.70 / 前置 2.70，前置贵约 37%，
  换来的只是「提前拦下那 5%」。为低频场景给全链路加开销，不划算。

  另一个硬理由：改写那一步只在有历史时才调用（没有历史就直接短路），
  而闲聊在第一轮同样会发生 —— 把它合并进改写，第一轮就漏掉了。

  一句话总结：**「检索为空」本身就是一次免费的意图判断**，
  它已经说明了「这不是一个能在这个知识库里被回答的问题」。
  闲聊识别不是独立功能，而是这条已有路径的副产品。

- 为什么改写 prompt 要显式处理「非知识库问题」？
  因为改写的失败模式不是「检索不到」，而是「**检索到错的东西**」。

  多轮对话之后用户说「在吗」，模型看到上文在聊 P0 故障，又不想违背
  「必须输出一个可独立使用的检索查询」，很容易吐出「关于 P0 故障，在吗？」。
  这个 query 带着话题词，**余弦分数可能很高** —— 检索会「误命中」，
  从而绕过「检索为空」的兜底，让模型拿着一堆无关资料硬答。
  这比"检索为空"更糟：空至少能兜底，误命中只能硬答。

  所以 prompt 里显式加了一条规则和一个示例：非知识库问题原样返回，
  不要为了「像查询」而强行补全，也不要把上文话题硬塞进去。
  改完之后「在吗」原样返回 → 检索为空 → 落到兜底分支，一个已有机制就接住了。

  残留风险：这个方案依赖「『在吗』这类短句的余弦分数低于阈值」。
  实测数据支持（无关查询最高 0.2475，阈值 0.35），但这是概率性的，不是保证。

  验证方式：prompt 的效果**不能用自动化测试守**（fake 是我们自己写死的，
  测它等于自问自答），只能用 `test/rewrite.manual.e2e-spec.ts` 在真实模型上看输出。
  那个文件同时也是这个 prompt 的**回归样本集** —— 线上遇到一次"改写坏了"就加一条。

- 为什么用 POST + @Res() 手写 SSE，而不是 NestJS 的 @Sse()？
  三个原因，从硬到软：

  1. **`@Sse()` 注册的是 GET 路由。** 它本质上是 `@Get()` + SSE 处理，设计上是配合浏览器
     原生 `EventSource` 的 —— 而 **`EventSource` 只支持 GET、不能带请求体**。
     但提问必须传 `{ question }`，且语义上是 POST（有副作用：会落库两条消息）。
  2. **返回类型对不上。** `@Sse()` 要求 `Observable<MessageEvent>`，我们是
     `AsyncGenerator<ChatEvent>`，要包一层转换；而且 `MessageEvent` 的 `type` 是给 SSE 的
     `event:` 字段用的，我们用的是「单 `data:` 行 + JSON 里带 type」，用不上。
  3. **代价要认清楚。** `@Res()` 会失去 Nest 的响应处理链（拦截器 + 异常过滤器），
     所以两件事必须自己做：
     - 可能抛错的前置放到 `res.flushHeaders()` **之前** —— 这就是 `prepare` / `stream`
       拆分的由来。挪到之后，404 就会变成「200 + 一截流」
     - 自己保证 `res.end()`（放在 `finally` 里）

  顺带：**前端同样不能用 `EventSource`**，只能用 `fetch` + 手动解析。两个容易踩的点：
  - `TextDecoder` 要传 `{ stream: true }`，否则中文字被网络分片切开时会乱码
  - 必须自己维护 buffer 按 `\n\n` 切帧 —— 一个 chunk 可能包含多帧，也可能只有半帧

  另外 5 个响应头各有用途，其中两个是「本机看不出问题、上线才炸」的类型：
  `X-Accel-Buffering: no`（否则 nginx 会缓冲整个流，流式直接失效）；
  `charset=utf-8`（否则中文流式输出乱码）。

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
- SSE 客户端中途断开时，上游的 chatStream 不会立刻停，会继续烧 token → 需要在 `res.on('close')` 里主动取消
- 前端消费 SSE：`fetch` + 手动解析（不能用 EventSource），注意 `TextDecoder` 的 `{ stream: true }` 和 buffer 切帧
- 接入 Swagger（`@nestjs/swagger` + CLI plugin 自动推断 `@ApiProperty`），顺带反向验证 DTO 装饰器有没有写全
- 智谱文档解析（非 txt / md 目前直接抛「暂不支持」）
- health check 接口（容器探针要用）
- 登录 / 注册限流（`@nestjs/throttler`），防爆破
- CI：GitHub Actions 跑 lint + tsc + 单测 + e2e
- 统一 Message.role 与 User.role 的类型约束（schema 里现在都是裸 String）
