import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';
import { IsStrongPassword } from '../../common/decorators/is-strong-password.decorator.js';

export class CreateUserDto {
  @IsString()
  @Length(1, 20, { message: '用户名长度必须在1-20之间' })
  name: string;

  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsStrongPassword()
  password: string;
}
