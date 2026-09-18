import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cosineSimilarity } from './utils/vector.util.js';
import { DOCUMENT_STATUS } from '../document/types/document.type.js';
import { RetrievalOptions, RetrievedChunk } from './types/retrieval.type.js';
import {
  DEFAULT_THRESHOLD,
  RETRIEVAL_TOP_K,
} from './constants/retrieval.constant.js';

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly prisma: PrismaService,
  ) {}

  async retrieve(
    query: string,
    kbId: number,
    options?: RetrievalOptions,
  ): Promise<RetrievedChunk[]> {
    // 先将query向量化
    const embedding = await this.llmService.embed([query]);
    if (!embedding.length) {
      throw new Error(`查询向量化失败：embed 返回空结果`);
    }

    const queryVector = embedding[0];
    // 查询数据库，获取所有向量
    const chunks = await this.prisma.chunk.findMany({
      where: {
        document: {
          knowledgeBaseId: kbId,
          status: DOCUMENT_STATUS.COMPLETED,
        },
      },
      select: {
        id: true,
        chunkIndex: true,
        content: true,
        embedding: true,
        documentId: true,
        document: {
          select: {
            fileName: true,
          },
        },
      },
    });

    const res = chunks
      .map((chunk) => {
        const score = cosineSimilarity(
          queryVector,
          JSON.parse(chunk.embedding) as number[],
        );
        return {
          id: chunk.id,
          documentId: chunk.documentId,
          fileName: chunk.document.fileName,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          score: score,
        };
      })
      .sort((a, b) => b.score - a.score)
      .filter((chunk) => chunk.score > DEFAULT_THRESHOLD)
      .slice(0, options?.topK ?? RETRIEVAL_TOP_K);
    return res;
  }
}
