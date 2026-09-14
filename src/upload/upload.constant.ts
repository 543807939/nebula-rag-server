import { join } from 'path';

// 文件上传根目录
export const UPLOAD_ROOT = 'uploads';
// 头像子目录
export const AVATAR_DIR = 'avatars';
//  头像在磁盘上的绝对目录
export const AVATAR_UPLOAD_DIR = join(process.cwd(), UPLOAD_ROOT, AVATAR_DIR);
// 头像对外访问/入库的 URL前缀
export const AVATAR_URL_PREFIX = `/${UPLOAD_ROOT}/${AVATAR_DIR}`;
// 默认头像
export const DEFAULT_AVATAR = `${AVATAR_URL_PREFIX}/default.jpeg`;
// 入库 avatar 的合法格式，由前缀推导，保证单一数据源
export const AVATAR_PATH_PATTERN = new RegExp(
  `^${AVATAR_URL_PREFIX}/[\\w-]+\\.(jpg|jpeg|png|webp)$`,
);
