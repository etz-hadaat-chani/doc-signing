import { ROUND_NAME_MAX_LENGTH } from '@doc-signing/shared';
import { describe, expect, it } from 'vitest';
import type { ApprovalTarget, ReturnedTarget } from './approvals.repository.js';
import { approvalRefusal, correctionRoundName, sendAgainRefusal } from './approvals.rules.js';

const waiting: ApprovalTarget = {
  status: 'signed',
  needsApproval: true,
  approved: false,
  returned: false,
};

const returned: ReturnedTarget = {
  status: 'cancelled',
  returned: true,
  roundName: 'חוזה 2027',
  templateId: '00000000-0000-4000-8000-000000000001',
  employeeId: '00000000-0000-4000-8000-000000000002',
  employeeActive: true,
  firstName: 'דנה',
  lastName: 'כהן',
  correctionRoundId: null,
};

describe('approvalRefusal', () => {
  it('allows only a signed document waiting for approval', () => {
    expect(approvalRefusal(waiting)).toBeNull();
  });

  it.each([
    ['approved', { approved: true }],
    ['not flagged', { needsApproval: false }],
    ['signed manually', { status: 'signed_manual' as const, needsApproval: false }],
    ['returned', { status: 'cancelled' as const, returned: true }],
    ['not signed', { status: 'opened' as const }],
  ])('refuses %s', (_name, over) => {
    const target = { ...waiting, ...over };
    expect(approvalRefusal(target)).toEqual({
      code: 'ASSIGNMENT_NOT_WAITING_FOR_APPROVAL',
      details: { status: target.status, approved: target.approved, returned: target.returned },
    });
  });
});

describe('sendAgainRefusal', () => {
  it('allows a returned row with no correction round and an active employee', () => {
    expect(sendAgainRefusal(returned)).toBeNull();
  });

  it('refuses a row that was not returned (also an ordinary cancel)', () => {
    expect(sendAgainRefusal({ ...returned, status: 'signed', returned: false })).toEqual({
      code: 'ASSIGNMENT_NOT_RETURNED',
      details: { status: 'signed' },
    });
    expect(sendAgainRefusal({ ...returned, returned: false })?.code).toBe(
      'ASSIGNMENT_NOT_RETURNED',
    );
  });

  it('refuses a second correction round, naming the first', () => {
    const roundId = '00000000-0000-4000-8000-000000000003';
    expect(sendAgainRefusal({ ...returned, correctionRoundId: roundId })).toEqual({
      code: 'CORRECTION_ROUND_EXISTS',
      details: { roundId },
    });
  });

  it('refuses an inactive employee (after the other checks)', () => {
    expect(sendAgainRefusal({ ...returned, employeeActive: false })).toEqual({
      code: 'EMPLOYEE_INACTIVE',
    });
  });
});

describe('correctionRoundName', () => {
  it('is "תיקון: <round> – <first last>"', () => {
    expect(correctionRoundName('חוזה 2027', 'דנה', 'כהן')).toBe('תיקון: חוזה 2027 – דנה כהן');
  });

  it('is cut at 150 characters', () => {
    const name = correctionRoundName('א'.repeat(ROUND_NAME_MAX_LENGTH), 'דנה', 'כהן');
    expect(name).toHaveLength(ROUND_NAME_MAX_LENGTH);
    expect(name.startsWith('תיקון: אאא')).toBe(true);
  });

  it('never ends in half a character or a space', () => {
    // 'תיקון: ' (7) + 139 + ' – ' (3) = 149: the emoji is the 150th character (2 UTF-16 units).
    const emoji = correctionRoundName('ב'.repeat(139), '😀', 'כהן');
    expect(Array.from(emoji)).toHaveLength(ROUND_NAME_MAX_LENGTH);
    expect(emoji.endsWith('😀')).toBe(true);
    // 7 + 142 = 149: the 150th character is the space before "–", trimmed away.
    const space = correctionRoundName('ב'.repeat(142), 'דנה', 'כהן');
    expect(space).toHaveLength(ROUND_NAME_MAX_LENGTH - 1);
    expect(space.endsWith('ב')).toBe(true);
  });
});
