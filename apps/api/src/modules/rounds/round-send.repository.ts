import type { RoundStatus } from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import { type RecipientRow, recipientColumns } from './round-recipients.repository.js';
import { SENDABLE_STATUSES, type SendableStatus, type SendDecision } from './round-send-plan.js';

/** Rows per insert of the invitation rows: 1,500 employees → 2 queries. */
const INVITE_BATCH = 1000;

/** The round row as the send locks it, with the database clock. */
export interface LockedRound {
  id: string;
  status: RoundStatus;
  linkExpiryDays: number;
  /** The database's `now()`: the send time (one clock for `sent_at` and the link expiry). */
  now: Date;
}

/** One assignment of the draft the send looks at again, with its employee now. */
export interface SendableRow {
  id: string;
  status: SendableStatus;
  templateId: string;
  department: { id: string; code: number; name: string };
  employee: RecipientRow;
}

/** One invitation row as its job sees it (locked). */
export interface LockedInvite {
  id: string;
  status: 'queued' | 'sent' | 'delivered' | 'bounced' | 'failed';
  /** A token hash is stored: an earlier attempt handed the email over (or may have). */
  hasToken: boolean;
  toEmail: string;
  assignmentId: string;
  assignmentStatus: string;
  roundId: string;
  linkExpiresAt: Date | null;
  correction: boolean;
  firstName: string;
  lastName: string;
  documentName: string;
}

/** How the round's invitations stand (FR-RND-6): "sent 640 of 1,220" = sent of the three. */
export interface InviteProgress {
  queued: number;
  sent: number;
  failed: number;
}

/**
 * The send (3.10) and its invitation jobs: locks, the bulk status change, the invitation rows and
 * their settling. Every assignment status change of the send lives here (CLAUDE.md layering).
 */
@Injectable()
export class RoundSendRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Locks the round row (FOR UPDATE), so two sends run one after the other; null if unknown. */
  async lockRound(id: string, db: Db): Promise<LockedRound | null> {
    const rows = await db.$queryRaw<LockedRound[]>`
      SELECT id, status::text AS status, link_expiry_days AS "linkExpiryDays", now() AS now
      FROM rounds WHERE id = ${id}::uuid
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * The draft's assignments in `pending` / `no_email` / `missing_data`, locked (in id order), with
   * their department (at creation) and the employee as stored now. Three queries, no nested
   * selects inside the transaction (see `TemplatesRepository.withRelations`).
   */
  async lockSendable(roundId: string, db: Db): Promise<SendableRow[]> {
    const rows = await db.$queryRaw<
      {
        id: string;
        status: SendableStatus;
        templateId: string | null;
        departmentId: string;
        employeeId: string;
      }[]
    >`
      SELECT id, status::text AS status, template_id AS "templateId",
             department_id AS "departmentId", employee_id AS "employeeId"
      FROM assignments
      WHERE round_id = ${roundId}::uuid
        AND status::text = ANY(${[...SENDABLE_STATUSES]}::text[])
      ORDER BY id
      FOR UPDATE`;
    if (rows.length === 0) return [];
    const employees = await db.employee.findMany({
      where: { id: { in: [...new Set(rows.map(({ employeeId }) => employeeId))] } },
      select: recipientColumns,
    });
    const departments = await db.department.findMany({
      where: { id: { in: [...new Set(rows.map(({ departmentId }) => departmentId))] } },
      select: { id: true, code: true, name: true },
    });
    const employeeById = new Map(employees.map((row) => [row.id, row]));
    const departmentById = new Map(departments.map((row) => [row.id, row]));
    return rows.map((row) => {
      const employee = employeeById.get(row.employeeId);
      const department = departmentById.get(row.departmentId);
      if (!employee || !department || row.templateId === null) {
        throw new Error(`Assignment ${row.id} is missing its employee, department or template`);
      }
      return { id: row.id, status: row.status, templateId: row.templateId, department, employee };
    });
  }

  /**
   * Writes every decision in one statement: the status, the saved values (NULL when none) and,
   * for `cancelled`, `cancelled_at` = the send time.
   */
  async applyDecisions(decisions: readonly SendDecision[], sentAt: Date, db: Db): Promise<void> {
    if (decisions.length === 0) return;
    await db.$executeRaw`
      UPDATE assignments AS a SET
        status = v.status::assignment_status,
        field_values = v.field_values::jsonb,
        cancelled_at = CASE WHEN v.status = 'cancelled' THEN ${sentAt} ELSE a.cancelled_at END,
        updated_at = now()
      FROM unnest(
        ${decisions.map(({ assignmentId }) => assignmentId)}::uuid[],
        ${decisions.map(({ status }) => status)}::text[],
        ${decisions.map(({ fieldValues }) => (fieldValues ? JSON.stringify(fieldValues) : null))}::text[]
      ) AS v(id, status, field_values)
      WHERE a.id = v.id`;
  }

  /**
   * One `queued` invitation row per assignment to email, with the address as stored at the send
   * and no token yet (the job adds its hash). Returns their ids by assignment.
   */
  async createInvites(
    rows: readonly { assignmentId: string; toEmail: string }[],
    db: Db,
  ): Promise<{ id: string; assignmentId: string }[]> {
    const created: { id: string; assignmentId: string }[] = [];
    for (let start = 0; start < rows.length; start += INVITE_BATCH) {
      const batch = await db.emailMessage.createManyAndReturn({
        data: rows.slice(start, start + INVITE_BATCH).map(({ assignmentId, toEmail }) => ({
          assignmentId,
          type: 'invite' as const,
          toEmail,
          status: 'queued' as const,
        })),
        select: { id: true, assignmentId: true },
      });
      created.push(...batch);
    }
    return created;
  }

  /** The round leaves `draft`: `sending` (or `active` when nothing is to be emailed). */
  async markRoundSent(
    roundId: string,
    data: { status: 'sending' | 'active'; sentAt: Date; linkExpiresAt: Date },
    db: Db,
  ): Promise<void> {
    await db.round.update({
      where: { id: roundId },
      data: { status: data.status, sentAt: data.sentAt, linkExpiresAt: data.linkExpiresAt },
    });
  }

  // ---- The invitation job ----

  /** The round of an invitation row, or null when there is no such invitation. */
  async roundOfInvite(emailMessageId: string, db: Db = this.prisma): Promise<string | null> {
    const rows = await db.$queryRaw<{ roundId: string }[]>`
      SELECT a.round_id AS "roundId"
      FROM email_messages em JOIN assignments a ON a.id = em.assignment_id
      WHERE em.id = ${emailMessageId}::uuid AND em.type = 'invite'`;
    return rows[0]?.roundId ?? null;
  }

  /**
   * Locks an invitation row and its assignment (FOR UPDATE) and reads what the email needs: the
   * address used, the link expiry, whether it is a correction round, the name and the document
   * name. Null when there is no such invitation.
   */
  async lockInvite(emailMessageId: string, db: Db): Promise<LockedInvite | null> {
    const rows = await db.$queryRaw<LockedInvite[]>`
      SELECT em.id, em.status::text AS status, em.token_hash IS NOT NULL AS "hasToken",
             em.to_email AS "toEmail", a.id AS "assignmentId",
             a.status::text AS "assignmentStatus", a.round_id AS "roundId",
             r.link_expires_at AS "linkExpiresAt",
             r.correction_of_assignment_id IS NOT NULL AS correction,
             e.first_name AS "firstName", e.last_name AS "lastName", t.name AS "documentName"
      FROM email_messages em
      JOIN assignments a ON a.id = em.assignment_id
      JOIN rounds r ON r.id = a.round_id
      JOIN employees e ON e.id = a.employee_id
      JOIN templates t ON t.id = a.template_id
      WHERE em.id = ${emailMessageId}::uuid AND em.type = 'invite'
      FOR UPDATE OF em, a`;
    return rows[0] ?? null;
  }

  /** Stores the hash of the token about to be sent, or clears it (it never left: NULL). */
  async setTokenHash(
    emailMessageId: string,
    tokenHash: string | null,
    error: string | null,
    db: Db,
  ): Promise<void> {
    await db.emailMessage.update({ where: { id: emailMessageId }, data: { tokenHash, error } });
  }

  /** Locks the round row before an invitation is settled (same order as the send: round first). */
  async lockRoundForSettle(roundId: string, db: Db): Promise<void> {
    await db.$queryRaw`SELECT id FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE`;
  }

  /**
   * The invitation went out (or may have: `error` = `UNCONFIRMED:…`, provider id NULL), and its
   * assignment `pending` → `sent`, only if both are still as expected. Returns false when the row
   * was settled already (a second run): nothing changes.
   */
  async settleSent(
    invite: { id: string; assignmentId: string },
    data: { providerMessageId: string | null; error: string | null },
    db: Db,
  ): Promise<boolean> {
    const changed = await db.emailMessage.updateMany({
      where: { id: invite.id, status: 'queued' },
      data: {
        status: 'sent',
        providerMessageId: data.providerMessageId,
        error: data.error,
        sentAt: new Date(),
      },
    });
    if (changed.count === 0) return false;
    await db.assignment.updateMany({
      where: { id: invite.assignmentId, status: 'pending' },
      data: { status: 'sent', sentAt: new Date() },
    });
    return true;
  }

  /**
   * The invitation failed for good: status `failed`, no token (it never left), the error code.
   * `invalidEmail` (a permanent refusal): the assignment `pending` → `invalid_email`; otherwise
   * it stays `pending` ("send failed", resend in 3.12). Returns false when already settled.
   */
  async settleFailed(
    invite: { id: string; assignmentId: string },
    data: { error: string; invalidEmail: boolean },
    db: Db,
  ): Promise<boolean> {
    const changed = await db.emailMessage.updateMany({
      where: { id: invite.id, status: 'queued' },
      data: { status: 'failed', tokenHash: null, error: data.error },
    });
    if (changed.count === 0) return false;
    if (data.invalidEmail) {
      await db.assignment.updateMany({
        where: { id: invite.assignmentId, status: 'pending' },
        data: { status: 'invalid_email' },
      });
    }
    return true;
  }

  /** How the round's invitations stand: one GROUP BY over its invitation rows. */
  async inviteProgress(roundId: string, db: Db = this.prisma): Promise<InviteProgress> {
    const rows = await db.$queryRaw<{ status: string; count: bigint }[]>`
      SELECT em.status::text AS status, count(*) AS count
      FROM email_messages em JOIN assignments a ON a.id = em.assignment_id
      WHERE a.round_id = ${roundId}::uuid AND em.type = 'invite'
      GROUP BY em.status`;
    const count = (status: string) => Number(rows.find((row) => row.status === status)?.count ?? 0);
    // A bounce (3.15) or delivery notice later changes a sent row: still counted as sent.
    return {
      queued: count('queued'),
      sent: count('sent') + count('delivered') + count('bounced'),
      failed: count('failed'),
    };
  }

  /**
   * `sending` → `active` once no invitation of the round is queued. The caller holds the round
   * lock (`lockRoundForSettle`), so two jobs settling the last rows at the same moment can't both
   * miss them. Returns the progress when the round became active, else null.
   */
  async finishIfDone(roundId: string, db: Db): Promise<InviteProgress | null> {
    const progress = await this.inviteProgress(roundId, db);
    if (progress.queued > 0) return null;
    const changed = await db.round.updateMany({
      where: { id: roundId, status: 'sending' },
      data: { status: 'active' },
    });
    return changed.count === 1 ? progress : null;
  }
}
