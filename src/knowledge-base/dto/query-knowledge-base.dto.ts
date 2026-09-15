import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class QueryKnowledgeBaseDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(30, { message: '关键字长度不能超过30个字符' })
  keyword?: string;
}
