import { Module } from '@nestjs/common';
import { UploadService } from './upload.service.js';
import { UploadController } from './upload.controller.js';
import { UserModule } from '../user/user.module.js';

@Module({
  imports: [UserModule],
  providers: [UploadService],
  controllers: [UploadController],
  exports: [],
})
export class UploadModule {}
