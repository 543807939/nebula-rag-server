import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { DocumentService } from './document.service.js';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { QueryDocumentDto } from './dto/query-document.dto.js';
import { KnowledgeBaseOwnerGuard } from '../knowledge-base/guards/knowledge-base-owner.guard.js';
import { OwnerParam } from '../common/decorators/owner-param.decorator.js';
import { DOCUMENT_UPLOAD_DIR } from './document.constant.js';
import { ALLOWED_EXT } from './types/document-allowed-type-ext.type.js';

@Controller('knowledge-bases/:kbId/documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: DOCUMENT_UPLOAD_DIR,
        filename: (req, file, cb) => {
          cb(null, randomUUID() + extname(file.originalname).toLowerCase());
        },
      }),
      limits: {
        fileSize: 50 * 1024 * 1024,
      },
      fileFilter: (req, file, cb) => {
        const extension = extname(file.originalname).toLowerCase();
        const ok = ALLOWED_EXT.includes(extension);

        cb(
          ok
            ? null
            : new BadRequestException(
                `仅支持${ALLOWED_EXT.join(',')}格式的文件`,
              ),
          ok,
        );
      },
    }),
  )
  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Post()
  public createDocument(
    @Param('kbId', ParseIntPipe) kbId: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('请上传文件');
    }
    return this.documentService.createDocument(kbId, file);
  }

  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Get()
  public getDocumentList(
    @Param('kbId', ParseIntPipe) kbId: number,
    @Query() query: QueryDocumentDto,
  ) {
    return this.documentService.getDocumentList(kbId, query);
  }

  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Get(':docId')
  public getDocumentById(
    @Param('kbId', ParseIntPipe) kbId: number,
    @Param('docId', ParseIntPipe) docId: number,
  ) {
    return this.documentService.getDocumentById(kbId, docId);
  }

  @UseGuards(KnowledgeBaseOwnerGuard)
  @OwnerParam('kbId')
  @Delete(':docId')
  public deleteDocument(
    @Param('kbId', ParseIntPipe) kbId: number,
    @Param('docId', ParseIntPipe) docId: number,
  ) {
    return this.documentService.deleteDocument(kbId, docId);
  }
}
