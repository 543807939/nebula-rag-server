import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { ConversationModule } from '../conversation/conversation.module.js';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';

@Module({
  imports: [
    ConversationModule,
    KnowledgeBaseModule,
    LlmModule,
    RetrievalModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [],
})
export class ChatModule {}
