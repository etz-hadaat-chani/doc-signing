import {
  type AssignmentRow,
  DISPLAY_STATUSES,
  type DisplayStatus,
  formatDate,
  type RoundDetails,
  SIGNED_DISPLAY_STATUSES,
  STATUS_LABELS,
} from '@doc-signing/shared';
import type { FilterOption } from '../../components/table/departments';
import { he } from '../../i18n/he';

type ByStatus = Partial<Record<DisplayStatus, number>>;

/** "Delivered" belongs to delivery-only rounds (later): no row can have it yet. */
const FILTER_STATUSES = DISPLAY_STATUSES.filter((status) => status !== 'delivered');

/** The table's status filter, in the order screens list statuses. */
export const STATUS_FILTER_OPTIONS: readonly FilterOption[] = FILTER_STATUSES.map((status) => ({
  value: status,
  label: STATUS_LABELS[status],
}));

/** The statuses that have rows, in `DISPLAY_STATUSES` order ("returned" apart from "cancelled"). */
export function statusCounts(byStatus: ByStatus): { status: DisplayStatus; count: number }[] {
  return DISPLAY_STATUSES.flatMap((status) => {
    const count = byStatus[status] ?? 0;
    return count > 0 ? [{ status, count }] : [];
  });
}

/** The ZIP holds signed and manually signed documents (also those waiting for approval). */
export function hasSignedFiles(byStatus: ByStatus): boolean {
  return SIGNED_DISPLAY_STATUSES.some((status) => (byStatus[status] ?? 0) > 0);
}

/** The counts the ZIP button looks at: one department's (at send time) or the whole round's. */
export function zipCounts(details: RoundDetails, dept: string | undefined): ByStatus {
  if (dept === undefined) return details.counts.byStatus;
  return details.departments.find((department) => department.id === dept)?.byStatus ?? {};
}

/**
 * "Locked" next to the status when the display status hides it (an expired link wins over the
 * lock, 3.11), so the manager still sees why the employee couldn't get in.
 */
export function showLockedFlag(row: Pick<AssignmentRow, 'locked' | 'displayStatus'>): boolean {
  return row.locked && row.displayStatus !== 'locked';
}

export function remindersText(row: Pick<AssignmentRow, 'reminderCount' | 'lastReminderAt'>) {
  return he.rounds.table.reminders(
    row.reminderCount,
    row.lastReminderAt === null ? null : formatDate(row.lastReminderAt),
  );
}

export const optionalDate = (value: string | null) =>
  value === null ? he.rounds.none : formatDate(value);

/**
 * Sending progress refresh: while a round is `sending` the details are fetched again every
 * POLL_MS, only in a visible tab, at most POLL_MAX times from opening (or the last "רענון").
 * Then it stops, so a forgotten screen goes quiet and its 30-minute idle session can end.
 */
export const SENDING_POLL = { ms: 5_000, max: 60 } as const;

export function sendingRefetchInterval(
  status: RoundDetails['status'] | undefined,
  fetchesSinceStart: number,
): number | false {
  if (status !== 'sending') return false;
  return fetchesSinceStart < SENDING_POLL.max ? SENDING_POLL.ms : false;
}
