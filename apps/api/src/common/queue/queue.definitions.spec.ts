import { PgBoss } from 'pg-boss';
import { describe, expect, it } from 'vitest';
import { CLEANUP_QUEUE, DEFAULT_RETRY, QUEUES, SCHEDULE_TIME_ZONE } from './queue.definitions.js';

// A PgBoss instance is never started here; previewSchedule only parses the expression.
const boss = new PgBoss({ connectionString: 'postgres://unused@localhost/unused' });

describe('queue definitions', () => {
  it('have unique names that pg-boss accepts', () => {
    const names = QUEUES.map(({ name }) => name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[\w.\-/]+$/);
  });

  it('retry with backoff by default, capped at 1 hour', () => {
    expect(DEFAULT_RETRY).toEqual({
      retryLimit: 5,
      retryDelay: 30,
      retryBackoff: true,
      retryDelayMax: 3600,
      expireInSeconds: 900,
    });
  });

  it('scheduled queues are exclusive, so two runs never overlap', () => {
    for (const queue of QUEUES.filter(({ schedule }) => schedule)) {
      expect(queue.policy).toBe('exclusive');
    }
  });

  it('cleanup runs daily at 03:00 Israel time, also across daylight saving changes', () => {
    expect(CLEANUP_QUEUE.schedule?.cron).toBe('0 3 * * *');
    // Clocks go forward on 2026-03-27 and back on 2026-10-25, both at 02:00, before the run.
    const runs = (from: string) =>
      boss
        .previewSchedule(CLEANUP_QUEUE.schedule?.cron ?? '', {
          tz: SCHEDULE_TIME_ZONE,
          from: new Date(from),
          count: 3,
        })
        .map((date) => date.toISOString());
    expect(runs('2026-03-25T12:00:00Z')).toEqual([
      '2026-03-26T01:00:00.000Z', // 03:00 at +02:00 (winter)
      '2026-03-27T00:00:00.000Z', // 03:00 at +03:00 (summer, changed at 02:00)
      '2026-03-28T00:00:00.000Z',
    ]);
    expect(runs('2026-10-23T12:00:00Z')).toEqual([
      '2026-10-24T00:00:00.000Z', // 03:00 at +03:00 (summer)
      '2026-10-25T01:00:00.000Z', // 03:00 at +02:00 (winter, changed at 02:00)
      '2026-10-26T01:00:00.000Z',
    ]);
  });
});
