import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'node:path';
import { ALLOWED_EXT } from './types/document-allowed-type-ext.type.js';

@Injectable()
export class ZhipuDocumentParserService {
  constructor(private readonly config: ConfigService) {}

  async parser(file: Express.Multer.File) {
    const type = extname(file.filename).slice(1);
    if (!ALLOWED_EXT.includes(type)) {
      throw new BadRequestException(`不支持${type}格式的文件`);
    }
    const _res = await fetch(
      `${this.config.get<string>('LLM_BASE_URL')}files/parser/create`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.get<string>('LLM_API_KEY')}`,
        },
        body: JSON.stringify({
          file,
          tool_type: 'lite',
          file_type: type,
        }),
      },
    );
  }
}
