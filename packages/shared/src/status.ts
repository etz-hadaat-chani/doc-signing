import type { AssignmentStatus } from './enums.js';

/** What a screen shows: the stored status, or one of the two flags (PRD §5). */
export type DisplayStatus = AssignmentStatus | 'locked' | 'expired';

/**
 * The only statuses the locked and expired flags apply to. Every other status shows as it is:
 * signed and cancelled are final, and no_email / invalid_email need manual handling.
 */
export const FLAGGABLE_STATUSES: readonly AssignmentStatus[] = ['pending', 'sent', 'opened'];

export interface DisplayStatusInput {
  status: AssignmentStatus;
  /** assignments.locked_at. A string is an ISO date from JSON. */
  lockedAt: Date | string | null;
  /** The round's link_expires_at. */
  linkExpiresAt: Date | string | null;
}

/**
 * Combines the stored status with the locked and expired flags. Expired wins over locked,
 * because unlocking an expired link doesn't help. A link expiring exactly at `now` is expired.
 */
export function displayStatus(assignment: DisplayStatusInput, now: Date): DisplayStatus {
  const { status, lockedAt, linkExpiresAt } = assignment;
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
  no_email: 'אין מייל',
  invalid_email: 'מייל שגוי',
  cancelled: 'בוטל',
  locked: 'נעול',
  expired: 'פג תוקף',
};
