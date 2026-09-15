import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { diskStorage } from 'multer';
import { extname } from 'node:path';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../auth/types/jwt-payload.js';
import { UploadService } from './upload.service.js';
import { AVATAR_UPLOAD_DIR } from './upload.constant.js';

const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: diskStorage({
        destination: AVATAR_UPLOAD_DIR,
        filename: (req, file, cb) =>
          cb(null, randomUUID() + extname(file.originalname).toLowerCase()),
      }),
      limits: { fileSize: 2 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const extension = extname(file.originalname).toLowerCase();
        const ok =
          ALLOWED_EXT.includes(extension) &&
          ALLOWED_MIME.includes(file.mimetype);

        cb(
          ok
            ? null
            : new BadRequestException(
                `仅支持${ALLOWED_EXT.join(',')}格式的图片`,
              ),
          ok,
        );
      },
    }),
  )
  @Post('me/avatar')
  uploadAvatar(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.uploadService.uploadAvatar(user.sub, file);
  }
}
