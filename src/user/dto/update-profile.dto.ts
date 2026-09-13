import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateUserDto } from './create-user.dto.js';

export class UpdateProfileDto extends PartialType(
  OmitType(CreateUserDto, ['email', 'password'] as const),
) {}
