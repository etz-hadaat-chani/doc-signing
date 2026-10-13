import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';

/** Auth queries that join or count (layering rule); single-table work stays in the services. */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The session with this token hash and its user, or null. */
  findSessionWithUser(tokenHash: string) {
    return this.prisma.session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        expiresAt: true,
        lastUsedAt: true,
        user: { select: { id: true, email: true, fullName: true, role: true, isActive: true } },
      },
    });
  }

  /** Login attempts for this email, or from this IP, made after `since`. */
  countLoginAttemptsSince(by: { email: string } | { ip: string }, since: Date): Promise<number> {
    return this.prisma.loginAttempt.count({ where: { ...by, createdAt: { gt: since } } });
  }
}
