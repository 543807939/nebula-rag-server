import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto.js';

export class QueryDocumentDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: '关键字长度不能超过100个字符' })
  keyword?: string;
}
