import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ChatDto } from './dto/chat.dto.js';
import { ChatService } from './chat.service.js';
import { KnowledgeBaseOwnerGuard } from '../knowledge-base/guards/knowledge-base-owner.guard.js';
import { OwnerParam } from '../common/decorators/owner-param.decorator.js';
import type { Response } from 'express';

@Controller('knowledge-bases/:kbId/conversations')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @HttpCode(HttpStatus.OK)
  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Post(':conversationId/messages')
  async createMessage(
    @Param('kbId', ParseIntPipe) kbId: number,
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @Body() dto: ChatDto,
    @Res() res: Response,
  ) {
    const ctx = await this.chatService.prepare(
      kbId,
      conversationId,
      dto.question,
    );

    res.setHeader('Content-Type', 'text/event-stream;charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    try {
      for await (const event of this.chatService.stream(ctx)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } finally {
      res.end();
    }
  }
}
