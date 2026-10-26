import {
  type AssignmentStatus,
  MANUAL_PRINTABLE_STATUSES,
  MANUAL_SENDABLE_STATUSES,
  SIGNED_ASSIGNMENT_STATUSES,
} from '@doc-signing/shared';
import {
  type ActionRound,
  type ActionTarget,
  isExpired,
  type Refusal,
  resendRefusal,
} from '../rounds/round-actions.rules.js';

/**
 * Who may be sent, printed or signed on paper from manual handling (3.16): pure rules, no
 * database. The services read the facts with the rows locked and throw the 409 these return.
 */

const isIn = <T extends string>(list: readonly T[], value: string): value is T =>
  (list as readonly string[]).includes(value);

/** A row as the send sees it: the 3.12 facts plus whether the employee is still active. */
export interface ManualSendTarget extends ActionTarget {
  employeeActive: boolean;
}

/** Signed, cancelled, or a round that isn't sent or is over. */
function doneRefusal(status: AssignmentStatus, round: ActionRound): Refusal | null {
  if (round.status === 'closed' || round.status === 'cancelled') {
    return { code: 'ROUND_NOT_OPEN', details: { status: round.status } };
  }
  // Draft rows go out with the round's own send (3.10).
  if (round.status === 'draft') return { code: 'ROUND_NOT_SENT' };
  if (isIn(SIGNED_ASSIGNMENT_STATUSES, status)) return { code: 'ASSIGNMENT_ALREADY_SIGNED' };
  if (status === 'cancelled') return { code: 'ASSIGNMENT_ALREADY_CANCELLED' };
  return null;
}

/**
 * The one-click send (FR-MAN-1, FR-EMP-6). `no_email` needs a valid email now; `invalid_email`
 * takes the 3.12 resend rule (a valid email different from the one that failed); `missing_data`
 * passes here and the service then runs the values step again (still missing → 409). A second
 * click finds an invitation queued, or the row already `pending`: refused, never two emails.
 */
export function manualSendRefusal(target: ManualSendTarget, round: ActionRound): Refusal | null {
  const done = doneRefusal(target.status, round);
  if (done) return done;
  if (isExpired(round)) return { code: 'LINK_EXPIRED' };
  if (target.emailQueued) return { code: 'EMAIL_ALREADY_QUEUED' };
  if (!isIn(MANUAL_SENDABLE_STATUSES, target.status)) {
    return { code: 'ASSIGNMENT_NOT_IN_MANUAL_HANDLING', details: { status: target.status } };
  }
  if (!target.employeeActive) return { code: 'EMPLOYEE_INACTIVE' };
  if (target.locked) return { code: 'ASSIGNMENT_LOCKED' };
  if (target.status === 'invalid_email') return resendRefusal(target, round);
  if (target.status === 'no_email' && target.validEmail === null) {
    return { code: 'EMPLOYEE_NO_VALID_EMAIL' };
  }
  return null;
}

/**
 * Print (FR-MAN-2) and the scanned paper signature (FR-MAN-3): an open row whose values were
 * saved at the send, also when locked or the link expired (paper is the way out for those).
 * `missing_data` has nothing saved to print yet.
 */
export function manualDocumentRefusal(
  status: AssignmentStatus,
  round: ActionRound,
): Refusal | null {
  const done = doneRefusal(status, round);
  if (done) return done;
  if (!isIn(MANUAL_PRINTABLE_STATUSES, status)) return { code: 'ASSIGNMENT_NOT_PRINTABLE' };
  return null;
}
