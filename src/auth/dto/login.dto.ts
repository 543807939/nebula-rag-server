import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: '密码不能为空' })
  password: string;
}
