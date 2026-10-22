import { SIGN_SESSION_MINUTES } from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { hashSessionToken, isSessionTokenShape, newSessionToken } from '../auth/auth.constants.js';

export interface NewSigningSession {
  /** The raw token: only into the cookie, never the database or a log. */
  token: string;
  expiresAt: Date;
}

/** The link a session must match: the same assignment AND the same email row. */
export interface SessionLink {
  assignmentId: string;
  emailMessageId: string;
}

/**
 * Employee signing sessions (FR-SGN-8, NFR-SEC-4): 15 minutes fixed from the correct ID number,
 * on the database's clock. Rows hold only the SHA-256 of the cookie token. A session opens only
 * its own link: another token's link, even of the same assignment, needs the ID number again,
 * so the signed copy goes to the address of the link she proved herself on.
 */
@Injectable()
export class SigningSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    link: SessionLink,
    client: { ip: string | null; userAgent: string | null },
    db: Db,
  ): Promise<NewSigningSession> {
    const token = newSessionToken();
    const rows = await db.$queryRaw<{ expiresAt: Date }[]>`
      INSERT INTO signing_sessions
        (token_hash, assignment_id, email_message_id, expires_at, ip, user_agent)
      VALUES (${hashSessionToken(token)}, ${link.assignmentId}::uuid,
              ${link.emailMessageId}::uuid,
              now() + make_interval(mins => ${SIGN_SESSION_MINUTES}), ${client.ip}::inet,
              ${client.userAgent})
      RETURNING expires_at AS "expiresAt"`;
    const [row] = rows;
    if (!row) throw new Error('Signing session not created');
    return { token, expiresAt: row.expiresAt };
  }

  /** Whether the cookie holds a live session for exactly this link. */
  async isValid(token: unknown, link: SessionLink): Promise<boolean> {
    if (!isSessionTokenShape(token)) return false;
    const rows = await this.prisma.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM signing_sessions
      WHERE token_hash = ${hashSessionToken(token)}
        AND assignment_id = ${link.assignmentId}::uuid
        AND email_message_id = ${link.emailMessageId}::uuid
        AND expires_at > now()`;
    return rows.length > 0;
  }
}
