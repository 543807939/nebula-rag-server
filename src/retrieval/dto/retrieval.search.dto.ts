import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RetrievalSearchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500, { message: '查询内容长度不能超过500个字符' })
  query: string;
}
