import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DocumentService } from './document.service.js';

@Injectable()
export class DocumentCleanupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DocumentCleanupService.name);
  constructor(private readonly documentService: DocumentService) {}

  async onApplicationBootstrap() {
    await this.documentService.recoverInterruptedDocuments();
  }

  // 每过五分钟执行一次 如果文档超过十分钟还未解析完 状态标记为失败
  @Cron(CronExpression.EVERY_5_MINUTES)
  async recoverStuckDocuments() {
    try {
      await this.documentService.markStaleDocumentsFailed();
      await this.documentService.requeuePendingDocuments();
      return;
    } catch (error) {
      this.logger.error('定时更新文档状态失败', error);
    }
  }
}
