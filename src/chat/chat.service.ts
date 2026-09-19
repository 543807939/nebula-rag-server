import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ConversationService } from '../conversation/conversation.service.js';
import {
  CHAT_ROLE_TYPE,
  ChatRoleType,
} from '../llm/constants/chat-role.constants.js';
import { LlmService } from '../llm/llm.service.js';
import { ChatMessage } from '../llm/types/llm.type.js';
import { REWRITE_QUERY_SYSTEM_PROMPT } from './constants/rewrite-query.prompt.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { RetrievedChunk } from '../retrieval/types/retrieval.type.js';
import { ANSWER_SYSTEM_PROMPT } from './constants/answer.prompt.js';
import { NO_RESULT_REPLY } from './constants/no-result-reply.js';
import { NO_RESULT_SYSTEM_PROMPT } from './constants/no-result-system.prompt.js';
import { ChatContext, ChatEvent, SourceSnapshot } from './types/chat.type.js';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
    private readonly llmService: LlmService,
    private readonly retrievalService: RetrievalService,
  ) {}

  async prepare(kbId: number, conversationId: number, question: string) {
    await this.conversationService.getConversationOrFail(kbId, conversationId);
    // 数据库拿到最近的消息
    const latestMessage =
      await this.conversationService.getConversationMessages(
        kbId,
        conversationId,
        { limit: 10 },
      );
    // 落库用户消息
    await this.saveUserMessage(conversationId, question);
    // 拼接最近的消息 调用大模型意图识别
    const messages = latestMessage.list.map((message) => ({
      role: message.role as ChatRoleType,
      content: message.content,
    }));
    const query = await this.rewriteQuery(messages, question);
    // 根据query拿到最符合的三个片段
    const chunks = await this.retrievalService.retrieve(query, kbId);

    return { conversationId, question, query, chunks };
  }

  async *stream(ctx: ChatContext): AsyncGenerator<ChatEvent> {
    try {
      if (ctx.chunks.length === 0) {
        // 检索为空 兜底回复
        const reply = await this.replyWhenNothingFound(ctx.question);
        yield { type: 'delta', text: reply };
        const saved = await this.saveAssistantMessage(
          ctx.conversationId,
          reply,
          [],
        );
        yield { type: 'done', messageId: saved.id };
        return;
      }
      // 先把参考资料返回
      yield {
        type: 'sources',
        sources: ctx.chunks.map((chunk) => this.toSnapshot(chunk)),
      };

      let answer = '';
      let messageId: number | undefined;
      try {
        for await (const delta of this.llmService.chatStream(
          this.buildMessage(ctx),
          { temperature: 0.3 },
        )) {
          answer += delta;
          yield { type: 'delta', text: delta };
        }
      } finally {
        // 正常结束 / 模型报错 / 客户端断开 —— 三种都在这里落库。
        // 不做的话「问了一句但历史里没有回答」，下一轮拼接历史就断了
        const saved = await this.saveAssistantMessage(
          ctx.conversationId,
          answer,
          ctx.chunks,
        );
        messageId = saved.id;
      }
      if (messageId !== undefined) {
        yield { type: 'done', messageId };
      }
    } catch (error) {
      // 响应已经把 header 发出去了，异常过滤器管不到这里 —— 只能自己变成一帧 error
      this.logger.error('流式回答失败', error);
      yield { type: 'error', message: '回答生成失败，请稍后重试' };
    }
  }

  private toSnapshot(retrievedChunk: RetrievedChunk): SourceSnapshot {
    return {
      chunkId: retrievedChunk.id,
      documentId: retrievedChunk.documentId,
      fileName: retrievedChunk.fileName,
      chunkIndex: retrievedChunk.chunkIndex,
      content: retrievedChunk.content,
      score: retrievedChunk.score,
    };
  }

  private buildMessage(ctx: ChatContext): ChatMessage[] {
    return [
      {
        role: CHAT_ROLE_TYPE.SYSTEM,
        content: `${ANSWER_SYSTEM_PROMPT}\n\n资料：\n${this.buildContext(ctx.chunks)}`,
      },
      { role: CHAT_ROLE_TYPE.USER, content: ctx.query },
    ];
  }

  private async saveUserMessage(conversationId: number, content: string) {
    return await this.prisma.message.create({
      data: {
        content,
        role: CHAT_ROLE_TYPE.USER,
        conversationId: conversationId,
      },
    });
  }

  private async saveAssistantMessage(
    conversationId: number,
    content: string,
    chunks: RetrievedChunk[],
  ) {
    return await this.prisma.message.create({
      data: {
        content,
        role: CHAT_ROLE_TYPE.ASSISTANT,
        conversationId: conversationId,
        // source为空说明没有召回到任何资料
        sources: chunks.map((chunk) => this.toSnapshot(chunk)),
      },
    });
  }

  private async replyWhenNothingFound(question: string): Promise<string> {
    try {
      const reply = await this.llmService.chat(
        [
          { role: CHAT_ROLE_TYPE.SYSTEM, content: NO_RESULT_SYSTEM_PROMPT },
          { role: CHAT_ROLE_TYPE.USER, content: question },
        ],
        // 这条路径上模型没有资料可依据，是幻觉风险最高的地方，温度要更低
        { temperature: 0.2 },
      );

      const cleaned = reply.trim();
      return cleaned || NO_RESULT_REPLY; // 模型返回空 → 退回固定文案
    } catch (error) {
      this.logger.warn('兜底回复生成失败，退回固定文案', error);
      return NO_RESULT_REPLY;
    }
  }

  // 意图识别 重写query
  private async rewriteQuery(history: ChatMessage[], question: string) {
    if (!history.length) {
      return question;
    }

    try {
      const raw = await this.llmService.chat(
        [
          {
            role: CHAT_ROLE_TYPE.SYSTEM,
            content: REWRITE_QUERY_SYSTEM_PROMPT,
          },
          ...history,
          { role: CHAT_ROLE_TYPE.USER, content: question },
        ],
        { temperature: 0 }, // 改写query不需要创造性
      );
      const cleaned = raw
        .trim()
        .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '') // 模型爱加引号
        .replace(/^(改写后|查询|query)\s*[:：]\s*/i, '') // 可能带前缀
        .trim();
      // 清洗后为空（或长到离谱，说明它跑题去写解释了）→ 宁可用原句
      if (!cleaned || cleaned.length > question.length * 3 + 50) {
        return question;
      }
      return cleaned;
    } catch (error) {
      this.logger.warn('查询改写失败,回退到原始输入', error);
      return question;
    }
  }

  // 拼接context
  private buildContext(chunks: RetrievedChunk[]): string {
    return chunks
      .map((chunk, index) => `${index + 1}. ${chunk.fileName} ${chunk.content}`)
      .join('\n\n');
  }
}
