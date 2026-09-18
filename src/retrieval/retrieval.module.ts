import { Module } from '@nestjs/common';
import { RetrievalController } from './retrieval.controller.js';
import { RetrievalService } from './retrieval.service.js';
import { LlmModule } from '../llm/llm.module.js';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module.js';

@Module({
  imports: [LlmModule, KnowledgeBaseModule],
  controllers: [RetrievalController],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
