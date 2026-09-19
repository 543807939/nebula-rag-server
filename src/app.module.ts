import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ConfigModule } from '@nestjs/config';
import { LogInterceptor } from './common/interceptors/log.interceptor.js';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TransformerInterceptor } from './common/interceptors/transformer.interceptor.js';
import { AllExceptionFilter } from './common/filters/all-exception.filter.js';
import { UserModule } from './user/user.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ScheduleModule } from '@nestjs/schedule';
import { UploadModule } from './upload/upload.module.js';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module.js';
import { DocumentModule } from './document/document.module.js';
import { LlmModule } from './llm/llm.module.js';
import { RetrievalModule } from './retrieval/retrieval.module.js';
import { ConversationModule } from './conversation/conversation.module.js';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
    PrismaModule,
    UserModule,
    AuthModule,
    UploadModule,
    KnowledgeBaseModule,
    DocumentModule,
    LlmModule,
    RetrievalModule,
    ConversationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LogInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformerInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionFilter,
    },
  ],
})
export class AppModule {}
