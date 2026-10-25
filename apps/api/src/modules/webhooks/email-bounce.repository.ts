import type { EmailMessageType } from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { Prisma } from '../../generated/prisma/client.js';

/** The open statuses a hard bounce can turn into `invalid_email`: a link was (or is about to be) emailed. */
export const BOUNCEABLE_STATUSES = ['pending', 'sent', 'opened'] as const;

/** Email rows a notice can still change: they went out and nothing bounced yet. */
const DELIVERABLE_EMAIL_STATUSES = ['sent', 'delivered'] as const;

/** One email the provider's notice names. */
export interface NoticedEmail {
  id: string;
  type: EmailMessageType;
  toEmail: string;
  assignmentId: string;
  roundId: string;
  employeeId: string;
}

/**
 * The bounce notices (3.15): finding the email, the locks and every status change (CLAUDE.md
 * layering). Lock order as everywhere else (the send, the round actions, the email job's
 * settling): round rows, then assignment rows, each in id order, then the email row.
 */
@Injectable()
export class EmailBounceRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The emails with this provider id (normally one; `UNCONFIRMED` rows have none). No lock. */
  async findByProviderId(providerMessageId: string, db: Db = this.prisma): Promise<NoticedEmail[]> {
    return db.$queryRaw<NoticedEmail[]>`
      SELECT em.id, em.type::text AS type, em.to_email AS "toEmail",
             em.assignment_id AS "assignmentId", a.round_id AS "roundId",
             a.employee_id AS "employeeId"
      FROM email_messages em
      JOIN assignments a ON a.id = em.assignment_id
      WHERE em.provider_message_id = ${providerMessageId}
      ORDER BY em.id`;
  }

  /**
   * The employee's open assignments whose newest invitation or reminder (any status) went to
   * `address` (case-insensitive): the ones a bounce of that address concerns. One that was
   * emailed again since at another address is not among them. No lock: the caller locks them
   * and `invalidate` checks again.
   */
  async affectedAssignments(
    employeeId: string,
    address: string,
    db: Db,
  ): Promise<{ id: string; roundId: string }[]> {
    return db.$queryRaw<{ id: string; roundId: string }[]>`
      SELECT a.id, a.round_id AS "roundId"
      FROM assignments a
      WHERE a.employee_id = ${employeeId}::uuid
        AND a.status::text = ANY(${[...BOUNCEABLE_STATUSES]}::text[])
        AND ${newestLinkTo(address)}
      ORDER BY a.id`;
  }

  /** Locks the rounds (FOR UPDATE, id order), as a send or a round action would. */
  async lockRounds(roundIds: readonly string[], db: Db): Promise<void> {
    await db.$queryRaw`
      SELECT id FROM rounds WHERE id = ANY(${[...new Set(roundIds)]}::uuid[])
      ORDER BY id FOR UPDATE`;
  }

  /** Locks the assignments (FOR UPDATE, id order). */
  async lockAssignments(ids: readonly string[], db: Db): Promise<void> {
    await db.$queryRaw`
      SELECT id FROM assignments WHERE id = ANY(${[...new Set(ids)]}::uuid[])
      ORDER BY id FOR UPDATE`;
  }

  /**
   * Locks the email row and marks it `bounced` if it went out and nothing bounced it yet; false
   * when it was already bounced (a repeated notice) or is in no state to bounce.
   */
  async markEmailBounced(emailMessageId: string, db: Db): Promise<boolean> {
    const locked = await db.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM email_messages
      WHERE id = ${emailMessageId}::uuid FOR UPDATE`;
    const status = locked[0]?.status;
    if (!DELIVERABLE_EMAIL_STATUSES.some((open) => open === status)) return false;
    await db.emailMessage.update({
      where: { id: emailMessageId },
      data: { status: 'bounced', error: 'BOUNCED' },
    });
    return true;
  }

  /** A soft bounce changes nothing: true while the email can still take a notice. */
  async isDeliverable(emailMessageId: string, db: Db = this.prisma): Promise<boolean> {
    const row = await db.emailMessage.findUnique({
      where: { id: emailMessageId },
      select: { status: true },
    });
    return DELIVERABLE_EMAIL_STATUSES.some((open) => open === row?.status);
  }

  /** Whether this email's soft bounce was already logged (a repeated notice logs nothing). */
  async softBounceLogged(emailMessageId: string, db: Db = this.prisma): Promise<boolean> {
    const row = await db.auditLog.findFirst({
      where: {
        action: 'email.soft_bounced',
        details: { path: ['emailMessageId'], equals: emailMessageId },
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * The employee's email status → `bounced`, only while her stored email is still `address` and
   * `valid` (a fixed address is not marked bad by a late notice). True when it changed.
   */
  async markEmployeeBounced(employeeId: string, address: string, db: Db): Promise<boolean> {
    const changed = await db.$executeRaw`
      UPDATE employees SET email_status = 'bounced', updated_at = now()
      WHERE id = ${employeeId}::uuid AND email_status = 'valid'
        AND lower(btrim(email)) = lower(btrim(${address}))`;
    return changed > 0;
  }

  /**
   * The locked assignments that are still open and whose newest link still went to `address` →
   * `invalid_email`. Signed, paper-signed, cancelled and every other status stay. Returns the
   * ids changed.
   */
  async invalidate(ids: readonly string[], address: string, db: Db): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await db.$queryRaw<{ id: string }[]>`
      UPDATE assignments a SET status = 'invalid_email', updated_at = now()
      WHERE a.id = ANY(${[...ids]}::uuid[])
        AND a.status::text = ANY(${[...BOUNCEABLE_STATUSES]}::text[])
        AND ${newestLinkTo(address)}
      RETURNING a.id`;
    return rows.map(({ id }) => id).sort();
  }
}

/** `a`'s newest invitation or reminder went to `address` (case-insensitive). */
function newestLinkTo(address: string) {
  return Prisma.sql`lower(btrim(${address})) = (
    SELECT lower(btrim(em.to_email)) FROM email_messages em
    WHERE em.assignment_id = a.id AND em.type IN ('invite', 'reminder')
    ORDER BY em.created_at DESC, em.id DESC
    LIMIT 1
  )`;
}
