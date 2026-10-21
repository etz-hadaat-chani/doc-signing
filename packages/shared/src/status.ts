import type { AssignmentStatus, RoundStatus } from './enums.js';

/** What a screen shows: the stored status, or one of the flags (PRD §5). */
export type DisplayStatus =
  | AssignmentStatus
  | 'locked'
  | 'expired'
  | 'waiting_for_approval'
  | 'returned_for_correction'
  | 'send_failed';

/**
 * Every display value, in the order screens list them (PRD §5): the counts of a round, its
 * status filter and the dashboard use this list.
 */
export const DISPLAY_STATUSES = [
  'pending',
  'send_failed',
  'sent',
  'opened',
  'signed',
  'waiting_for_approval',
  'signed_manual',
  'delivered',
  'missing_data',
  'no_email',
  'invalid_email',
  'cancelled',
  'returned_for_correction',
  'locked',
  'expired',
] as const satisfies readonly DisplayStatus[];

/** Signed, digitally or on paper; "waiting for approval" is signed too (the status stays signed). */
export const SIGNED_DISPLAY_STATUSES = [
  'signed',
  'waiting_for_approval',
  'signed_manual',
] as const satisfies readonly DisplayStatus[];

/** Left out of a round's "% signed": cancelled, also by a return for correction. */
export const UNCOUNTED_DISPLAY_STATUSES = [
  'cancelled',
  'returned_for_correction',
] as const satisfies readonly DisplayStatus[];

/**
 * The only statuses the locked and expired flags apply to. Every other status shows as it is:
 * signed and cancelled are final, and missing_data / no_email / invalid_email need manual handling.
 */
export const FLAGGABLE_STATUSES: readonly AssignmentStatus[] = ['pending', 'sent', 'opened'];

export interface DisplayStatusInput {
  status: AssignmentStatus;
  /** assignments.locked_at. A string is an ISO date from JSON. */
  lockedAt: Date | string | null;
  /** The round's link_expires_at (NULL until the round is sent). */
  linkExpiresAt: Date | string | null;
  /** assignments.needs_approval: an answer is in a box that needs approval (FR-TRK-6). */
  needsApproval: boolean;
  /** assignments.approved_at. */
  approvedAt: Date | string | null;
  /** assignments.returned_at: returned for correction (the status is `cancelled`). */
  returnedAt: Date | string | null;
  /** The assignment's newest invite or reminder row is `failed` (3.10: "send failed"). */
  lastInviteFailed: boolean;
}

/**
 * Combines the stored status with the flags. Signed + needs approval + not approved → waiting
 * for approval; cancelled by a return → returned for correction. Expired wins over locked,
 * because unlocking an expired link doesn't help, and both win over "send failed". A link
 * expiring exactly at `now` is expired. "Send failed" = `pending` whose newest invitation failed.
 *
 * The SQL twin is `displayStatusSql` (apps/api tracking module); a test compares the two on
 * every combination, so change both together.
 */
export function displayStatus(assignment: DisplayStatusInput, now: Date): DisplayStatus {
  const { status, lockedAt, linkExpiresAt } = assignment;
  if (status === 'signed' && assignment.needsApproval && assignment.approvedAt === null) {
    return 'waiting_for_approval';
  }
  if (status === 'cancelled' && assignment.returnedAt !== null) return 'returned_for_correction';
  if (!FLAGGABLE_STATUSES.includes(status)) return status;
  if (linkExpiresAt !== null && now.getTime() >= new Date(linkExpiresAt).getTime()) {
    return 'expired';
  }
  if (lockedAt !== null) return 'locked';
  if (status === 'pending' && assignment.lastInviteFailed) return 'send_failed';
  return status;
}

/** Hebrew labels, exactly as PRD §5. */
export const STATUS_LABELS: Readonly<Record<DisplayStatus, string>> = {
  pending: 'ממתין לשליחה',
  sent: 'נשלח',
  opened: 'נפתח',
  signed: 'נחתם',
  signed_manual: 'נחתם ידנית',
  delivered: 'נמסר',
  missing_data: 'חסרים פרטים',
  no_email: 'אין מייל',
  invalid_email: 'מייל שגוי',
  cancelled: 'בוטל',
  locked: 'נעול',
  expired: 'פג תוקף',
  waiting_for_approval: 'נחתם, ממתין לאישור',
  returned_for_correction: 'הוחזר לתיקון',
  send_failed: 'שליחה נכשלה',
};

/** Hebrew names of the round statuses (A3): a draft reads "טיוטה". */
export const ROUND_STATUS_LABELS: Readonly<Record<RoundStatus, string>> = {
  draft: 'טיוטה',
  sending: 'בשליחה',
  active: 'פעיל',
  closed: 'סגור',
  cancelled: 'בוטל',
};

/** A count per display value, every value present (0 when none). */
export type DisplayStatusCounts = Record<DisplayStatus, number>;

/** All display values at 0. */
export function emptyDisplayCounts(): DisplayStatusCounts {
  return Object.fromEntries(DISPLAY_STATUSES.map((status) => [status, 0])) as DisplayStatusCounts;
}

/**
 * "% signed" of a round (list, details, dashboard): signed (incl. waiting for approval and paper)
 * of everyone not cancelled, rounded down, so 100 means everyone. Null when nobody counts.
 */
export function percentSigned(counts: DisplayStatusCounts): number | null {
  const signed = SIGNED_DISPLAY_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const uncounted = UNCOUNTED_DISPLAY_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const total = DISPLAY_STATUSES.reduce((sum, status) => sum + counts[status], 0) - uncounted;
  return total === 0 ? null : Math.floor((signed * 100) / total);
}
