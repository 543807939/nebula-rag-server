import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { QueryKnowledgeBaseDto } from './dto/query-knowledge-base.dto.js';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto.js';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto.js';
import { Prisma } from '../generated/prisma/client.js';
import { PRISMA_ERROR } from '../common/constants/prisma-error.js';

@Injectable()
export class KnowledgeBaseService {
  constructor(private readonly prisma: PrismaService) {}

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === PRISMA_ERROR.UNIQUE_CONSTRAINT) {
        throw new ConflictException('该知识库名称已存在');
      }
      if (error.code === PRISMA_ERROR.RECORD_NOT_FOUND) {
        throw new NotFoundException('知识库不存在');
      }
    }
    throw error;
  }

  async getKnowledgeBaseList(userId: number, query: QueryKnowledgeBaseDto) {
    const { page, size, keyword } = query;
    const offset = (page - 1) * size;
    const where = keyword
      ? {
          userId,
          title: {
            contains: keyword,
          },
        }
      : {
          userId,
        };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.knowledgeBase.findMany({
        where,
        skip: offset,
        take: size,
        orderBy: {
          id: 'desc',
        },
      }),
      this.prisma.knowledgeBase.count({
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

  async getKnowledgeBaseById(knowledgeBaseId: number) {
    return this.prisma.knowledgeBase.findUnique({
      where: {
        id: knowledgeBaseId,
      },
    });
  }

  async getKnowledgeBaseByIdOrFail(knowledgeBaseId: number) {
    const res = await this.getKnowledgeBaseById(knowledgeBaseId);
    if (!res) {
      throw new NotFoundException('知识库不存在');
    }
    return res;
  }

  async createKnowledgeBase(userId: number, dto: CreateKnowledgeBaseDto) {
    try {
      return await this.prisma.knowledgeBase.create({
        data: {
          title: dto.title,
          description: dto.description,
          userId,
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async updateKnowledgeBase(
    knowledgeBaseId: number,
    dto: UpdateKnowledgeBaseDto,
  ) {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('参数不能为空');
    }

    try {
      return await this.prisma.knowledgeBase.update({
        where: {
          id: knowledgeBaseId,
        },
        data: dto,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async deleteKnowledgeBase(knowledgeBaseId: number) {
    try {
      return await this.prisma.knowledgeBase.delete({
        where: {
          id: knowledgeBaseId,
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }
}
