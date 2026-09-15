import { Injectable, NotFoundException } from '@nestjs/common';
import { QueryDocumentDto } from './dto/query-document.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class DocumentService {
  constructor(private readonly prisma: PrismaService) {}
  async createDocument(
    userId: number,
    kbId: number,
    file: Express.Multer.File,
  ) {
    // 如果是txt/md文件 就自己解析  如果不是走智谱的解析
  }

  async getDocumentList(kbId: number, query: QueryDocumentDto) {
    const { page, size, keyword } = query;
    const offset = (page - 1) * size;
    const where = keyword?.trim()
      ? {
          fileName: {
            contains: keyword,
          },
          knowledgeBaseId: kbId,
        }
      : {
          knowledgeBaseId: kbId,
        };
    const [list, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        skip: offset,
        take: size,
        orderBy: {
          id: 'desc',
        },
      }),
      this.prisma.document.count({
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

  async getDocumentById(kbId: number, documentId: number) {
    const document = await this.prisma.document.findUnique({
      where: {
        id: documentId,
        knowledgeBaseId: kbId,
      },
    });
    if (!document) {
      throw new NotFoundException('文档不存在');
    }
    return document;
  }

  async deleteDocument(kbId: number, documentId: number) {
    // 先删除数据库 成功之后再删除文件
  }
}
