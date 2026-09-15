import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码必须大于等于1' })
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '每页条数必须是整数' })
  @Max(100, { message: '每页条数必须小于等于100' })
  @Min(1, { message: '每页条数必须大于等于1' })
  size: number = 10;
}
