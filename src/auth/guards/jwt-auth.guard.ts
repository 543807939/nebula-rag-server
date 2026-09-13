import { ConfigService } from '@nestjs/config';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { JwtPayload } from '../types/jwt-payload.js';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import { TOKEN_TYPE } from '../constant/token-type.constant.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly accessSecret: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    this.accessSecret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
  }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('未登录');
    }
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.accessSecret,
      });
    } catch {
      throw new UnauthorizedException('登录已过期,请重新登录');
    }
    if (payload.tokenType !== TOKEN_TYPE.ACCESS_TOKEN) {
      throw new UnauthorizedException('登录凭证无效');
    }
    request.user = {
      sub: payload.sub, // userId
      role: payload.role,
    };
    return true;
  }

  private extractBearerToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    return match?.[1]?.trim();
  }
}
