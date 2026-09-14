import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/setup-e2e.ts'],
    // 在加载测试文件之前写入 process.env。
    // @nestjs/config 的 assignVariablesToProcess 不会覆盖已存在的 process.env，
    // 所以这里能稳定压掉 .env 里的 DATABASE_URL。
    env: {
      // 相对 prisma/ 目录解析，最终落在 prisma/test.db
      DATABASE_URL: 'file:./test.db',
    },
    // e2e 共用同一个 sqlite 文件，必须串行，避免用例互相踩数据
    fileParallelism: false,
  },
});
