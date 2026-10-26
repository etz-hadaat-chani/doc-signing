import {
  ATTENTION_DISPLAY_STATUSES,
  type DashboardSummary,
  DISPLAY_STATUSES,
  type DisplayStatus,
} from '@doc-signing/shared';

export type DashboardRound = DashboardSummary['rounds'][number];

/** FR-TRK-1: "waiting" is `sent` (sent, not opened yet); `pending` exists only while sending. */
const TILE_STATUSES: readonly DisplayStatus[] = [
  'sent',
  'opened',
  'signed',
  'waiting_for_approval',
  'no_email',
];

/** The totals tiles, in the order screens list statuses. */
export const TOTAL_TILES: readonly DisplayStatus[] = DISPLAY_STATUSES.filter((status) =>
  TILE_STATUSES.includes(status),
);

const attention: readonly DisplayStatus[] = ATTENTION_DISPLAY_STATUSES;

/** What a round needs handled: the attention statuses with rows, in display order. */
export function attentionItems(
  byStatus: Partial<Record<DisplayStatus, number>>,
): { status: DisplayStatus; count: number }[] {
  return DISPLAY_STATUSES.filter((status) => attention.includes(status)).flatMap((status) => {
    const count = byStatus[status] ?? 0;
    return count > 0 ? [{ status, count }] : [];
  });
}

/**
 * Rounds with most to handle first; then a round still sending before an active one; otherwise
 * the API's order.
 */
export function sortRounds(rounds: readonly DashboardRound[]): DashboardRound[] {
  return rounds
    .map((round, index) => ({ round, index }))
    .sort(
      (a, b) =>
        b.round.needsAttention - a.round.needsAttention ||
        Number(b.round.status === 'sending') - Number(a.round.status === 'sending') ||
        a.index - b.index,
    )
    .map(({ round }) => round);
}

/** The round page with its table filtered to one status (no personal data in the address). */
export function roundStatusPath(roundId: string, status: DisplayStatus): string {
  return `/rounds/${roundId}?${new URLSearchParams({ status }).toString()}`;
}
