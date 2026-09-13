import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const status = exception.getStatus();
    const res = exception.getResponse() as
      | string
      | {
          message?: string | string[];
          error?: string;
        };
    let message: string = '';
    if (typeof res === 'string') {
      message = res;
    } else if (Array.isArray(res.message)) {
      message = res.message.join(', ');
    } else {
      message = res.message ?? exception.message;
    }

    response.status(status).json({
      code: status,
      message,
      data: null,
    });
  }
}
