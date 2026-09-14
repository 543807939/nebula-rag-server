import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import bcrypt from 'bcryptjs';
import { PRISMA_ERROR } from '../common/constants/prisma-error.js';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === PRISMA_ERROR.UNIQUE_CONSTRAINT) {
        const target = (error.meta?.target as string[] | undefined)?.[0];
        throw new ConflictException(
          target === 'email' ? '该邮箱已被使用' : '数据已存在',
        );
      }

      if (error.code === PRISMA_ERROR.RECORD_NOT_FOUND) {
        throw new NotFoundException('用户不存在');
      }
    }
    throw error;
  }

  // 创建用户
  async create(dto: CreateUserDto) {
    try {
      const password = await bcrypt.hash(dto.password, 10);
      return await this.prisma.user.create({
        data: { name: dto.name, email: dto.email, password },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  // 通过邮箱查找用户
  async findByEmail(email: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });
    return user;
  }

  // 通过邮箱查找用户 带密码
  async findByEmailWithPassword(email: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
      omit: {
        password: false,
      },
    });
    return user;
  }

  // 通过id查找用户信息 带密码
  async findByIdWithPassword(id: number) {
    const user = await this.prisma.user.findUnique({
      where: {
        id,
      },
      omit: {
        password: false,
      },
    });
    return user;
  }

  // 通过id查找用户
  async findById(id: number) {
    const user = await this.prisma.user.findUnique({
      where: {
        id,
      },
    });
    return user;
  }

  // 更新用户信息
  async updateProfile(id: number, dto: UpdateProfileDto) {
    const user = await this.findById(id);
    if (!user) {
      throw new BadRequestException('用户不存在');
    }
    return this.prisma.user.update({
      where: {
        id,
      },
      data: dto,
    });
  }
}
