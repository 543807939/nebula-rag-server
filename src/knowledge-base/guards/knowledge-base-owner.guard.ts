import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ROLE_TYPE } from '../../auth/constant/role.constant.js';
import { KnowledgeBaseService } from '../knowledge-base.service.js';
import type { JwtPayload } from '../../auth/types/jwt-payload.js';
import type { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { OWNER_PARAM_KEY } from '../../common/decorators/owner-param.decorator.js';

@Injectable()
export class KnowledgeBaseOwnerGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly knowledgeBaseService: KnowledgeBaseService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: JwtPayload }>();
    const param =
      this.reflector.getAllAndOverride<string>(OWNER_PARAM_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'id';

    const id = Number(request.params[param]);

    if (!Number.isInteger(id)) {
      throw new BadRequestException('知识库id格式非法');
    }
    const user: JwtPayload = request.user;
    if (user.role === ROLE_TYPE.ADMIN) {
      return true;
    }
    const kb = await this.knowledgeBaseService.getKnowledgeBaseById(id);
    if (!kb) {
      throw new NotFoundException('知识库不存在');
    }
    if (kb.userId !== user.sub) {
      throw new ForbiddenException('无权访问');
    }
    return true;
  }
}
