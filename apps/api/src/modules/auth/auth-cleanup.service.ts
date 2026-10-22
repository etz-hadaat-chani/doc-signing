import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { ATTEMPT_RETENTION_MS, IDLE_TIMEOUT_MS } from './auth.constants.js';

export interface CleanupCounts {
  sessions: number;
  loginAttempts: number;
  /** Employee signing sessions past their 15 minutes (3.13). */
  signingSessions: number;
  /** Per-IP signing counters older than 1 day (kept that long to tune the limits). */
  signingRateHits: number;
}

/**
 * Deletes what the auth tables no longer need (run daily by the worker). Sessions past their
 * absolute or idle limit, the same rule SessionService.authenticate refuses them by, and login
 * attempts older than 1 day (the limit counts only the last 15 minutes); employee signing
 * sessions past their time and per-IP signing counters older than 1 day (3.13). Safe to run twice.
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
    const signingSessions = await this.prisma.signingSession.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    const signingRateHits = await this.prisma.signingRateHit.deleteMany({
      where: { windowStart: { lt: new Date(now.getTime() - ATTEMPT_RETENTION_MS) } },
    });
    return {
      sessions: sessions.count,
      loginAttempts: loginAttempts.count,
      signingSessions: signingSessions.count,
      signingRateHits: signingRateHits.count,
    };
  }
}
