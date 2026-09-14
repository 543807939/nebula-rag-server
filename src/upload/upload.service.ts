import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { UserService } from '../user/user.service.js';
import { basename, join, resolve, sep } from 'node:path';
import {
  AVATAR_UPLOAD_DIR,
  AVATAR_URL_PREFIX,
  DEFAULT_AVATAR,
} from './upload.constant.js';
import { unlink } from 'node:fs/promises';

@Injectable()
export class UploadService {
  private readonly logger: Logger = new Logger(UploadService.name);
  constructor(private readonly userService: UserService) {}
  async uploadAvatar(userId: number, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('请上传头像');
    }
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new BadRequestException('用户不存在');
    }
    const updated = await this.userService.updateProfile(userId, {
      avatar: `${AVATAR_URL_PREFIX}/${file.filename}`,
    });

    await this.removeAvatarFile(user.avatar);
    return updated;
  }

  private async removeAvatarFile(avatar?: string | null) {
    if (!avatar || avatar === DEFAULT_AVATAR) {
      return;
    }
    const fileName = basename(avatar);
    if (!fileName) {
      return;
    }
    const target = resolve(join(AVATAR_UPLOAD_DIR, fileName));
    if (!target.startsWith(AVATAR_UPLOAD_DIR + sep)) {
      this.logger.warn(`文件路径不合法: ${target}`);
      return;
    }
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`删除头像文件失败: ${target}`, error as Error);
      }
    }
  }
}
