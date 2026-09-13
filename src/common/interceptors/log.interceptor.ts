import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { tap } from 'rxjs';
import { redact } from '../utils/redact.util.js';
import { safeStringify } from '../utils/safe-stringify.util.js';
import type { Request, Response } from 'express';
@Injectable()
export class LogInterceptor implements NestInterceptor {
  private readonly logger: Logger = new Logger(LogInterceptor.name);
  intercept(context: ExecutionContext, next: CallHandler<any>) {
    const startPerformanceTime = performance.now();
    this.logRequest(context);
    return next.handle().pipe(
      tap({
        next: (data) => {
          this.logResponse(context, data, startPerformanceTime);
        },
        error: (err) => {
          this.logError(context, err, startPerformanceTime);
        },
      }),
    );
  }

  private logRequest(context: ExecutionContext) {
    const host = context.switchToHttp();
    const request = host.getRequest<Request>();
    const { method, url, body, query, requestId } = request;
    const safeBody = body ? safeStringify(redact(body)) : '-';
    const safeQuery =
      query && Object.keys(query).length ? safeStringify(redact(query)) : '-';
    this.logger.log(
      `${requestId} -->  ${method} ${url} ${safeBody} ${safeQuery}`,
    );
  }

  private logResponse(context: ExecutionContext, data: any, startTime: number) {
    const host = context.switchToHttp();
    const request = host.getRequest<Request>();
    const { method, url, requestId } = request;

    const response = host.getResponse<Response>();
    const statusCode = response.statusCode;
    const usedTime = (performance.now() - startTime).toFixed(1);
    this.logger.log(
      `${requestId} <-- ${method} ${url}  ${statusCode}  ${usedTime}ms  ${safeStringify(data)}`,
    );
  }

  private logError(context: ExecutionContext, err: any, startTime: number) {
    const host = context.switchToHttp();
    const request = host.getRequest<Request>();
    const { method, url, requestId } = request;

    const usedTime = (performance.now() - startTime).toFixed(1);
    const status = err instanceof HttpException ? err.getStatus() : 500;
    this.logger.error(
      `${requestId} <-- ${method} ${url} ${status}  ${err?.message ?? err}  ${usedTime}ms`,
    );
  }
}
