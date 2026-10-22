import {
  type AssignmentStatus,
  CANCELLABLE_STATUSES,
  type ErrorCode,
  MAX_UNLOCKS,
  REMIND_COOLDOWN_HOURS,
  REMINDABLE_STATUSES,
  type RemindSkipReason,
  type RoundStatus,
  SIGNED_ASSIGNMENT_STATUSES,
} from '@doc-signing/shared';

/**
 * Who may get which round action (3.12): pure rules, no database. The service reads the facts
 * with the rows locked and throws the 409 these return; the whole-round reminder uses the same
 * rule to decide whom it skips.
 */

const HOUR_MS = 60 * 60 * 1000;

/** The round as the action sees it, with the database clock. */
export interface ActionRound {
  status: RoundStatus;
  linkExpiresAt: Date | null;
  now: Date;
}

/** One assignment and what the action needs to know about it. */
export interface ActionTarget {
  status: AssignmentStatus;
  locked: boolean;
  /** The employee's email when its status is `valid`, else null: a new email goes there. */
  validEmail: string | null;
  /** An invitation or reminder of this assignment is still `queued`. */
  emailQueued: boolean;
  /** When the newest invitation or reminder that didn't fail was created; null when none. */
  lastEmailAt: Date | null;
  /** The newest invitation or reminder failed ("send failed" on a `pending` row). */
  lastEmailFailed: boolean;
  /** The address of the newest invitation or reminder that failed or bounced. */
  failedAddress: string | null;
}

/** A refused action: the 409 code and its details. */
export interface Refusal {
  code: ErrorCode;
  details?: Record<string, unknown>;
}

const refuse = (code: ErrorCode, details?: Record<string, unknown>): Refusal =>
  details ? { code, details } : { code };

const isIn = <T extends string>(list: readonly T[], value: string): value is T =>
  (list as readonly string[]).includes(value);

export const isExpired = ({ linkExpiresAt, now }: ActionRound): boolean =>
  linkExpiresAt !== null && linkExpiresAt.getTime() <= now.getTime();

/** A closed or cancelled round takes no action; a draft only takes cancel. */
function roundRefusal(round: ActionRound, { draftAllowed }: { draftAllowed: boolean }) {
  if (round.status === 'closed' || round.status === 'cancelled') {
    return refuse('ROUND_NOT_OPEN', { status: round.status });
  }
  if (round.status === 'draft' && !draftAllowed) return refuse('ROUND_NOT_SENT');
  return null;
}

/** Signed or cancelled: nothing left to do for this employee. */
function closedRefusal(status: AssignmentStatus): Refusal | null {
  if (isIn(SIGNED_ASSIGNMENT_STATUSES, status)) return refuse('ASSIGNMENT_ALREADY_SIGNED');
  if (status === 'cancelled') return refuse('ASSIGNMENT_ALREADY_CANCELLED');
  return null;
}

/** The last email was sent less than `hours` ago: when the next one may go. */
function tooSoon(target: ActionTarget, now: Date, hours: number): Date | null {
  if (target.lastEmailAt === null) return null;
  const allowedAt = new Date(target.lastEmailAt.getTime() + hours * HOUR_MS);
  return allowedAt.getTime() > now.getTime() ? allowedAt : null;
}

/** Remind one employee now (FR-REM-3). */
export function remindRefusal(target: ActionTarget, round: ActionRound): Refusal | null {
  const roundProblem = roundRefusal(round, { draftAllowed: false });
  if (roundProblem) return roundProblem;
  const closed = closedRefusal(target.status);
  if (closed) return closed;
  if (!isIn(REMINDABLE_STATUSES, target.status)) {
    return refuse('ASSIGNMENT_NOT_REMINDABLE', { status: target.status });
  }
  if (isExpired(round)) return refuse('LINK_EXPIRED');
  if (target.locked) return refuse('ASSIGNMENT_LOCKED');
  if (target.validEmail === null) return refuse('EMPLOYEE_NO_VALID_EMAIL');
  if (target.emailQueued) return refuse('EMAIL_ALREADY_QUEUED');
  const allowedAt = tooSoon(target, round.now, REMIND_COOLDOWN_HOURS.one);
  if (allowedAt) return refuse('REMIND_TOO_SOON', { retryAfter: allowedAt.toISOString() });
  return null;
}

/**
 * Why the whole-round reminder skips a `sent` / `opened` row (the first reason that applies), or
 * null when it is reminded. The round itself was checked already.
 */
export function remindSkipReason(
  target: ActionTarget,
  round: ActionRound,
): RemindSkipReason | null {
  if (target.locked) return 'locked';
  if (target.validEmail === null) return 'noValidEmail';
  if (target.emailQueued) return 'emailQueued';
  if (tooSoon(target, round.now, REMIND_COOLDOWN_HOURS.round)) return 'recentlyEmailed';
  return null;
}

/**
 * Resend: a `pending` row whose last invitation failed ("send failed"), or an `invalid_email`
 * row whose employee now has a different, valid email. A new invitation with a new link.
 */
export function resendRefusal(target: ActionTarget, round: ActionRound): Refusal | null {
  const roundProblem = roundRefusal(round, { draftAllowed: false });
  if (roundProblem) return roundProblem;
  const closed = closedRefusal(target.status);
  if (closed) return closed;
  if (target.status !== 'pending' && target.status !== 'invalid_email') {
    return refuse('ASSIGNMENT_NOT_RESENDABLE', { status: target.status });
  }
  if (isExpired(round)) return refuse('LINK_EXPIRED');
  if (target.locked) return refuse('ASSIGNMENT_LOCKED');
  if (target.emailQueued) return refuse('EMAIL_ALREADY_QUEUED');
  if (target.status === 'pending' && !target.lastEmailFailed) {
    return refuse('ASSIGNMENT_NOT_RESENDABLE', { status: target.status });
  }
  if (target.validEmail === null) return refuse('EMPLOYEE_NO_VALID_EMAIL');
  if (
    target.status === 'invalid_email' &&
    target.failedAddress !== null &&
    sameAddress(target.failedAddress, target.validEmail)
  ) {
    return refuse('EMAIL_NOT_CHANGED');
  }
  return null;
}

/** Unlock after 5 wrong ID attempts; at most `MAX_UNLOCKS` times per assignment. */
export function unlockRefusal(
  target: ActionTarget,
  round: ActionRound,
  previousUnlocks: number,
): Refusal | null {
  const roundProblem = roundRefusal(round, { draftAllowed: false });
  if (roundProblem) return roundProblem;
  const closed = closedRefusal(target.status);
  if (closed) return closed;
  if (!target.locked) return refuse('ASSIGNMENT_NOT_LOCKED');
  if (isExpired(round)) return refuse('LINK_EXPIRED');
  if (previousUnlocks >= MAX_UNLOCKS) {
    return refuse('UNLOCK_LIMIT_REACHED', { unlocks: previousUnlocks });
  }
  return null;
}

/** Cancel one employee: any open status, also in a draft, also when expired or locked. */
export function cancelRefusal(target: ActionTarget, round: ActionRound): Refusal | null {
  const roundProblem = roundRefusal(round, { draftAllowed: true });
  if (roundProblem) return roundProblem;
  const closed = closedRefusal(target.status);
  if (closed) return closed;
  if (!isIn(CANCELLABLE_STATUSES, target.status)) {
    // `delivered` (delivery-only rounds, later): the email already reached her.
    return refuse('ASSIGNMENT_ALREADY_SIGNED');
  }
  return null;
}

/** Remind the whole round: a sent round whose links still work. */
export function roundRemindRefusal(round: ActionRound): Refusal | null {
  const roundProblem = roundRefusal(round, { draftAllowed: false });
  if (roundProblem) return roundProblem;
  if (isExpired(round)) return refuse('LINK_EXPIRED');
  return null;
}

/** Cancel the whole round: a draft, a sending or an active round. */
export function roundCancelRefusal(round: ActionRound): Refusal | null {
  return roundRefusal(round, { draftAllowed: true });
}

function sameAddress(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
