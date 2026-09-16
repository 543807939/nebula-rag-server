import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { join } from 'node:path';
import { AppModule } from '../../src/app.module.js';
import { UPLOAD_ROOT } from '../../src/common/constants/storage.constant.js';

/**
 * 构建一个与 main.ts 行为一致的测试应用。
 *
 * Test.createTestingModule 只组装依赖图，**不会执行 main.ts**，
 * 所以 main.ts 里的全局配置必须在这里手动补一遍，否则会出现
 * 「所有路由 404」「DTO 校验不生效」或者「静态文件访问不到」这类问题。
 *
 * ⚠️ 以后改 main.ts 的全局配置（管道 / 前缀 / 静态资源 / 拦截器）时，这里要同步改。
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  // 和 main.ts 一致：静态资源挂在 /uploads 下（不受 setGlobalPrefix 影响）
  app.useStaticAssets(join(process.cwd(), UPLOAD_ROOT), {
    prefix: `/${UPLOAD_ROOT}`,
  });

  app.setGlobalPrefix('api');

  await app.init();
  return app;
}
