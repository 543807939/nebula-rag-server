import { join } from 'node:path';
import { UPLOAD_ROOT } from '../common/constants/storage.constant.js';

// 知识库文件子目录
export const DOCUMENT_DIR = 'documents';
// 知识库文件在磁盘上的绝对目录
export const DOCUMENT_UPLOAD_DIR = join(
  process.cwd(),
  UPLOAD_ROOT,
  DOCUMENT_DIR,
);
// 知识库文件对外访问/入库的 URL前缀
export const DOCUMENT_URL_PREFIX = `/${UPLOAD_ROOT}/${DOCUMENT_DIR}`;
