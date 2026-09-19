import { Module } from '@nestjs/common';
import { ConversationController } from './conversation.controller.js';
import { ConversationService } from './conversation.service.js';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module.js';

@Module({
  imports: [KnowledgeBaseModule],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [],
})
export class ConversationModule {}
