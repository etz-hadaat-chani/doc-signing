import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { ATTEMPT_RETENTION_MS, IDLE_TIMEOUT_MS } from './auth.constants.js';

export interface CleanupCounts {
  sessions: number;
  loginAttempts: number;
}

/**
 * Deletes what the auth tables no longer need (run daily by the worker). Sessions past their
 * absolute or idle limit, the same rule SessionService.authenticate refuses them by, and login
 * attempts older than 1 day (the limit counts only the last 15 minutes). Safe to run twice.
 */
@Injectable()
export class AuthCleanupService {
  constructor(private readonly prisma: PrismaService) {}

  async deleteExpired(now = new Date()): Promise<CleanupCounts> {
    const idleSince = new Date(now.getTime() - IDLE_TIMEOUT_MS);
    const sessions = await this.prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lte: now } }, { lastUsedAt: { lte: idleSince } }] },
    });
    const loginAttempts = await this.prisma.loginAttempt.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - ATTEMPT_RETENTION_MS) } },
    });
    return { sessions: sessions.count, loginAttempts: loginAttempts.count };
  }
}
