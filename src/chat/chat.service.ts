import { Injectable, Logger } from '@nestjs/common';
import { ChatDto } from './dto/chat.dto.js';
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

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
    private readonly llmService: LlmService,
    private readonly retrievalService: RetrievalService,
  ) {}

  async createMessage(kbId: number, conversationId: number, dto: ChatDto) {
    await this.conversationService.getConversationOrFail(kbId, conversationId);
    // 数据库拿到最近的消息
    const latestMessage =
      await this.conversationService.getConversationMessages(
        kbId,
        conversationId,
        { limit: 10 },
      );
    // 落库用户消息
    await this.saveUserMessage(conversationId, dto.question);
    // 拼接最近的消息 调用大模型意图识别
    const messages = latestMessage.list.map((message) => ({
      role: message.role as ChatRoleType,
      content: message.content,
    }));
    const query = await this.rewriteQuery(messages, dto.question);
    // 根据query拿到最符合的三个片段
    const chunks = await this.retrievalService.retrieve(query, kbId);
    // 把片段跟提示词再一次给大模型
    if (chunks.length === 0) {
      const reply = await this.replyWhenNothingFound(dto.question);
      return this.saveAssistantMessage(conversationId, reply, []);
    }
    const answer = await this.llmService.chat(
      [
        {
          role: CHAT_ROLE_TYPE.SYSTEM,
          content: `${ANSWER_SYSTEM_PROMPT}\n\n资料：\n${this.buildContext(chunks)}`,
        },
        {
          role: CHAT_ROLE_TYPE.USER,
          content: query, // 用改写后的query查
        },
      ],
      {
        temperature: 0.3,
      },
    );
    return this.saveAssistantMessage(conversationId, answer, chunks);
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
        sources: chunks.map((chunk) => ({
          chunkId: chunk.id,
          documentId: chunk.documentId,
          fileName: chunk.fileName, // 文档可能被改名/删除
          chunkIndex: chunk.chunkIndex,
          content: chunk.content, //  当时的原文
          score: chunk.score, // 便于排查「为什么召回了这条」
        })),
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
