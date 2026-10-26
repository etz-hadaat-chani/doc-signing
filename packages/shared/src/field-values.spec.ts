import { describe, expect, it } from 'vitest';
import { formatDate, formatDayIL, formatTime } from './field-values.js';

describe('formatDayIL', () => {
  it('turns YYYY-MM-DD into DD/MM/YYYY', () => {
    expect(formatDayIL('2027-01-05')).toBe('05/01/2027');
  });
});

describe('formatDate', () => {
  it('shows the Israeli day with leading zeros, from a Date or an ISO string', () => {
    expect(formatDate(new Date('2027-01-05T10:00:00Z'))).toBe('05/01/2027');
    expect(formatDate('2026-12-12T10:00:00.000Z')).toBe('12/12/2026');
  });

  it('moves to the next day at Israeli midnight, winter (UTC+2) and summer (UTC+3)', () => {
    expect(formatDate('2026-12-11T21:59:00Z')).toBe('11/12/2026');
    expect(formatDate('2026-12-11T22:30:00Z')).toBe('12/12/2026');
    expect(formatDate('2026-07-14T20:59:00Z')).toBe('14/07/2026');
    expect(formatDate('2026-07-14T21:30:00Z')).toBe('15/07/2026');
  });
});

describe('formatTime', () => {
  it('shows the Israeli time as HH:MM, 24 hours, with leading zeros', () => {
    expect(formatTime('2026-12-12T07:05:00Z')).toBe('09:05');
    expect(formatTime(new Date('2026-07-14T11:32:00Z'))).toBe('14:32');
  });

  it('shows midnight as 00:00, not 24:00', () => {
    expect(formatTime('2026-12-11T22:00:00Z')).toBe('00:00');
    expect(formatTime('2026-07-14T21:00:00Z')).toBe('00:00');
  });
});
