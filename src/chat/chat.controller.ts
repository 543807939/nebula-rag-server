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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('chat')
@ApiBearerAuth()
@Controller('knowledge-bases/:kbId/conversations')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @ApiOperation({
    summary: '发起问答（SSE 流式返回）',
    description:
      '会话不存在或不属于该知识库时返回 404 —— 校验在返回响应头之前完成，' +
      '不会出现「200 之后再断流」。注意 Swagger UI 的 Try it out 会把整个流当一段' +
      '文本渲染，调试建议用 curl 或 Apifox。',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description:
      'SSE 流，每帧形如 `data: {"type":...}\\n\\n`。type 有四种：' +
      'sources（命中的参考片段，仅在有召回时出现，一次性）、' +
      'delta（增量文本，可多次）、done（结束，带落库后的 messageId）、' +
      'error（流内错误，此时不会有 done）。',
    content: { 'text/event-stream': { schema: { type: 'string' } } },
  })
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
