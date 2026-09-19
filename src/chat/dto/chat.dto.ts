import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question: string;
}
