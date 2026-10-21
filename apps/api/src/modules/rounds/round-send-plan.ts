import type { FieldValues, RoundSent, SavedEmployerSignature } from '@doc-signing/shared';
import type { TextFitCache, TextFont } from '../pdf-filler/pdf-text.js';
import {
  type RecipientEmployee,
  resolveRecipient,
  type ResolvedRecipient,
} from './recipient-outcome.js';
import { buildLists } from './recipients-report.js';
import type { CandidateTemplate } from './round-templates.js';

/** The assignment statuses a send looks at again (3.9 created them; anything else is left). */
export const SENDABLE_STATUSES = ['pending', 'no_email', 'missing_data'] as const;
export type SendableStatus = (typeof SENDABLE_STATUSES)[number];

/** One assignment of the draft, with its employee as stored now and the round's template. */
export interface SendableAssignment {
  id: string;
  status: SendableStatus;
  /** The employee now; `department` is the assignment's own (at creation, never changes). */
  employee: RecipientEmployee;
  /** The round's own version (`assignments.template_id`), never a newer one. */
  template: CandidateTemplate;
}

export type SendStatus = SendableStatus | 'cancelled';

/** What the send writes for one assignment. */
export interface SendDecision {
  assignmentId: string;
  status: SendStatus;
  /** Saved for `pending` and `no_email` (so print works, FR-RND-8); NULL otherwise. */
  fieldValues: FieldValues | null;
  /** `pending` only: the address the invitation goes to (as stored at the send). */
  toEmail: string | null;
}

export interface RoundSendPlan {
  decisions: SendDecision[];
  counts: RoundSent['counts'];
  textWarnings: RoundSent['textWarnings'];
}

export interface PlanRoundSendInput {
  assignments: readonly SendableAssignment[];
  /** The send day in Israel (`todayInIsrael(sentAt)`); the age is on this day. */
  sendDay: string;
  /** The current employer signature image (3.18), saved into the values; null when none. */
  employerSignature: SavedEmployerSignature | null;
  font: TextFont;
  textFitCache?: TextFitCache;
}

/**
 * The send's decision for each assignment of a draft (3.10, FR-RND-8), with the same rule as the
 * preview and creation (3.8 `resolveRecipient`), run again on today's data:
 * - inactive now → `cancelled` (FR-RND-4: inactive employees never get a document);
 * - a required value empty now → `missing_data`, nothing saved or sent;
 * - no usable email now → `no_email`, values saved (print);
 * - otherwise → `pending` with values saved, and an invitation is queued.
 * Whatever the status was at creation: details filled in since, or an email added since (the
 * draft was never sent; the send click is the manager's action), count as they are now.
 * Pure: no database, no clock.
 */
export function planRoundSend(input: PlanRoundSendInput): RoundSendPlan {
  const decisions: SendDecision[] = [];
  const recipients: ResolvedRecipient[] = [];
  const counts = { queued: 0, noEmail: 0, missingData: 0, cancelledInactive: 0 };
  for (const assignment of input.assignments) {
    const recipient = resolveRecipient({
      employee: assignment.employee,
      pickedByHand: false,
      departmentStatus: 'ready',
      template: assignment.template,
      signedBefore: null,
      openElsewhere: null,
      alreadySigned: 'send_again',
      sendDay: input.sendDay,
      employerSignature: input.employerSignature,
      font: input.font,
      ...(input.textFitCache && { textFitCache: input.textFitCache }),
    });
    recipients.push(recipient);
    const decision = decide(assignment, recipient);
    decisions.push(decision);
    if (decision.status === 'pending') counts.queued += 1;
    else if (decision.status === 'no_email') counts.noEmail += 1;
    else if (decision.status === 'missing_data') counts.missingData += 1;
    else counts.cancelledInactive += 1;
  }
  return { decisions, counts, textWarnings: buildLists(recipients).textWarnings };
}

function decide(assignment: SendableAssignment, recipient: ResolvedRecipient): SendDecision {
  const base = { assignmentId: assignment.id, fieldValues: null, toEmail: null };
  switch (recipient.outcome) {
    case 'inactive':
      return { ...base, status: 'cancelled' };
    case 'missing_data':
      return { ...base, status: 'missing_data' };
    case 'no_email':
      return { ...base, status: 'no_email', fieldValues: recipient.fieldValues };
    case 'email':
      return {
        ...base,
        status: 'pending',
        fieldValues: recipient.fieldValues,
        toEmail: (assignment.employee.values.email ?? '').trim(),
      };
    default:
      // The template is given and nothing earlier is passed in, so no other outcome can come.
      throw new Error(`Unexpected send outcome ${recipient.outcome}`);
  }
}
