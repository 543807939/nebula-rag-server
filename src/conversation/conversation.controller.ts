import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConversationService } from './conversation.service.js';
import { KnowledgeBaseOwnerGuard } from '../knowledge-base/guards/knowledge-base-owner.guard.js';
import { OwnerParam } from '../common/decorators/owner-param.decorator.js';
import { QueryConversationDto } from './dto/query-conversation.dto.js';
import { QueryMessageDto } from './dto/query-message.dto.js';

@Controller('knowledge-bases/:kbId/conversations')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  // 新建会话
  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Post()
  createConversation(@Param('kbId', ParseIntPipe) kbId: number) {
    return this.conversationService.createConversation(kbId);
  }

  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Get()
  getConversationList(
    @Param('kbId', ParseIntPipe) kbId: number,
    @Query() query: QueryConversationDto,
  ) {
    return this.conversationService.getConversationList(kbId, query);
  }

  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Get(':conversationId/messages')
  getConversationMessages(
    @Param('kbId', ParseIntPipe) kbId: number,
    @Param('conversationId', ParseIntPipe) conversationId: number,
    @Query() query: QueryMessageDto,
  ) {
    return this.conversationService.getConversationMessages(
      kbId,
      conversationId,
      query,
    );
  }

  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Delete(':conversationId')
  deleteConversation(
    @Param('kbId', ParseIntPipe) kbId: number,
    @Param('conversationId', ParseIntPipe) conversationId: number,
  ) {
    return this.conversationService.deleteConversation(kbId, conversationId);
  }
}
