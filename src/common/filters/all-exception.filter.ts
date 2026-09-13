import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
@Catch()
export class AllExceptionFilter implements ExceptionFilter {
  logger = new Logger(AllExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = isHttpException
      ? this.extractMessage(exception)
      : '服务器内部错误';

    if (!isHttpException) {
      this.logger.error(
        `${request.method} ${request.originalUrl} 未捕获异常`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      code: status,
      message,
      data: null,
    });
  }

  private extractMessage(exception: HttpException): string {
    const res = exception.getResponse();
    if (typeof res === 'string') {
      return res;
    }
    const msg = (res as { message?: string | string[] }).message;
    if (Array.isArray(msg)) {
      return msg.join(', ');
    }
    return msg ?? exception.message;
  }
}
