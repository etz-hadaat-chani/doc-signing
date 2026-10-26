import { ROUND_NAME_MAX_LENGTH } from '@doc-signing/shared';
import type { Refusal } from '../rounds/round-actions.rules.js';
import type { ApprovalTarget, ReturnedTarget } from './approvals.repository.js';

/**
 * Who may be approved, returned or sent again (3.16 part B2, FR-TRK-6): pure rules, no
 * database. The service reads the facts with the round and the row locked and throws the 409.
 */

/** Approve and return: only a signed document waiting for approval (never `signed_manual`). */
export function approvalRefusal(target: ApprovalTarget): Refusal | null {
  if (target.status === 'signed' && target.needsApproval && !target.approved) return null;
  return {
    code: 'ASSIGNMENT_NOT_WAITING_FOR_APPROVAL',
    details: { status: target.status, approved: target.approved, returned: target.returned },
  };
}

/**
 * "Send again": only after a return, once (one correction round per returned assignment), and
 * only for an employee who is still active.
 */
export function sendAgainRefusal(target: ReturnedTarget): Refusal | null {
  if (target.status !== 'cancelled' || !target.returned) {
    return { code: 'ASSIGNMENT_NOT_RETURNED', details: { status: target.status } };
  }
  if (target.correctionRoundId) {
    return { code: 'CORRECTION_ROUND_EXISTS', details: { roundId: target.correctionRoundId } };
  }
  if (!target.employeeActive) return { code: 'EMPLOYEE_INACTIVE' };
  return null;
}

/**
 * The correction round's name (FR-TRK-6): "תיקון: <original round name> – <first last>", cut to
 * the round name's 150 characters (whole characters, never half of one) and trimmed.
 */
export function correctionRoundName(
  roundName: string,
  firstName: string,
  lastName: string,
): string {
  const full = `תיקון: ${roundName} – ${firstName} ${lastName}`;
  return Array.from(full).slice(0, ROUND_NAME_MAX_LENGTH).join('').trim();
}
