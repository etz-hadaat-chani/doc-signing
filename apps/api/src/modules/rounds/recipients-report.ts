import {
  formatDepartment,
  NO_EMAIL_REASONS,
  RECIPIENT_TEXT_WARNINGS,
  type RecipientsPreviewReport,
  ROUND_PREVIEW_LIST_CAP,
} from '@doc-signing/shared';
import { IN_ROUND_OUTCOMES, type ResolvedRecipient } from './recipient-outcome.js';

type Report = RecipientsPreviewReport;
type Lists = Report['lists'];
type Counts = Report['counts'];

/** Department code, then employee number as a number (digits only, up to 20 of them). */
function byDepartmentThenNumber(a: ResolvedRecipient, b: ResolvedRecipient): number {
  const dept = a.employee.department.code - b.employee.department.code;
  if (dept !== 0) return dept;
  const x = a.employee.employeeNumber;
  const y = b.employee.employeeNumber;
  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
}

/** Who the row is about: no ID number, no email, no other details. */
function refOf({ employee }: ResolvedRecipient) {
  return {
    employeeId: employee.id,
    employeeNumber: employee.employeeNumber,
    name: [employee.firstName, employee.lastName]
      .map((part) => part.trim())
      .join(' ')
      .trim(),
    department: formatDepartment(employee.department.code, employee.department.name),
  };
}

/** The rows `pick` keeps, sorted, cut at the cap; `total` counts them all. */
function capped<T>(
  recipients: readonly ResolvedRecipient[],
  pick: (recipient: ResolvedRecipient) => T | null,
  cap: number,
): { total: number; truncated: boolean; items: T[] } {
  const items: T[] = [];
  for (const recipient of recipients) {
    const item = pick(recipient);
    if (item !== null) items.push(item);
  }
  return { total: items.length, truncated: items.length > cap, items: items.slice(0, cap) };
}

export function countOutcomes(recipients: readonly ResolvedRecipient[]): Counts {
  const count = (test: (recipient: ResolvedRecipient) => boolean) => recipients.filter(test).length;
  const is = (outcome: ResolvedRecipient['outcome']) => (r: ResolvedRecipient) =>
    r.outcome === outcome;
  return {
    recipients: recipients.length,
    inRound: count((r) => IN_ROUND_OUTCOMES.includes(r.outcome)),
    willSendEmail: count(is('email')),
    noEmail: count(is('no_email')),
    missingData: count(is('missing_data')),
    // Everyone who reached the check, whether skipped or sent again.
    alreadySigned: count((r) => r.template !== null && r.signedBefore !== null),
    alreadyOpen: count(is('already_open')),
    noTemplate: count(is('no_template')),
    waitingForChoice: count(is('waiting_for_choice')),
    inactive: count(is('inactive')),
  };
}

/**
 * The lists of the preview (field names and box keys only, never values), each sorted by
 * department code then employee number and cut at `cap` (default ROUND_PREVIEW_LIST_CAP).
 */
export function buildLists(
  resolved: readonly ResolvedRecipient[],
  cap: number = ROUND_PREVIEW_LIST_CAP,
): Lists {
  const recipients = [...resolved].sort(byDepartmentThenNumber);
  const inRound = (r: ResolvedRecipient) => IN_ROUND_OUTCOMES.includes(r.outcome);
  return {
    missingData: capped(
      recipients,
      (r) => (r.outcome === 'missing_data' ? { ...refOf(r), missing: r.missing } : null),
      cap,
    ),
    textWarnings: capped(
      recipients,
      (r) =>
        inRound(r) && r.textWarnings.length > 0
          ? {
              ...refOf(r),
              warnings: r.textWarnings.map(({ code, keys }) => ({
                code,
                message: RECIPIENT_TEXT_WARNINGS[code],
                keys,
              })),
            }
          : null,
      cap,
    ),
    noEmail: capped(
      recipients,
      (r) =>
        r.outcome === 'no_email' && r.noEmailReason
          ? { ...refOf(r), reason: r.noEmailReason, reasonLabel: NO_EMAIL_REASONS[r.noEmailReason] }
          : null,
      cap,
    ),
    alreadySigned: capped(
      recipients,
      (r) =>
        r.template !== null && r.signedBefore
          ? {
              ...refOf(r),
              roundId: r.signedBefore.roundId,
              roundName: r.signedBefore.roundName,
              templateVersion: r.signedBefore.templateVersion,
              signedAt: r.signedBefore.signedAt?.toISOString() ?? null,
              signMethod: r.signedBefore.signMethod,
            }
          : null,
      cap,
    ),
    alreadyOpen: capped(
      recipients,
      (r) =>
        r.outcome === 'already_open' && r.openElsewhere
          ? {
              ...refOf(r),
              roundId: r.openElsewhere.roundId,
              roundName: r.openElsewhere.roundName,
              status: r.openElsewhere.status,
            }
          : null,
      cap,
    ),
    inactivePicked: capped(
      recipients,
      (r) => (r.outcome === 'inactive' && r.pickedByHand ? refOf(r) : null),
      cap,
    ),
  };
}
