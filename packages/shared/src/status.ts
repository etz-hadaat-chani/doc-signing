import type { AssignmentStatus } from './enums.js';

/** What a screen shows: the stored status, or one of the four flags (PRD §5). */
export type DisplayStatus =
  AssignmentStatus | 'locked' | 'expired' | 'waiting_for_approval' | 'returned_for_correction';

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
}

/**
 * Combines the stored status with the flags. Signed + needs approval + not approved → waiting
 * for approval; cancelled by a return → returned for correction. Expired wins over locked,
 * because unlocking an expired link doesn't help. A link expiring exactly at `now` is expired.
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
};
