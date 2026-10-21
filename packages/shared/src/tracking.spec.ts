import { describe, expect, it } from 'vitest';
import { isReservedKey } from './template-fields.js';
import {
  assignmentSearchSchema,
  assignmentTableQuerySchema,
  employeeHistoryQuerySchema,
  requestedDisplayStatuses,
  roundListQuerySchema,
} from './tracking.js';

const DEPT = '7b0c1f7e-3a52-4d41-9a1e-1c2b3d4e5f60';

describe('assignmentTableQuerySchema', () => {
  it('takes one status, repeated statuses, a department and the two aliases', () => {
    expect(assignmentTableQuerySchema.parse({ status: 'sent' })).toMatchObject({
      status: ['sent'],
      page: 1,
      pageSize: 25,
    });
    expect(
      assignmentTableQuerySchema.parse({
        status: ['sent', 'opened', 'sent'],
        dept: DEPT,
        approval: 'waiting',
        returned: 'true',
        page: '2',
        pageSize: '50',
      }),
    ).toEqual({
      status: ['sent', 'opened'],
      dept: DEPT,
      approval: 'waiting',
      returned: true,
      page: 2,
      pageSize: 50,
    });
  });

  it('treats empty values as not sent', () => {
    expect(assignmentTableQuerySchema.parse({ status: '', dept: '' })).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it.each([
    { status: 'unknown' },
    { dept: 'not-a-uuid' },
    { approval: 'yes' },
    { returned: 'maybe' },
    { pageSize: '101' },
    { page: '0' },
    { statsu: 'sent' },
  ])('refuses %o', (query) => {
    expect(assignmentTableQuerySchema.safeParse(query).success).toBe(false);
  });

  it('refuses search text in the URL: q only in the search body', () => {
    expect(assignmentTableQuerySchema.safeParse({ q: 'כהן' }).success).toBe(false);
    expect(assignmentSearchSchema.parse({ q: '  רחל   כהן ' }).q).toBe('רחל כהן');
    expect(assignmentSearchSchema.parse({ q: '   ' }).q).toBeUndefined();
    expect(assignmentSearchSchema.parse({ q: 'x', status: ['signed'], page: 2 })).toMatchObject({
      status: ['signed'],
      page: 2,
    });
  });
});

describe('requestedDisplayStatuses', () => {
  it('is null without filters', () => {
    expect(requestedDisplayStatuses({})).toBeNull();
  });

  it('narrows the status list with the aliases (AND)', () => {
    expect(requestedDisplayStatuses({ approval: 'waiting' })).toEqual(['waiting_for_approval']);
    expect(requestedDisplayStatuses({ returned: true })).toEqual(['returned_for_correction']);
    expect(requestedDisplayStatuses({ status: ['sent', 'opened'], approval: 'waiting' })).toEqual(
      [],
    );
    expect(
      requestedDisplayStatuses({
        status: ['cancelled', 'returned_for_correction'],
        returned: false,
      }),
    ).toEqual(['cancelled']);
  });
});

describe('the other queries', () => {
  it('round list: a round status; history: paging only', () => {
    expect(roundListQuerySchema.parse({ status: 'draft' }).status).toBe('draft');
    expect(roundListQuerySchema.safeParse({ status: 'signed' }).success).toBe(false);
    expect(employeeHistoryQuerySchema.safeParse({ status: 'sent' }).success).toBe(false);
    expect(employeeHistoryQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25 });
  });
});

describe('isReservedKey', () => {
  it('reserves both email-section answers', () => {
    expect(isReservedKey('email_choice')).toBe(true);
    expect(isReservedKey('email')).toBe(true);
    expect(isReservedKey('emails')).toBe(false);
  });
});
