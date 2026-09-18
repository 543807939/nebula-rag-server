import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { readFile } from 'node:fs/promises';
import { chunkText } from './text-chunker.js';
import { LlmService } from '../../llm/llm.service.js';
import { DOCUMENT_STATUS } from '../types/document.type.js';
import { resolveDocumentDiskPath } from '../utils/document.util.js';

@Injectable()
export class DocumentPipelineService {
  private readonly logger = new Logger(DocumentPipelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  async run(documentId: number): Promise<void> {
    try {
      // 根据id拿到文档的地址
      const document = await this.prisma.document.findUnique({
        where: {
          id: documentId,
        },
      });
      if (!document) {
        this.logger.warn(`文档不存在，跳过处理 id=${documentId}`);
        return;
      }

      await this.deleteChunksQuery([documentId]);

      await this.prisma.document.update({
        where: { id: documentId },
        data: { status: DOCUMENT_STATUS.PROCESSING },
      });
      const { filePath, fileType } = document;
      if (['txt', 'md'].includes(fileType)) {
        const text = await this.readText(filePath);
        const chunks = chunkText(text);
        if (!chunks.length) {
          await this.prisma.document.update({
            where: { id: documentId },
            data: { status: DOCUMENT_STATUS.COMPLETED },
          });
          return;
        }
        // 向量化
        const BATCH = 16;
        for (let i = 0; i < chunks.length; i += BATCH) {
          const textBatch = chunks.slice(i, i + BATCH);
          const vectors = await this.llmService.embed(textBatch);

          if (vectors.length !== textBatch.length) {
            throw new Error(
              `向量条数与文本条数不一致：${vectors.length} != ${textBatch.length}`,
            );
          }

          await this.prisma.chunk.createMany({
            data: textBatch.map((content, j) => ({
              documentId,
              content,
              embedding: JSON.stringify(vectors[j]),
              chunkIndex: i + j,
            })),
          });

          // 每次入库更新心跳
          await this.prisma.document.update({
            where: { id: documentId },
            data: { status: DOCUMENT_STATUS.PROCESSING },
          });
        }

        // 全部入库之后 更新document的状态
        await this.prisma.document.update({
          where: {
            id: documentId,
          },
          data: {
            status: DOCUMENT_STATUS.COMPLETED,
          },
        });
      } else {
        throw new BadRequestException(
          `暂不支持 ${fileType} 格式，后续接入文件解析`,
        );
      }
    } catch (error) {
      this.logger.error('文档处理失败 id: ' + documentId, error);
      await this.makeFailed(documentId, error);
    }
  }

  private async readText(path: string): Promise<string> {
    const text = await readFile(resolveDocumentDiskPath(path), 'utf8');
    return text;
  }

  private async makeFailed(documentId: number, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.document
      .update({
        where: {
          id: documentId,
        },
        data: {
          status: DOCUMENT_STATUS.FAILED,
          errorMessage: message,
        },
      })
      .catch(() => {});
  }

  deleteChunksQuery(ids: number[]) {
    return this.prisma.chunk.deleteMany({
      where: {
        documentId: {
          in: ids,
        },
      },
    });
  }
}
