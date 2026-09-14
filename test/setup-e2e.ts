import { execSync } from 'node:child_process';

// 注意：SQLite 相对路径是相对 schema 所在的 prisma/ 目录解析的，
// 所以这里写 ./test.db，最终落在 prisma/test.db
const TEST_DATABASE_URL = 'file:./test.db';

export default function setup() {
  // 每次跑 e2e 都重建测试库，保证从一个干净的 schema 开始
  execSync('npx prisma db push --force-reset --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
