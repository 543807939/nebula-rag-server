import { AVATAR_PATH_PATTERN } from '../../upload/upload.constant.js';
import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto.js';
import { IsOptional, Matches } from 'class-validator';

export class UpdateProfileDto extends PartialType(
  OmitType(CreateUserDto, ['email', 'password'] as const),
) {
  @IsOptional()
  @Matches(AVATAR_PATH_PATTERN, {
    message: '头像路径不合法',
  })
  avatar?: string;
}
