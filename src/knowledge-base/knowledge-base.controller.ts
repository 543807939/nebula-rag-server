import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../auth/types/jwt-payload.js';
import { QueryKnowledgeBaseDto } from './dto/query-knowledge-base.dto.js';
import { CreateKnowledgeBaseDto } from './dto/create-knowledge-base.dto.js';
import { UpdateKnowledgeBaseDto } from './dto/update-knowledge-base.dto.js';
import { KnowledgeBaseService } from './knowledge-base.service.js';
import { KnowledgeBaseOwnerGuard } from './guards/knowledge-base-owner.guard.js';
import { OwnerParam } from '../common/decorators/owner-param.decorator.js';

@Controller('knowledge-bases')
export class KnowledgeBaseController {
  constructor(private readonly knowledgeBaseService: KnowledgeBaseService) {}

  @Get()
  getKnowledgeBaseList(
    @CurrentUser() user: JwtPayload,
    @Query() query: QueryKnowledgeBaseDto,
  ) {
    return this.knowledgeBaseService.getKnowledgeBaseList(user.sub, query);
  }

  @Post()
  createKnowledgeBase(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateKnowledgeBaseDto,
  ) {
    return this.knowledgeBaseService.createKnowledgeBase(user.sub, body);
  }

  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('id')
  @Get(':id')
  getKnowledgeBaseByIdOrFail(@Param('id', ParseIntPipe) id: number) {
    return this.knowledgeBaseService.getKnowledgeBaseByIdOrFail(id);
  }

  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('id')
  @Patch(':id')
  updateKnowledgeBase(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateKnowledgeBaseDto,
  ) {
    return this.knowledgeBaseService.updateKnowledgeBase(id, body);
  }

  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('id')
  @Delete(':id')
  deleteKnowledgeBase(@Param('id', ParseIntPipe) id: number) {
    return this.knowledgeBaseService.deleteKnowledgeBase(id);
  }
}
