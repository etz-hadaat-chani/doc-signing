import { describe, expect, it } from 'vitest';
import { approvalsQuerySchema, RETURN_NOTE_MAX_LENGTH, returnBodySchema } from './approvals.js';

describe('returnBodySchema', () => {
  it('trims the note and keeps its line breaks', () => {
    expect(returnBodySchema.parse({ note: '  שורה 1\nשורה 2 ' })).toEqual({
      note: 'שורה 1\nשורה 2',
    });
  });

  it('takes up to 500 characters', () => {
    expect(returnBodySchema.safeParse({ note: 'א'.repeat(RETURN_NOTE_MAX_LENGTH) }).success).toBe(
      true,
    );
  });

  it.each([
    ['missing', {}],
    ['empty', { note: '' }],
    ['spaces only', { note: ' \n ' }],
    ['too long', { note: 'א'.repeat(RETURN_NOTE_MAX_LENGTH + 1) }],
    ['not text', { note: 5 }],
    ['an extra field', { note: 'תיקון', status: 'cancelled' }],
  ])('refuses %s', (_name, body) => {
    expect(returnBodySchema.safeParse(body).success).toBe(false);
  });
});

describe('approvalsQuerySchema', () => {
  it('pages with the defaults; roundId optional', () => {
    expect(approvalsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
    const roundId = '00000000-0000-4000-8000-000000000001';
    expect(approvalsQuerySchema.parse({ roundId, page: '2' })).toMatchObject({
      roundId,
      page: 2,
    });
    expect(approvalsQuerySchema.parse({ roundId: '' })).toEqual({ page: 1, pageSize: 25 });
  });

  it('refuses a bad round id and unknown parameters (search text never goes in a URL)', () => {
    expect(approvalsQuerySchema.safeParse({ roundId: 'nope' }).success).toBe(false);
    expect(approvalsQuerySchema.safeParse({ q: '1001' }).success).toBe(false);
  });
});
