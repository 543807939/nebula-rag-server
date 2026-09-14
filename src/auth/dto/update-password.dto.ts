import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { IsStrongPassword } from '../../common/decorators/is-strong-password.decorator.js';
import { PASSWORD_MAX_LENGTH } from '../../common/constants/password.constant.js';

export class UpdatePasswordDto {
  @IsNotEmpty({ message: '旧密码不能为空' })
  @IsString({ message: '旧密码必须是字符串' })
  @MaxLength(PASSWORD_MAX_LENGTH)
  oldPassword: string;

  @IsStrongPassword()
  newPassword: string;
}
