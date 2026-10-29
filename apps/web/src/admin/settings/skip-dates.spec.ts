import { REMINDER_SKIP_DATES_MAX } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import { he } from '../../i18n/he';
import { addSkipDate, removeSkipDate } from './skip-dates';

const text = he.settings.skipDates;

/** `count` distinct real days from 2027-01-01 on, `YYYY-MM-DD`. */
function days(count: number): string[] {
  const start = Date.UTC(2027, 0, 1);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

describe('addSkipDate', () => {
  it('reads DD/MM/YYYY (one-digit parts too) and keeps the list sorted as YYYY-MM-DD', () => {
    expect(addSkipDate(['2026-10-10'], '3/10/2026')).toEqual({
      list: ['2026-10-03', '2026-10-10'],
    });
    expect(addSkipDate([], ' 24/09/2026 ')).toEqual({ list: ['2026-09-24'] });
  });

  it.each(['2026-10-03', '3.10.2026', '10/2026', 'abc', ''])(
    'refuses "%s" (not DD/MM/YYYY)',
    (typed) => {
      expect(addSkipDate([], typed)).toEqual({ error: text.invalidShape });
    },
  );

  it('refuses a day that is not in the calendar', () => {
    expect(addSkipDate([], '31/02/2026')).toEqual({ error: text.notADay });
    expect(addSkipDate([], '29/02/2027')).toEqual({ error: text.notADay });
  });

  it('refuses a day already in the list', () => {
    expect(addSkipDate(['2026-10-03'], '03/10/2026')).toEqual({ error: text.duplicate });
  });

  it('takes the 100th day and refuses the 101st', () => {
    const almost = days(REMINDER_SKIP_DATES_MAX - 1);
    const result = addSkipDate(almost, '01/01/2030');
    expect('list' in result && result.list).toHaveLength(REMINDER_SKIP_DATES_MAX);
    expect(addSkipDate(days(REMINDER_SKIP_DATES_MAX), '01/01/2030')).toEqual({
      error: text.full(REMINDER_SKIP_DATES_MAX),
    });
  });
});

describe('removeSkipDate', () => {
  it('removes that day only', () => {
    expect(removeSkipDate(['2026-10-03', '2026-10-10'], '2026-10-03')).toEqual(['2026-10-10']);
  });
});
