import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class QueryConversationDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '查询内容长度不能超过100个字符' })
  keyword?: string;
}
