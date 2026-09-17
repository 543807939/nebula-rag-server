import { Module } from '@nestjs/common';
import { DocumentService } from './document.service.js';
import { DocumentController } from './document.controller.js';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module.js';
import { ZhipuDocumentParserService } from './zhipu-document-parser.service.js';
import { LlmModule } from '../llm/llm.module.js';
import { DocumentPipelineService } from './pipeline/document-pipeline.service.js';

@Module({
  imports: [KnowledgeBaseModule, LlmModule],
  controllers: [DocumentController],
  providers: [
    DocumentService,
    ZhipuDocumentParserService,
    DocumentPipelineService,
  ],
})
export class DocumentModule {}
