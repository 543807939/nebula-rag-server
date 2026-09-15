import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateKnowledgeBaseDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(30)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
