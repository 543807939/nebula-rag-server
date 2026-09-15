import { PartialType } from '@nestjs/mapped-types';
import { CreateKnowledgeBaseDto } from './create-knowledge-base.dto.js';

export class UpdateKnowledgeBaseDto extends PartialType(
  CreateKnowledgeBaseDto,
) {}
