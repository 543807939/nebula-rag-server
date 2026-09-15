import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';

/**
 * 构建一个与 main.ts 行为一致的测试应用。
 *
 * Test.createTestingModule 只组装依赖图，**不会执行 main.ts**，
 * 所以 main.ts 里的全局配置必须在这里手动补一遍，否则会出现
 * 「所有路由 404」或者「DTO 校验完全不生效」这类问题。
 *
 * ⚠️ 以后改 main.ts 的全局配置（管道 / 前缀 / 拦截器）时，这里要同步改。
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.setGlobalPrefix('api');

  await app.init();
  return app;
}
