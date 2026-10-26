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

/** What a new session opens: a link (its email row) or an office kiosk session (3.16). */
export type SessionSource = SessionLink | { assignmentId: string; kioskSessionId: string };

/**
 * Employee signing sessions (FR-SGN-8, NFR-SEC-4): 15 minutes fixed from the correct ID number,
 * on the database's clock. Rows hold only the SHA-256 of the cookie token. A session opens only
 * its own link: another token's link, even of the same assignment, needs the ID number again,
 * so the signed copy goes to the address of the link she proved herself on. A kiosk session's
 * signing session opens only that kiosk session (cookie `kiosk_sid`, never `sign_sid`).
 */
@Injectable()
export class SigningSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    source: SessionSource,
    client: { ip: string | null; userAgent: string | null },
    db: Db,
  ): Promise<NewSigningSession> {
    const token = newSessionToken();
    const emailMessageId = 'emailMessageId' in source ? source.emailMessageId : null;
    const kioskSessionId = 'kioskSessionId' in source ? source.kioskSessionId : null;
    const rows = await db.$queryRaw<{ expiresAt: Date }[]>`
      INSERT INTO signing_sessions
        (token_hash, assignment_id, email_message_id, kiosk_session_id, expires_at, ip,
         user_agent)
      VALUES (${hashSessionToken(token)}, ${source.assignmentId}::uuid,
              ${emailMessageId}::uuid, ${kioskSessionId}::uuid,
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

  /** The kiosk session whose live signing session the cookie holds, or null. */
  async kioskSessionOf(token: unknown): Promise<string | null> {
    if (!isSessionTokenShape(token)) return null;
    const rows = await this.prisma.$queryRaw<{ kioskSessionId: string }[]>`
      SELECT kiosk_session_id AS "kioskSessionId" FROM signing_sessions
      WHERE token_hash = ${hashSessionToken(token)} AND kiosk_session_id IS NOT NULL
        AND expires_at > now()`;
    return rows[0]?.kioskSessionId ?? null;
  }
}
