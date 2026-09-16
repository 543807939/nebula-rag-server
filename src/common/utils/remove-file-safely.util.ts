import type { Logger } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';

export async function removeFileSafely(
  filePath: string,
  baseDir: string,
  logger?: Logger,
): Promise<void> {
  const fileName = basename(filePath);
  if (!fileName) {
    return;
  }
  const target = resolve(join(baseDir, fileName));
  if (!target.startsWith(baseDir + sep)) {
    logger?.warn(`文件路径不合法: ${target}`);
    return;
  }
  try {
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger?.warn(`删除文件失败: ${target}`, error as Error);
    }
  }
}
