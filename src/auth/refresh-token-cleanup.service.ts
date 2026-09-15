import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Cron, CronExpression } from '@nestjs/schedule';
@Injectable()
export class RefreshTokenCleanupService {
  private readonly logger = new Logger(RefreshTokenCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredTokens() {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (count > 0) {
      this.logger.log(`已清理${count}条过期的refresh token`);
    }
  }
}
