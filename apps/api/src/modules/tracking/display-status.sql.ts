import { FLAGGABLE_STATUSES } from '@doc-signing/shared';
import { Prisma } from '../../generated/prisma/client.js';

/**
 * The SQL twin of the shared `displayStatus()` (PRD §5), so every count, filter and label of the
 * tracking routes comes from one rule. Change both together: `display-status-parity.db.spec.ts`
 * compares them on every combination.
 *
 * Needs, in the FROM clause: `a` (assignments), `r` (its round) and `li` (`lastInviteJoin`).
 * `now` is passed in once per request, so SQL and TypeScript judge "expired" at the same moment.
 */
export function displayStatusSql(now: Date): Prisma.Sql {
  return Prisma.sql`(CASE
    WHEN a.status = 'signed' AND a.needs_approval AND a.approved_at IS NULL
      THEN 'waiting_for_approval'
    WHEN a.status = 'cancelled' AND a.returned_at IS NOT NULL THEN 'returned_for_correction'
    WHEN a.status::text <> ALL(${[...FLAGGABLE_STATUSES]}::text[]) THEN a.status::text
    WHEN r.link_expires_at IS NOT NULL AND r.link_expires_at <= ${now} THEN 'expired'
    WHEN a.locked_at IS NOT NULL THEN 'locked'
    WHEN a.status = 'pending' AND li.failed THEN 'send_failed'
    ELSE a.status::text
  END)`;
}

/**
 * The newest invite or reminder of a `pending` row (3.10: its failure is "send failed"), as `li`
 * with `failed` (NULL when there is none: not failed) and `failed_at`. Other rows skip the
 * lookup. Uses the
 * `email_messages(assignment_id)` index: one short lookup per row, no query per row.
 */
export const lastInviteJoin = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT bool_or(x.status = 'failed') AS failed,
           max(CASE WHEN x.status = 'failed' THEN x.updated_at END) AS failed_at
    FROM (
      SELECT em.status, em.updated_at
      FROM email_messages em
      WHERE em.assignment_id = a.id AND a.status = 'pending'
        AND em.type IN ('invite', 'reminder')
      ORDER BY em.created_at DESC, em.id DESC
      LIMIT 1
    ) x
  ) li ON true`;

/** The newest of the row's events (FR-TRK-2 "last update"); never NULL (created_at at least). */
export const lastUpdateSql = Prisma.sql`GREATEST(
  a.sent_at, a.first_opened_at, a.last_reminder_at, a.signed_at, a.locked_at, a.approved_at,
  a.returned_at, a.cancelled_at, li.failed_at, a.created_at)`;
