import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { LoginDto } from './dto/login.dto.js';
import { UserService } from '../user/user.service.js';
import bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import {
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_TTL,
} from './constant/jwt.constant.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { randomUUID } from 'node:crypto';
import { TOKEN_TYPE } from './constant/token-type.constant.js';
import type { JwtPayload } from './types/jwt-payload.js';
import { UpdatePasswordDto } from './dto/update-password.dto.js';

const DUMMY_HASH =
  '$2b$10$3aK7MiC6PkbKl4mkJgPuX.rECVB9eVYgQWf3OUqSLALyvG5gef/1uv';

@Injectable()
export class AuthService {
  private readonly logger: Logger = new Logger(AuthService.name);
  private readonly accessSecret: string;
  private readonly refreshSecret: string;

  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.accessSecret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }
  // 登录
  async login(dto: LoginDto) {
    const user = await this.userService.findByEmailWithPassword(dto.email);
    const hash = user?.password ?? DUMMY_HASH;
    const isValid = await bcrypt.compare(dto.password, hash);
    if (!user || !isValid) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 密码正确 处理token
    //  refresh token 存储到数据库
    const { accessToken, refreshToken } = await this.issueTokens(user);

    return {
      accessToken,
      refreshToken,
      user: this.toPublicUser(user),
    };
  }

  // 注册
  async register(dto: RegisterDto) {
    const user = await this.userService.create(dto);
    const { accessToken, refreshToken } = await this.issueTokens(user);
    return {
      accessToken,
      refreshToken,
      user: this.toPublicUser(user),
    };
  }

  // 处理token
  private async issueTokens(user: { id: number; role: string }) {
    const jti = randomUUID();
    const refreshToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        jti,
        tokenType: TOKEN_TYPE.REFRESH_TOKEN,
      },
      {
        secret: this.refreshSecret,
        expiresIn: REFRESH_TOKEN_TTL,
      },
    );
    await this.prisma.refreshToken.create({
      data: {
        jti,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000),
      },
    });
    // access token
    const accessToken = await this.jwtService.signAsync(
      { sub: user.id, role: user.role, tokenType: TOKEN_TYPE.ACCESS_TOKEN },
      {
        secret: this.accessSecret,
        expiresIn: ACCESS_TOKEN_TTL,
      },
    );
    return { accessToken, refreshToken };
  }

  private toPublicUser(user: {
    id: number;
    name: string;
    email: string;
    role: string;
  }) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }

  async refresh(refreshToken: string) {
    // 先直接校验refreshToken
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('登录已过期,请重新登录');
    }
    if (payload.tokenType !== TOKEN_TYPE.REFRESH_TOKEN || !payload.jti) {
      throw new UnauthorizedException('登录凭证无效');
    }
    // 查库 看jti是否存在
    const record = await this.prisma.refreshToken.findUnique({
      where: {
        jti: payload.jti,
      },
    });
    if (!record) {
      throw new UnauthorizedException('登录已失效,请重新登录');
    }

    /**
     * 查看是否已撤销
     *   用旧的refreshToken请求说明token泄露了
     *  所有用户下线
     *  但是会导致前端过期发送多次请求时 有异常信息
     *  这部分在前端解决
     */

    if (record.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(
        `检测到 refresh token 重放! 已撤销userId=${record.userId}的全部会话`,
      );
      throw new UnauthorizedException('检测到异常登录,请重新登录');
    }

    // 取最新的用户
    const user = await this.userService.findById(record.userId);
    if (!user) {
      throw new UnauthorizedException('登陆已失效,请重新登录');
    }

    await this.prisma.refreshToken.update({
      where: { jti: record.jti },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(user);
  }

  async logout(refreshToken: string) {
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(
        refreshToken,
        {
          secret: this.refreshSecret,
          ignoreExpiration: true,
        },
      );
      await this.prisma.refreshToken.updateMany({
        where: {
          jti: payload.jti,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    } catch {}
    return { success: true };
  }

  // 修改密码
  async updatePassword(userId: number, dto: UpdatePasswordDto) {
    // 先看新旧密码对的上不
    const user = await this.userService.findByIdWithPassword(userId);
    if (!user) {
      throw new BadRequestException('用户不存在');
    }
    const isValid = await bcrypt.compare(dto.oldPassword, user.password);
    if (!isValid) {
      throw new BadRequestException('旧密码错误');
    }
    const newPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          password: newPassword,
        },
      }),
      this.revokeAllUserTokensQuery(userId),
    ]);

    return {
      success: true,
    };
  }

  private revokeAllUserTokensQuery(userId: number) {
    return this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async logoutAll(userId: number) {
    await this.revokeAllUserTokensQuery(userId);
    return { success: true };
  }
}
