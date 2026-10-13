import type { AuthUser } from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import {
  ABSOLUTE_TIMEOUT_MS,
  hashSessionToken,
  IDLE_TIMEOUT_MS,
  isSessionTokenShape,
  newSessionToken,
  TOUCH_INTERVAL_MS,
} from './auth.constants.js';
import { AuthRepository } from './auth.repository.js';

export interface SessionAuth {
  sessionId: string;
  user: AuthUser;
}

/** Staff sessions in Postgres. The raw token lives only in the cookie; rows hold its SHA-256. */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: AuthRepository,
  ) {}

  /** Starts a session; returns the raw token for the cookie. */
  async create(
    userId: string,
    ip: string | null,
    userAgent: string | null,
    db: Db = this.prisma,
    now = new Date(),
  ): Promise<string> {
    const token = newSessionToken();
    await db.session.create({
      data: {
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(now.getTime() + ABSOLUTE_TIMEOUT_MS),
        lastUsedAt: now,
        ip,
        userAgent,
      },
    });
    return token;
  }

  /**
   * The session and its user, or null. A session past its absolute or idle limit, or whose user
   * is disabled, is deleted and refused, so disabling a user ends their session on the next
   * request. Otherwise the idle timer is extended (written at most once a minute).
   */
  async authenticate(token: unknown, now = new Date()): Promise<SessionAuth | null> {
    if (!isSessionTokenShape(token)) return null;
    const session = await this.repository.findSessionWithUser(hashSessionToken(token));
    if (!session) return null;

    const idle = now.getTime() - session.lastUsedAt.getTime();
    if (session.expiresAt <= now || idle >= IDLE_TIMEOUT_MS || !session.user.isActive) {
      await this.revoke(session.id);
      return null;
    }
    if (idle >= TOUCH_INTERVAL_MS) {
      await this.prisma.session.updateMany({
        where: { id: session.id },
        data: { lastUsedAt: now },
      });
    }
    const { id, email, fullName, role } = session.user;
    return { sessionId: session.id, user: { id, email, fullName, role } };
  }

  /** Ends a session. Already gone is fine. */
  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { id: sessionId } });
  }

  /** Ends the session a cookie token points to, if any (e.g. the old one at a new login). */
  async revokeToken(token: unknown, db: Db = this.prisma): Promise<void> {
    if (!isSessionTokenShape(token)) return;
    await db.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
  }
}
