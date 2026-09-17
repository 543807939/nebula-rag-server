import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { QueryDocumentDto } from './dto/query-document.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DOCUMENT_UPLOAD_DIR,
  DOCUMENT_URL_PREFIX,
} from './document.constant.js';
import { unlink } from 'node:fs/promises';
import { extname } from 'node:path';
import { Prisma } from '../generated/prisma/client.js';
import { PRISMA_ERROR } from '../common/constants/prisma-error.js';
import { DOCUMENT_STATUS } from './types/document.type.js';
import { removeFileSafely } from '../common/utils/remove-file-safely.util.js';
import { DocumentPipelineService } from './pipeline/document-pipeline.service.js';

@Injectable()
export class DocumentService {
  private readonly logger: Logger = new Logger(DocumentService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly pipeline: DocumentPipelineService,
  ) {}

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === PRISMA_ERROR.RECORD_NOT_FOUND) {
        throw new NotFoundException('文档不存在');
      }
    }
    throw error;
  }

  async createDocument(kbId: number, file: Express.Multer.File) {
    // 先把文件存起来
    const { originalname, filename, path, size: fileSize } = file;
    const fileType = extname(filename).slice(1);
    const filePath = `${DOCUMENT_URL_PREFIX}/${filename}`;
    try {
      const res = await this.prisma.document.create({
        data: {
          fileName: originalname,
          fileType,
          filePath,
          fileSize,
          status: DOCUMENT_STATUS.PENDING,
          knowledgeBaseId: kbId,
        },
      });

      // 落库成功后再触发后台处理：接口立即返回，向量化放到后台跑。
      // run() 的契约是「不抛异常」，但这里仍挂一个 catch 兜底 —— 万一以后
      // 有人改动破坏了那个契约，你得到的是一条日志，而不是进程崩溃。
      void this.pipeline.run(res.id).catch((error: unknown) => {
        this.logger.error(`文档流水线执行失败 id=${res.id}`, error);
      });

      return res;
    } catch (error) {
      this.logger.error('创建文档失败', error);
      await unlink(path).catch(() => {});
      throw new InternalServerErrorException('创建文档失败');
    }
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
    try {
      const document = await this.prisma.document.delete({
        where: {
          id: documentId,
          knowledgeBaseId: kbId,
        },
      });
      await removeFileSafely(
        document.filePath,
        DOCUMENT_UPLOAD_DIR,
        this.logger,
      );
      return document;
    } catch (error) {
      this.handlePrismaError(error);
    }
  }
}
