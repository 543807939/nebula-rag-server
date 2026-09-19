import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ChatDto } from './dto/chat.dto.js';
import { ChatService } from './chat.service.js';
import { KnowledgeBaseOwnerGuard } from '../knowledge-base/guards/knowledge-base-owner.guard.js';
import { OwnerParam } from '../common/decorators/owner-param.decorator.js';

@Controller('knowledge-bases/:kbId/conversations')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @HttpCode(HttpStatus.OK)
  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Post(':conversationId/messages')
  createMessage(
    @Param('kbId', ParseIntPipe) kbId: number,
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @Body() body: ChatDto,
  ) {
    return this.chatService.createMessage(kbId, conversationId, body);
  }
}
