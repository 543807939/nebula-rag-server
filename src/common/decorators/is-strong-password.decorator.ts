import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MESSAGE,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PATTERN,
} from '../constants/password.constant.js';

export function IsStrongPassword() {
  return applyDecorators(
    IsString(),
    MinLength(PASSWORD_MIN_LENGTH, {
      message: `密码至少 ${PASSWORD_MIN_LENGTH} 位`,
    }),
    MaxLength(PASSWORD_MAX_LENGTH, {
      message: `密码不能超过 ${PASSWORD_MAX_LENGTH} 位`,
    }),
    Matches(PASSWORD_PATTERN, { message: PASSWORD_MESSAGE }),
  );
}
