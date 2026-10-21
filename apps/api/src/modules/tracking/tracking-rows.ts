import {
  type AssignmentRow,
  type CancelReason,
  type DisplayStatusCounts,
  EMAIL_CHOICE_LABELS,
  emptyDisplayCounts,
  type EmployeeHistoryItem,
  formatDepartment,
  percentSigned,
  ROUND_STATUS_LABELS,
  SIGNED_DISPLAY_STATUSES,
  STATUS_LABELS,
  todayInIsrael,
} from '@doc-signing/shared';
import type {
  AssignmentTableRow,
  CountRow,
  HistoryRow,
  RoundDocumentRow,
  RoundRow,
} from './tracking.repository.js';

/** Pure mapping from the tracking queries to the API answers (3.11). */

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

/** Every display value with its count (0 when none) from the GROUP BY rows of one key. */
export function countsOf(rows: readonly Pick<CountRow, 'status' | 'count'>[]): DisplayStatusCounts {
  const counts = emptyDisplayCounts();
  for (const { status, count } of rows) counts[status] += count;
  return counts;
}

/** `{ total, percentSigned, byStatus }`, the shape of every count block. */
export function countBlock(counts: DisplayStatusCounts) {
  return {
    total: Object.values(counts).reduce((sum, count) => sum + count, 0),
    percentSigned: percentSigned(counts),
    byStatus: counts,
  };
}

/** Signed rows of a count (incl. paper and waiting for approval). */
export function signedOf(counts: DisplayStatusCounts): number {
  return SIGNED_DISPLAY_STATUSES.reduce((sum, status) => sum + counts[status], 0);
}

/** A round's templates, each once (by_department lists one per department). */
export function distinctDocuments(rows: readonly RoundDocumentRow[]) {
  const seen = new Set<string>();
  return rows.flatMap(({ id, name, version }) => {
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id, name, version }];
  });
}

/** Whole calendar days in Israel from `from` to `now` (0 on the same day). */
export function israelDaysBetween(from: Date, now: Date): number {
  const day = (date: Date) => Date.parse(`${todayInIsrael(date)}T00:00:00Z`);
  return Math.max(0, Math.round((day(now) - day(from)) / 86_400_000));
}

/** The fields of a round both the list and the details show. */
export function roundBase(round: RoundRow, now: Date) {
  return {
    id: round.id,
    name: round.name,
    mode: round.mode,
    status: round.status,
    statusLabel: ROUND_STATUS_LABELS[round.status],
    isCorrection: round.isCorrection,
    createdAt: round.createdAt.toISOString(),
    draftAgeDays: round.status === 'draft' ? israelDaysBetween(round.createdAt, now) : null,
    sentAt: iso(round.sentAt),
    linkExpiresAt: iso(round.linkExpiresAt),
    closedAt: iso(round.closedAt),
  };
}

function approvalOf(row: Pick<HistoryRow, 'status' | 'needsApproval' | 'approvedAt'>) {
  if (row.status !== 'signed' || !row.needsApproval) return null;
  return row.approvedAt === null ? ('waiting' as const) : ('approved' as const);
}

function returnedOf(
  row: Pick<HistoryRow, 'returnedAt' | 'correctionRoundId' | 'correctionRoundName'>,
) {
  if (row.returnedAt === null) return null;
  return {
    at: row.returnedAt.toISOString(),
    correctionRound:
      row.correctionRoundId === null
        ? null
        : { id: row.correctionRoundId, name: row.correctionRoundName ?? '' },
  };
}

/**
 * Why a row is cancelled: a return for correction; inactive at the send (3.10 cancels those with
 * `cancelled_at` = the round's `sent_at`); else a manager's cancel.
 */
function cancelReasonOf(row: AssignmentTableRow): CancelReason | null {
  if (row.status !== 'cancelled') return null;
  if (row.returnedAt !== null) return 'returned';
  const atSend =
    row.cancelledAt !== null &&
    row.roundSentAt !== null &&
    row.cancelledAt.getTime() === row.roundSentAt.getTime();
  return atSend ? 'inactive_at_send' : 'cancelled';
}

function departmentOf(row: Pick<HistoryRow, 'departmentId' | 'departmentCode' | 'departmentName'>) {
  return {
    id: row.departmentId,
    code: row.departmentCode,
    label: formatDepartment(row.departmentCode, row.departmentName),
  };
}

/** One row of the employee table. The email answer only on signed rows (FR-TRK-2). */
export function toAssignmentRow(row: AssignmentTableRow): AssignmentRow {
  const emailAnswer =
    row.status === 'signed' && row.emailChoice !== null
      ? {
          choice: row.emailChoice,
          choiceLabel: EMAIL_CHOICE_LABELS[row.emailChoice],
          email: row.emailChoice === 'email' ? row.emailGiven : null,
          differsFromStored: row.emailChoice === 'email' && row.emailDiffers,
        }
      : null;
  return {
    assignmentId: row.assignmentId,
    employeeId: row.employeeId,
    employeeNumber: row.employeeNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    department: departmentOf(row),
    status: row.status,
    displayStatus: row.displayStatus,
    statusLabel: STATUS_LABELS[row.displayStatus],
    locked: row.locked,
    sentAt: iso(row.sentAt),
    firstOpenedAt: iso(row.firstOpenedAt),
    signedAt: iso(row.signedAt),
    lastUpdateAt: row.lastUpdateAt.toISOString(),
    reminderCount: row.reminderCount,
    lastReminderAt: iso(row.lastReminderAt),
    signMethod: row.signMethod,
    hasSignedFile: row.hasSignedFile,
    hasAnswers: row.hasAnswers,
    approval: approvalOf(row),
    emailAnswer,
    cancelReason: cancelReasonOf(row),
    returned: returnedOf(row),
  };
}

/** One round of the employee's history. */
export function toHistoryItem(row: HistoryRow): EmployeeHistoryItem {
  return {
    assignmentId: row.assignmentId,
    round: {
      id: row.roundId,
      name: row.roundName,
      status: row.roundStatus,
      statusLabel: ROUND_STATUS_LABELS[row.roundStatus],
      correctionOf:
        row.roundCorrectionOfId === null
          ? null
          : { id: row.roundCorrectionOfId, name: row.roundCorrectionOfName ?? '' },
    },
    document:
      row.templateId === null
        ? null
        : { id: row.templateId, name: row.templateName ?? '', version: row.templateVersion ?? 1 },
    department: departmentOf(row),
    status: row.status,
    displayStatus: row.displayStatus,
    statusLabel: STATUS_LABELS[row.displayStatus],
    createdAt: row.createdAt.toISOString(),
    sentAt: iso(row.sentAt),
    firstOpenedAt: iso(row.firstOpenedAt),
    signedAt: iso(row.signedAt),
    cancelledAt: iso(row.cancelledAt),
    lastUpdateAt: row.lastUpdateAt.toISOString(),
    signMethod: row.signMethod,
    hasSignedFile: row.hasSignedFile,
    approval: approvalOf(row),
    returned: returnedOf(row),
  };
}
