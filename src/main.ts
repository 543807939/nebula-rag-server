import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import { requestIdMiddleware } from './common/middlewares/request-id.middleware.js';
import { join } from 'path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { UPLOAD_ROOT } from './common/constants/storage.constant.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );
  app.useStaticAssets(join(process.cwd(), UPLOAD_ROOT), {
    prefix: `/${UPLOAD_ROOT}`,
  });
  app.setGlobalPrefix('api');
  app.use(requestIdMiddleware);
  app.enableShutdownHooks(); // 关闭服务时，等待所有请求完成
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
