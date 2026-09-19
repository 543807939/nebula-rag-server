import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryConversationDto } from './dto/query-conversation.dto.js';
import { QueryMessageDto } from './dto/query-message.dto.js';

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async getConversationOrFail(kbId: number, conversationId: number) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        knowledgeBaseId: kbId,
        id: conversationId,
      },
    });
    if (!conversation) {
      throw new NotFoundException('会话不存在');
    }
    return conversation;
  }

  async createConversation(kbId: number) {
    return await this.prisma.conversation.create({
      data: {
        knowledgeBaseId: kbId,
      },
    });
  }

  async getConversationList(kbId: number, query: QueryConversationDto) {
    const { page, size } = query;
    const offset = (page - 1) * size;
    const take = size;
    const keyword = query.keyword?.trim();
    const where = keyword
      ? {
          knowledgeBaseId: kbId,
          title: {
            contains: keyword,
          },
        }
      : {
          knowledgeBaseId: kbId,
        };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        skip: offset,
        take,
        orderBy: {
          id: 'desc',
        },
      }),
      this.prisma.conversation.count({
        where,
      }),
    ]);
    return {
      list,
      total,
      page,
      size,
      totalPage: Math.ceil(total / size),
    };
  }

  async getConversationMessages(
    kbId: number,
    conversationId: number,
    query: QueryMessageDto,
  ) {
    await this.getConversationOrFail(kbId, conversationId);
    const { limit, beforeId } = query;
    const where = beforeId
      ? {
          conversationId,
          id: {
            lt: beforeId,
          },
        }
      : {
          conversationId,
        };
    const rows = await this.prisma.message.findMany({
      where,
      take: limit + 1,
      orderBy: {
        id: 'desc',
      },
    });
    const hasMore = rows.length > limit;
    const list = (hasMore ? rows.slice(0, -1) : rows).reverse();
    return { list, hasMore };
  }

  async deleteConversation(kbId: number, conversationId: number) {
    await this.getConversationOrFail(kbId, conversationId);
    return await this.prisma.conversation.delete({
      where: {
        knowledgeBaseId: kbId,
        id: conversationId,
      },
    });
  }
}
