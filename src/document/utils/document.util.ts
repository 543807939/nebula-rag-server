import { basename, join, resolve, sep } from 'node:path';
import { DOCUMENT_UPLOAD_DIR } from '../document.constant.js';
import { BadRequestException } from '@nestjs/common';

export function resolveDocumentDiskPath(filePath: string): string {
  const fileName = basename(filePath);
  const target = resolve(join(DOCUMENT_UPLOAD_DIR, fileName));
  if (!target.startsWith(DOCUMENT_UPLOAD_DIR + sep)) {
    throw new BadRequestException('文件路径不合法');
  }
  return target;
}
