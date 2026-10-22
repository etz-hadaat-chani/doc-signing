import { describe, expect, it } from 'vitest';
import {
  CANCELLABLE_STATUSES,
  MAX_UNLOCKS,
  REMIND_COOLDOWN_HOURS,
  REMIND_SKIP_REASONS,
  REMINDABLE_STATUSES,
  roundRemindedSchema,
} from './round-actions.js';

describe('round actions', () => {
  it('reminds only sent and opened; cancels every open status, never signed ones', () => {
    expect(REMINDABLE_STATUSES).toEqual(['sent', 'opened']);
    expect(CANCELLABLE_STATUSES).not.toContain('signed');
    expect(CANCELLABLE_STATUSES).not.toContain('signed_manual');
    expect(CANCELLABLE_STATUSES).not.toContain('cancelled');
    expect(CANCELLABLE_STATUSES).toEqual(
      expect.arrayContaining(['pending', 'missing_data', 'no_email', 'invalid_email']),
    );
  });

  it('keeps the waits and the unlock limit', () => {
    expect(REMIND_COOLDOWN_HOURS).toEqual({ one: 1, round: 24 });
    expect(MAX_UNLOCKS).toBe(2);
  });

  it('the whole-round answer has one count per skip reason', () => {
    const skipped = Object.fromEntries(REMIND_SKIP_REASONS.map((reason) => [reason, 0]));
    const answer = { roundId: '00000000-0000-4000-8000-000000000000', queued: 3, skipped };
    expect(roundRemindedSchema.parse(answer)).toEqual(answer);
    expect(Object.keys(roundRemindedSchema.shape.skipped.shape).sort()).toEqual(
      [...REMIND_SKIP_REASONS].sort(),
    );
  });
});
