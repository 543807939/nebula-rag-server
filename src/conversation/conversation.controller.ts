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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('conversation')
@ApiBearerAuth()
@Controller('knowledge-bases/:kbId/conversations')
export class ConversationController {
  constructor(private readonly conversationService: ConversationService) {}

  // 新建会话
  @ApiOperation({ summary: '创建会话', description: '标题默认为 新对话' })
  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Post()
  createConversation(@Param('kbId', ParseIntPipe) kbId: number) {
    return this.conversationService.createConversation(kbId);
  }

  @ApiOperation({
    summary: '分页查询会话列表',
    description:
      '页码分页（page / size）。keyword 对标题做模糊匹配，不传则不过滤。按创建时间倒序。',
  })
  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Get()
  getConversationList(
    @Param('kbId', ParseIntPipe) kbId: number,
    @Query() query: QueryConversationDto,
  ) {
    return this.conversationService.getConversationList(kbId, query);
  }

  @ApiOperation({
    summary: '查询会话消息',
    description:
      '游标分页：传 beforeId（上一页最早一条的 id）继续向前翻；不传返回最新一页。结果按时间升序，hasMore 表示还有更早的消息。',
  })
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

  @ApiOperation({
    summary: '删除会话',
    description: '连同该会话下的全部消息一起删除，不可恢复。',
  })
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
