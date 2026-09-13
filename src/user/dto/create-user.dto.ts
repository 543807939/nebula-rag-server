import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
export class CreateUserDto {
  @IsString()
  @Length(1, 20, { message: '用户名长度必须在1-20之间' })
  name: string;

  @Transform(({ value }) => value?.trim().toLowerCase())
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString()
  @MaxLength(20, { message: '密码不能超过 20 位' })
  @MinLength(6, { message: '密码至少 6 位' })
  @Matches(
    /^(?:(?=.*\d)(?=.*[A-Za-z])|(?=.*\d)(?=.*[^A-Za-z0-9\s])|(?=.*[A-Za-z])(?=.*[^A-Za-z0-9\s]))\S*$/,
    { message: '密码需包含数字、字母、特殊字符中的至少两类' },
  )
  password: string;
}
