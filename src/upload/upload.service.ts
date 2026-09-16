import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { UserService } from '../user/user.service.js';
import {
  AVATAR_UPLOAD_DIR,
  AVATAR_URL_PREFIX,
  DEFAULT_AVATAR,
} from './upload.constant.js';
import { removeFileSafely } from '../common/utils/remove-file-safely.util.js';

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
    await removeFileSafely(avatar, AVATAR_UPLOAD_DIR, this.logger);
  }
}
