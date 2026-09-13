import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import { requestIdMiddleware } from './common/middlewares/request-id.middleware.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
  app.setGlobalPrefix('api');
  app.use(requestIdMiddleware);
  app.enableShutdownHooks(); // 关闭服务时，等待所有请求完成
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
