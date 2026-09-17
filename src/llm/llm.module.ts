import { Module } from '@nestjs/common';
import { OpenAiCompatibleService } from './openai-compatible.service.js';
import { LlmService } from './llm.service.js';

@Module({
  imports: [],
  providers: [
    {
      provide: LlmService,
      useClass: OpenAiCompatibleService,
    },
  ],
  controllers: [],
  exports: [LlmService],
})
export class LlmModule {}
