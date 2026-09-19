import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// src/common/swagger.ts
export function setupSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Nebula RAG API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, config),
    {
      swaggerOptions: {
        // Authorize 里粘的 token 存进 localStorage，刷新页面不用重粘。
        // 注意：只是「记住你粘过的」，不是「默认填」——Swagger UI 是静态页面，
        // 没有登录态，token 只能由调用方提供。
        persistAuthorization: true,
      },
    },
  );
}
