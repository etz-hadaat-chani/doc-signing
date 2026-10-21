import {
  ATTENTION_DISPLAY_STATUSES,
  type DashboardSummary,
  emptyDisplayCounts,
  ROUND_STATUS_LABELS,
} from '@doc-signing/shared';
import { Injectable } from '@nestjs/common';
import { countBlock, countsOf, israelDaysBetween } from './tracking-rows.js';
import { TrackingRepository } from './tracking.repository.js';

/**
 * The dashboard (A2, FR-TRK-1): totals across sending and active rounds (drafts sent nothing yet;
 * closed and cancelled rounds are over), each such round with how many rows need attention, and
 * the open drafts. Three queries.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly repository: TrackingRepository) {}

  async summary(now = new Date()): Promise<DashboardSummary> {
    const [rounds, drafts] = await Promise.all([
      this.repository.activeRounds(),
      this.repository.draftSummary(),
    ]);
    const counts = await this.repository.countsByRound(
      rounds.map(({ id }) => id),
      now,
    );
    const totals = emptyDisplayCounts();
    for (const { status, count } of counts) totals[status] += count;
    return {
      activeRounds: rounds.length,
      totals: countBlock(totals),
      rounds: rounds.map((round) => {
        const byStatus = countsOf(counts.filter(({ key }) => key === round.id));
        return {
          id: round.id,
          name: round.name,
          status: round.status,
          statusLabel: ROUND_STATUS_LABELS[round.status],
          sentAt: round.sentAt?.toISOString() ?? null,
          linkExpiresAt: round.linkExpiresAt?.toISOString() ?? null,
          ...countBlock(byStatus),
          needsAttention: ATTENTION_DISPLAY_STATUSES.reduce(
            (sum, status) => sum + byStatus[status],
            0,
          ),
        };
      }),
      drafts: {
        count: drafts.count,
        oldestCreatedAt: drafts.oldestCreatedAt?.toISOString() ?? null,
        oldestAgeDays:
          drafts.oldestCreatedAt === null ? null : israelDaysBetween(drafts.oldestCreatedAt, now),
      },
    };
  }
}
