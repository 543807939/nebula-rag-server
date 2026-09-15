import { Module } from '@nestjs/common';
import { DocumentService } from './document.service.js';
import { DocumentController } from './document.controller.js';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module.js';

@Module({
  imports: [KnowledgeBaseModule],
  controllers: [DocumentController],
  providers: [DocumentService],
})
export class DocumentModule {}
