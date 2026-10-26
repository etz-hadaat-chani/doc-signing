import {
  type AssignmentStatus,
  type ErrorCode,
  MANUAL_PRINTABLE_STATUSES,
  type RoundStatus,
  SIGNED_ASSIGNMENT_STATUSES,
  type SignLinkState,
} from '@doc-signing/shared';
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception.js';

/**
 * Statuses a link can still be signed from (3.13). `invalid_email`: a later email bounced, but
 * the link she has did arrive. `no_email` / `missing_data` never got a link of their own; an old
 * one still seen there reads "cancelled".
 */
export const SIGNABLE_STATUSES = [
  'pending',
  'sent',
  'opened',
  'invalid_email',
] as const satisfies readonly AssignmentStatus[];

/** What the state of a link is worked out from: the assignment, its round and the clock. */
export interface LinkFacts {
  status: AssignmentStatus;
  locked: boolean;
  roundStatus: RoundStatus;
  linkExpiresAt: Date | null;
  /** The database's clock, read with the facts. */
  now: Date;
}

const isOneOf = <T extends string>(list: readonly T[], value: string): value is T =>
  (list as readonly string[]).includes(value);

/**
 * The state of a signing link (FR-SGN-7, NFR-SEC-5), in this order: signed (also on paper) →
 * cancelled (the assignment or the round, or a status that can't be signed) → expired (the expiry
 * passed, or the round was closed) → locked (5 wrong ID numbers) → valid. Every route checks it,
 * and submit again under the row lock, so a cancel or a lock stops an open session too.
 */
export function linkState(facts: LinkFacts): SignLinkState {
  if (isOneOf(SIGNED_ASSIGNMENT_STATUSES, facts.status)) return 'signed';
  if (facts.roundStatus === 'cancelled' || facts.roundStatus === 'draft') return 'cancelled';
  if (!isOneOf(SIGNABLE_STATUSES, facts.status)) return 'cancelled';
  if (facts.roundStatus === 'closed') return 'expired';
  if (!facts.linkExpiresAt || facts.linkExpiresAt <= facts.now) return 'expired';
  if (facts.locked) return 'locked';
  return 'valid';
}

/**
 * Statuses the office signing station can sign from (3.16, FR-MAN-4): the print statuses of part
 * A. `no_email` too: she never had a link, and that is what the kiosk is for.
 */
export const KIOSK_SIGNABLE_STATUSES = MANUAL_PRINTABLE_STATUSES;

/**
 * The state at the office signing station: as `linkState`, but the link's expiry date doesn't
 * count (no emailed link is used, and a manager is there); a closed round still reads "expired".
 */
export function kioskState(facts: LinkFacts): SignLinkState {
  if (isOneOf(SIGNED_ASSIGNMENT_STATUSES, facts.status)) return 'signed';
  if (facts.roundStatus === 'cancelled' || facts.roundStatus === 'draft') return 'cancelled';
  if (!isOneOf(KIOSK_SIGNABLE_STATUSES, facts.status)) return 'cancelled';
  if (facts.roundStatus === 'closed') return 'expired';
  if (facts.locked) return 'locked';
  return 'valid';
}

const REFUSALS: Record<Exclude<SignLinkState, 'valid'>, [ErrorCode, HttpStatus]> = {
  signed: ['SIGN_ALREADY_SIGNED', HttpStatus.CONFLICT],
  cancelled: ['SIGN_CANCELLED', HttpStatus.CONFLICT],
  expired: ['SIGN_LINK_EXPIRED', HttpStatus.CONFLICT],
  locked: ['SIGN_LOCKED', HttpStatus.LOCKED],
};

/** The error a route answers for a link that isn't valid; `details.state` names the B5 screen. */
export function linkStateError(state: Exclude<SignLinkState, 'valid'>): AppException {
  const [code, status] = REFUSALS[state];
  return new AppException(code, status, { state });
}
