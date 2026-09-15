import { Module } from '@nestjs/common';
import { KnowledgeBaseService } from './knowledge-base.service.js';
import { KnowledgeBaseController } from './knowledge-base.controller.js';
import { KnowledgeBaseOwnerGuard } from './guards/knowledge-base-owner.guard.js';

@Module({
  imports: [],
  controllers: [KnowledgeBaseController],
  providers: [KnowledgeBaseService, KnowledgeBaseOwnerGuard],
  exports: [],
})
export class KnowledgeBaseModule {}
