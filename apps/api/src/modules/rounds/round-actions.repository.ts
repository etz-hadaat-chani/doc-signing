import {
  type AssignmentStatus,
  CANCELLABLE_STATUSES,
  type RoundStatus,
  SIGNED_ASSIGNMENT_STATUSES,
} from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { Db } from '../../common/prisma/prisma.types.js';
import type { ActionRound, ActionTarget } from './round-actions.rules.js';

/** The round row as an action locks it, with the database clock. */
export interface ActionRoundRow extends ActionRound {
  id: string;
}

/** One assignment as an action sees it (locked), with the facts the rules need. */
export interface ActionRow extends ActionTarget {
  id: string;
  roundId: string;
  lockedAt: Date | null;
  failedAttempts: number;
  /** Reminders that went out (manual and daily), as the 3.11 table shows them. */
  reminderCount: number;
  /**
   * When she was last emailed a link: the newest of the invitation's `sent_at`, the last
   * reminder and the `sent_at` of every invitation or reminder that didn't fail. Null when none.
   */
  lastSentAt: Date | null;
}

/** Which assignments to lock: one, several (manual handling, 3.16), or a round's rows by status. */
export type ActionRowsWhere =
  | { assignmentId: string }
  | { assignmentIds: readonly string[] }
  | { roundId: string; statuses: readonly AssignmentStatus[] };

/**
 * The round actions (3.12): locks, the facts about each assignment and every status change of
 * remind, resend, unlock and cancel (CLAUDE.md layering). Lock order, as in the send and the
 * email job's settling: the round row first, then its assignment rows in id order.
 */
@Injectable()
export class RoundActionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The round an assignment belongs to (no lock), or null when there is no such assignment. */
  async roundOfAssignment(assignmentId: string, db: Db = this.prisma): Promise<string | null> {
    const row = await db.assignment.findUnique({
      where: { id: assignmentId },
      select: { roundId: true },
    });
    return row?.roundId ?? null;
  }

  /** Locks the round row (FOR UPDATE): actions on one round run one after the other. */
  async lockRound(roundId: string, db: Db): Promise<ActionRoundRow | null> {
    const rows = await db.$queryRaw<ActionRoundRow[]>`
      SELECT id, status::text AS status, link_expires_at AS "linkExpiresAt", now() AS now
      FROM rounds WHERE id = ${roundId}::uuid
      FOR UPDATE`;
    return rows[0] ?? null;
  }

  /**
   * Locks the assignments (FOR UPDATE, id order), then reads what the rules need: the
   * employee's valid email, whether an invitation or reminder is queued, when the last one that
   * didn't fail was created, whether the newest one failed, the address that failed last, the
   * reminders counted and when she was last emailed (the daily job, 3.14).
   * Two queries; one lookup per row on `email_messages(assignment_id)`.
   */
  async lockRows(where: ActionRowsWhere, db: Db): Promise<ActionRow[]> {
    const locked =
      'assignmentId' in where
        ? await db.$queryRaw<{ id: string }[]>`
            SELECT id FROM assignments WHERE id = ${where.assignmentId}::uuid FOR UPDATE`
        : 'assignmentIds' in where
          ? await db.$queryRaw<{ id: string }[]>`
              SELECT id FROM assignments WHERE id = ANY(${[...where.assignmentIds]}::uuid[])
              ORDER BY id
              FOR UPDATE`
          : await db.$queryRaw<{ id: string }[]>`
            SELECT id FROM assignments
            WHERE round_id = ${where.roundId}::uuid
              AND status::text = ANY(${[...where.statuses]}::text[])
            ORDER BY id
            FOR UPDATE`;
    if (locked.length === 0) return [];
    return db.$queryRaw<ActionRow[]>`
      SELECT a.id, a.round_id AS "roundId", a.status::text AS status,
             a.locked_at IS NOT NULL AS locked, a.locked_at AS "lockedAt",
             a.failed_attempts AS "failedAttempts", a.reminder_count AS "reminderCount",
             greatest(a.sent_at, a.last_reminder_at, m.last_sent_at) AS "lastSentAt",
             CASE WHEN e.email_status = 'valid' AND btrim(coalesce(e.email, '')) <> ''
                  THEN e.email END AS "validEmail",
             coalesce(m.queued, false) AS "emailQueued", m.last_email_at AS "lastEmailAt",
             coalesce(li.failed, false) AS "lastEmailFailed", fa.to_email AS "failedAddress"
      FROM assignments a
      JOIN employees e ON e.id = a.employee_id
      LEFT JOIN LATERAL (
        SELECT bool_or(em.status = 'queued') AS queued,
               max(em.created_at) FILTER (WHERE em.status <> 'failed') AS last_email_at,
               max(em.sent_at) FILTER (WHERE em.status <> 'failed') AS last_sent_at
        FROM email_messages em
        WHERE em.assignment_id = a.id AND em.type IN ('invite', 'reminder')
      ) m ON true
      LEFT JOIN LATERAL (
        SELECT em.status = 'failed' AS failed
        FROM email_messages em
        WHERE em.assignment_id = a.id AND em.type IN ('invite', 'reminder')
        ORDER BY em.created_at DESC, em.id DESC
        LIMIT 1
      ) li ON true
      LEFT JOIN LATERAL (
        SELECT em.to_email
        FROM email_messages em
        WHERE em.assignment_id = a.id AND em.type IN ('invite', 'reminder')
          AND em.status IN ('failed', 'bounced')
        ORDER BY em.created_at DESC, em.id DESC
        LIMIT 1
      ) fa ON true
      WHERE a.id = ANY(${locked.map(({ id }) => id)}::uuid[])
      ORDER BY a.id`;
  }

  /** How many times this assignment was unlocked before (its `assignment.unlocked` rows). */
  async unlockCount(assignmentId: string, db: Db): Promise<number> {
    return db.auditLog.count({
      where: { entityType: 'assignment', entityId: assignmentId, action: 'assignment.unlocked' },
    });
  }

  /** Lifts the lock: `locked_at` NULL and `failed_attempts` back to 0 (the CHECK allows 0–5). */
  async unlock(assignmentId: string, db: Db): Promise<void> {
    await db.assignment.updateMany({
      where: { id: assignmentId, lockedAt: { not: null } },
      data: { lockedAt: null, failedAttempts: 0 },
    });
  }

  /** Resend after a fixed wrong email: `invalid_email` → `pending`; the new invitation's job sends it. */
  async reopenForResend(assignmentId: string, db: Db): Promise<void> {
    await db.assignment.updateMany({
      where: { id: assignmentId, status: 'invalid_email' },
      data: { status: 'pending' },
    });
  }

  /**
   * Cancels one assignment if it is still open: `cancelled`, `cancelled_at` = now (≠ the round's
   * `sent_at`, so it reads "cancelled", not "inactive at send").
   */
  async cancelOne(assignmentId: string, db: Db): Promise<void> {
    await db.$executeRaw`
      UPDATE assignments
      SET status = 'cancelled', cancelled_at = now(), updated_at = now()
      WHERE id = ${assignmentId}::uuid
        AND status::text = ANY(${[...CANCELLABLE_STATUSES]}::text[])`;
  }

  /**
   * Cancels every open assignment of the round in one statement; returns how many there were of
   * each status before. Signed and already cancelled rows stay.
   */
  async cancelOpenInRound(
    roundId: string,
    db: Db,
  ): Promise<Partial<Record<AssignmentStatus, number>>> {
    const rows = await db.$queryRaw<{ status: AssignmentStatus; count: bigint }[]>`
      WITH old AS (
        SELECT id, status::text AS status FROM assignments
        WHERE round_id = ${roundId}::uuid
          AND status::text = ANY(${[...CANCELLABLE_STATUSES]}::text[])
        ORDER BY id
        FOR UPDATE
      ), changed AS (
        UPDATE assignments a
        SET status = 'cancelled', cancelled_at = now(), updated_at = now()
        FROM old WHERE a.id = old.id
        RETURNING old.status
      )
      SELECT status, count(*) AS count FROM changed GROUP BY status`;
    return Object.fromEntries(rows.map(({ status, count }) => [status, Number(count)]));
  }

  /** Signed documents of the round (digitally or on paper): a cancel leaves them as they are. */
  async countSigned(roundId: string, db: Db): Promise<number> {
    return db.assignment.count({
      where: { roundId, status: { in: [...SIGNED_ASSIGNMENT_STATUSES] } },
    });
  }

  /** The round becomes `cancelled` (from draft, sending or active). */
  async markRoundCancelled(roundId: string, from: RoundStatus, db: Db): Promise<void> {
    await db.round.updateMany({
      where: { id: roundId, status: from },
      data: { status: 'cancelled' },
    });
  }
}
