import { emptyDisplayCounts, STATUS_LABELS } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import {
  attentionItems,
  type DashboardRound,
  roundStatusPath,
  sortRounds,
  TOTAL_TILES,
} from './dashboard-view';

function round(name: string, status: 'sending' | 'active', needsAttention: number): DashboardRound {
  return {
    id: name,
    name,
    status,
    statusLabel: '',
    sentAt: null,
    linkExpiresAt: null,
    total: 0,
    percentSigned: null,
    byStatus: emptyDisplayCounts(),
    needsAttention,
  };
}

describe('dashboard view', () => {
  it('has the five FR-TRK-1 tiles, in display order ("waiting" = sent)', () => {
    expect(TOTAL_TILES).toEqual(['sent', 'opened', 'signed', 'waiting_for_approval', 'no_email']);
    expect(TOTAL_TILES.map((status) => STATUS_LABELS[status])).toContain('נשלח');
  });

  it('lists only attention statuses with rows, in display order', () => {
    const counts = {
      ...emptyDisplayCounts(),
      expired: 2,
      no_email: 3,
      send_failed: 1,
      signed: 40,
      opened: 5,
    };
    expect(attentionItems(counts)).toEqual([
      { status: 'send_failed', count: 1 },
      { status: 'no_email', count: 3 },
      { status: 'expired', count: 2 },
    ]);
    expect(attentionItems(emptyDisplayCounts())).toEqual([]);
  });

  it('puts the rounds with most to handle first, then sending, then the API order', () => {
    const rounds = [
      round('a', 'active', 0),
      round('b', 'active', 2),
      round('c', 'sending', 0),
      round('d', 'active', 9),
      round('e', 'sending', 2),
      round('f', 'active', 0),
    ];
    expect(sortRounds(rounds).map(({ id }) => id)).toEqual(['d', 'e', 'b', 'c', 'a', 'f']);
  });

  it('links to the round page filtered by one status', () => {
    expect(roundStatusPath('r1', 'waiting_for_approval')).toBe(
      '/rounds/r1?status=waiting_for_approval',
    );
  });
});
