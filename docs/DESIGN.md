# Nebula RAG — 设计文档

## 1. 项目简介

一句话：多用户数据隔离的 AI 知识库问答系统，支持多格式文档上传、基于文档的问答、多轮对话。

## 2. 核心功能

- 用户认证与角色权限（user / admin）
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
title String
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

### 5.2 问答流程

（一张流程图：查询理解 → 召回 → 精排 → 阈值 → 生成 → 流式返回）
用户输入=>带历史记录意图查询=>表述不清=>返回合适的词
用户输入=>带历史记录意图查询=>非表述不清=>返回合适的query=>基于query调向量库返回余弦相似度最高的K个=>过滤掉相似度过低的=>若没有就直接返回 有的话走下一步=>rerank返回3个=>拼接提示词 基于query和rerank三个分数最高的原文=>调用大模型=>返回结果

### 5.3 权限模型

（三层：认证 → 角色 → 资源归属）
认证基于jwt access短token和refresh长token 短token15分钟过期 过期之后带着长token来请求新的token 前端保存token保障用户登录 如果长token被复用说明token泄露了 数据库设置长token过期 避免损失
角色分为user和admin admin可以管理所有知识库 user只能管理自己创建的知识库

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

## 7. 演进方向

- SQLite → PostgreSQL + pgvector
- 向量以JSON字符串存chunk.embedding,检索时全量加载内存算余弦相似度 → embedding改用pgvector + ANN 索引
- 会话历史 → 摘要压缩
- 部署方案
