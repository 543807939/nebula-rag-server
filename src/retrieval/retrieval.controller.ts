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
import { KnowledgeBaseOwnerGuard } from '../knowledge-base/guards/knowledge-base-owner.guard.js';
import { OwnerParam } from '../common/decorators/owner-param.decorator.js';
import { RetrievalSearchDto } from './dto/retrieval.search.dto.js';
import { RetrievalService } from './retrieval.service.js';

@Controller('knowledge-bases/:kbId/search')
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  @HttpCode(HttpStatus.OK)
  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Post()
  async search(
    @Param('kbId', ParseIntPipe) kbId: number,
    @Body() body: RetrievalSearchDto,
  ) {
    return this.retrievalService.retrieve(body.query, kbId);
  }
}
