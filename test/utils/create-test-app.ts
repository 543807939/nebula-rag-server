import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { join } from 'node:path';
import { AppModule } from '../../src/app.module.js';
import { UPLOAD_ROOT } from '../../src/common/constants/storage.constant.js';
import { setupSwagger } from '../../src/common/swagger.js';

/**
 * 构建一个与 main.ts 行为一致的测试应用。
 *
 * Test.createTestingModule 只组装依赖图，**不会执行 main.ts**，
 * 所以 main.ts 里的全局配置必须在这里手动补一遍，否则会出现
 * 「所有路由 404」「DTO 校验不生效」或者「静态文件访问不到」这类问题。
 *
 * ⚠️ 以后改 main.ts 的全局配置（管道 / 前缀 / 静态资源 / 拦截器）时，这里要同步改。
 *
 * @param customize 可选的定制钩子，用来覆盖 provider。
 *        典型用法是把外部依赖（LLM、第三方 API）换成假的：
 *        `createTestApp((b) => b.overrideProvider(LlmService).useValue(fake))`
 */
export async function createTestApp(
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });

  if (customize) {
    builder = customize(builder);
  }

  const moduleRef = await builder.compile();
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

  // Swagger 也是 main.ts 的全局配置之一，同样必须在这里补 ——
  // 否则 swagger.e2e-spec.ts 拿到的是 404，而不是「文档里少了什么」。
  setupSwagger(app);

  await app.init();
  return app;
}
